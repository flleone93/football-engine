import test from 'node:test';
import assert from 'node:assert/strict';
import { applyAiAdjustmentPolicy, buildAgentEvidencePack, HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { config } from '../src/config.js';
import { runHybridAnalysis } from '../src/hybridEngine.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { DemoProvider } from '../src/providers/demo.js';

test('gli aggiustamenti AI sono limitati dai cap backend', () => {
  const policy = applyAiAdjustmentPolicy([
    {
      agentId: 'tactical_context',
      status: 'completed',
      effects: [
        { target: 'home_xg', suggestedAdjustment: 0.45, confidence: 0.95, rationale: 'test', evidenceIndex: [0] },
        { target: 'away_xg', suggestedAdjustment: -0.45, confidence: 0.95, rationale: 'test', evidenceIndex: [0] }
      ]
    },
    {
      agentId: 'competition_context',
      status: 'completed',
      effects: [
        { target: 'home_xg', suggestedAdjustment: 0.4, confidence: 0.2, rationale: 'low confidence', evidenceIndex: [0] }
      ]
    }
  ], config.ai);

  assert.ok(Math.abs(policy.lambdaAdjustment.home) + Math.abs(policy.lambdaAdjustment.away) <= config.ai.maxTotalXgDelta + 1e-9);
  assert.equal(policy.lambdaAdjustment.home, 0.1);
  assert.equal(policy.lambdaAdjustment.away, -0.1);
  assert.equal(policy.decisions.filter((item) => item.applied).reduce((sum, item) => sum + item.applied, 0), 0);
  assert.ok(policy.decisions.every((item) => item.scaleApplied >= 0 && item.scaleApplied <= 1));
  assert.equal(policy.decisions.some((item) => item.reason === 'low_effect_confidence'), true);
});

test('il cap AI e cumulativo per agente, non per singolo effetto', () => {
  const policy = applyAiAdjustmentPolicy([{
    agentId: 'tactical_context',
    status: 'completed',
    effects: [
      { target: 'home_xg', suggestedAdjustment: 0.12, confidence: 0.9, rationale: 'a', evidenceIndex: [0] },
      { target: 'home_xg', suggestedAdjustment: 0.12, confidence: 0.9, rationale: 'b', evidenceIndex: [0] }
    ]
  }], config.ai);
  assert.equal(policy.lambdaAdjustment.home, config.ai.maxTacticalXgDelta);
  assert.equal(policy.decisions[1].reason, 'agent_cap');
});

test('la stessa evidenza non viene conteggiata integralmente da più agenti', () => {
  const sharedEvidence = [{ source: 'injury.home.0', claim: 'Assenza confermata.', reliability: 'high' }];
  const policy = applyAiAdjustmentPolicy([
    {
      agentId: 'tactical_context', status: 'completed', evidence: sharedEvidence,
      effects: [{ target: 'away_xg', suggestedAdjustment: 0.08, confidence: 0.9, rationale: 'a', evidenceIndex: [0] }]
    },
    {
      agentId: 'competition_context', status: 'completed', evidence: sharedEvidence,
      effects: [{ target: 'away_xg', suggestedAdjustment: 0.08, confidence: 0.9, rationale: 'b', evidenceIndex: [0] }]
    }
  ], config.ai);
  assert.equal(policy.lambdaAdjustment.away, 0.12);
  assert.equal(policy.decisions[1].rawRequested, 0.08);
  assert.equal(policy.decisions[1].requested, 0.04);
  assert.equal(policy.decisions[1].reason, 'duplicate_evidence_discount');
});

test('ogni agente riceve solo dati pertinenti e fonti upstream disponibili', async () => {
  const provider = new DemoProvider();
  const bundle = await provider.getAnalysisBundle('demo-france-spain');
  bundle.sourceStatus.injuries = { available: false };
  bundle.news = [{ title: 'Notizia verificabile', publishedAt: new Date().toISOString() }];
  const baseline = analyzeMatch(bundle, { neutral: true }, { ...config, monteCarloRuns: 10000 });
  bundle.weather = { city: 'Dallas', temperatureC: 30, precipitationMm: 0, precipitationProbability: 0, windKmh: 5, retrievedAt: 'x', source: 'Open-Meteo' };
  bundle.sourceStatus.weather = { available: true, error: null };
  const player = buildAgentEvidencePack(bundle, baseline, 'tactical_context');
  const tactical = buildAgentEvidencePack(bundle, baseline, 'tactical_context');
  const news = buildAgentEvidencePack(bundle, baseline, 'news_intelligence');

  assert.deepEqual(player.injuries, { home: [], away: [] });
  assert.equal(player.evidenceCatalog.some((item) => item.category === 'injury'), false);
  assert.equal(tactical.news.length, 0);
  assert.equal(tactical.odds, null);
  assert.equal('odds' in tactical.observedData.observed, false);
  assert.equal(tactical.evidenceCatalog.every((item) => ['fixture', 'lineups', 'injury', 'recent_form', 'season_statistics', 'weather'].includes(item.category)), true);
  assert.equal(news.news.length, 1);
  assert.equal(news.seasonStats.home, null);
  assert.equal(news.evidenceCatalog.every((item) => ['fixture', 'news'].includes(item.category)), true);
  assert.equal(player.weather.city, 'Dallas');
  assert.equal(player.evidenceCatalog.some((item) => item.evidenceId === 'weather'), true);
  assert.equal(news.weather, null);
});

test('in modalita AI off il report conserva i cinque layer separati', async () => {
  const provider = new DemoProvider();
  const ai = new HybridAiOrchestrator({ ...config, ai: { ...config.ai, mode: 'off', apiKey: '' } });
  const bundle = await provider.getAnalysisBundle('demo-france-spain');
  const analysis = await runHybridAnalysis({ bundle, options: { neutral: true }, config, aiOrchestrator: ai, useAi: true });

  assert.deepEqual(Object.keys(analysis.layers), [
    'realData',
    'statisticalBaseline',
    'qualitativeAssessments',
    'unconfirmedInferences',
    'finalRecommendation'
  ]);
  assert.equal(analysis.layers.qualitativeAssessments.applied, false);
  assert.equal(analysis.layers.qualitativeAssessments.agents.length, 5);
});

test('il limite chiamate AI per analisi viene applicato anche in concorrenza', async () => {
  const provider = new DemoProvider();
  const limitedConfig = { ...config, monteCarloRuns: 10000, ai: { ...config.ai, mode: 'active', apiKey: 'test', maxCallsPerAnalysis: 1, maxConcurrency: 2 } };
  const ai = new HybridAiOrchestrator(limitedConfig);
  let calls = 0;
  ai.client = {
    enabled: () => true,
    json: async ({ agentId }) => {
      calls += 1;
      return {
        data: {
          agentId,
          status: 'insufficient_data',
          summary: 'Test senza effetti.',
          confidence: 0,
          evidence: [], effects: [], unsupportedClaims: [], riskFlags: [], needsRefresh: false
        },
        usage: { inputTokens: 10, outputTokens: 10, cachedInputTokens: 0 },
        responseId: `test-${calls}`,
        promptHash: `hash-${calls}`
      };
    }
  };
  const bundle = await provider.getAnalysisBundle('demo-france-spain');
  const analysis = await runHybridAnalysis({ bundle, options: { neutral: true }, config: limitedConfig, aiOrchestrator: ai, useAi: true });
  assert.equal(calls, 1);
  assert.equal(analysis.layers.qualitativeAssessments.agents.some((agent) => agent.errorCode === 'analysis_call_limit'), true);
});

test('cinque agenti: l agente giocatori è unito a quello tattico', async () => {
  const { AGENT_IDS, AGENT_SPECS } = await import('../src/ai/schemas.js');
  assert.deepEqual(AGENT_IDS, ['tactical_context', 'news_intelligence', 'competition_context', 'challenge_bias', 'final_explanation']);
  assert.equal(AGENT_SPECS.player_availability_impact, undefined);
  assert.match(AGENT_SPECS.tactical_context.prompt, /formazion/i);
  assert.equal(config.ai.maxTacticalXgDelta, 0.1);
  assert.ok(config.ai.maxCallsPerAnalysis <= 5);
});
