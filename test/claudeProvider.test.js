import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { buildConfig } from '../src/configCore.js';
import { AGENT_SPECS } from '../src/ai/schemas.js';
import { runHybridAnalysis } from '../src/hybridEngine.js';
import { americanToDecimal, decodeFixtureId, encodeFixtureId, normalizeEspnOdds } from '../src/providers/espn.js';
import { DemoProvider } from '../src/providers/demo.js';
import { SnapshotProvider } from '../src/providers/snapshot.js';

// Genera un oggetto minimo conforme allo schema JSON di ciascun agente.
function fromSchema(schema, key = '') {
  if (schema.const !== undefined) return schema.const;
  if (schema.enum) return key === 'status' && schema.enum.includes('completed') ? 'completed' : schema.enum[0];
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== 'null') : schema.type;
  if (type === 'object') return Object.fromEntries(Object.entries(schema.properties || {}).map(([name, child]) => [name, fromSchema(child, name)]));
  if (type === 'array') return [];
  if (type === 'number' || type === 'integer') return schema.minimum ?? 0;
  if (type === 'boolean') return false;
  return `Valutazione ${key || 'testo'}`;
}

function claudeConfig() {
  return buildConfig({ DEMO_MODE: 'true', AI_MODE: 'active', AI_PROVIDER: 'claude' });
}

test('provider claude: senza runtime Artifact gli agenti restano spenti', () => {
  const orchestrator = new HybridAiOrchestrator(claudeConfig());
  assert.equal(orchestrator.effectiveMode(), 'off_missing_key');
});

test('provider claude: i sei agenti passano dal sampler e dalla validazione backend', async () => {
  const prompts = [];
  const sampler = async (prompt, options) => {
    prompts.push({ prompt, options });
    const schema = JSON.parse(prompt.split('\n').find((line) => line.startsWith('{"')));
    const agentId = Object.keys(AGENT_SPECS).find((id) => prompt.startsWith(`Sei ${AGENT_SPECS[id].label}.`));
    return { ...fromSchema(schema), agentId };
  };
  const config = claudeConfig();
  const orchestrator = new HybridAiOrchestrator(config, { sampler });
  assert.equal(orchestrator.effectiveMode(), 'active');
  const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const analysis = await runHybridAnalysis({ bundle, options: { neutral: true }, config, aiOrchestrator: orchestrator, useAi: true });
  assert.ok(prompts.length >= 3, `chiamate Claude: ${prompts.length}`);
  assert.ok(prompts.every(({ options }) => options.modelTier === 'default'));
  assert.ok(prompts.every(({ prompt }) => prompt.includes('JSON Schema') && prompt.includes('non attendibile')));
  const trace = analysis.layers.qualitativeAssessments;
  assert.equal(trace.provider, 'claude');
  const ran = trace.agents.filter((agent) => agent.status !== 'insufficient_data');
  assert.ok(ran.length >= 2);
  assert.ok(ran.every((agent) => agent.status === 'completed' && agent.provider === 'claude'), JSON.stringify(trace.agents.map((agent) => [agent.agentId, agent.status, agent.errorCode])));
  assert.equal(trace.challenge?.status, 'completed');
  assert.equal(trace.explanation?.provider, 'claude');
  const total = analysis.summary.outcomes.home + analysis.summary.outcomes.draw + analysis.summary.outcomes.away;
  assert.ok(Math.abs(total - 1) < 1e-6);
});

test('provider claude: un rifiuto del runtime mantiene il fallback deterministico', async () => {
  const config = claudeConfig();
  const orchestrator = new HybridAiOrchestrator(config, { sampler: async () => { throw { code: 'not_granted', message: 'no' }; } });
  const bundle = await new DemoProvider().getAnalysisBundle('demo-mls');
  const analysis = await runHybridAnalysis({ bundle, options: {}, config, aiOrchestrator: orchestrator, useAi: true });
  const errors = analysis.layers.qualitativeAssessments.agents.filter((agent) => agent.status === 'error');
  assert.ok(errors.length >= 1);
  assert.ok(errors.every((agent) => agent.errorCode === 'claude_not_granted'));
  assert.equal(analysis.governance.lambdaAdjustmentApplied.home, 0);
});

test('ESPN: conversione quote americane e identificativi', () => {
  assert.equal(americanToDecimal('+300'), 4);
  assert.equal(americanToDecimal('-145'), 1.69);
  assert.equal(americanToDecimal('EVEN'), 2);
  assert.equal(americanToDecimal('OFF'), null);
  const id = encodeFixtureId('uefa.europa.conf', '401');
  assert.deepEqual(decodeFixtureId(id), { slug: 'uefa.europa.conf', eventId: '401' });
  assert.equal(decodeFixtureId('demo-mls'), null);
});

test('ESPN: quote 1X2 e Over/Under 2.5 con apertura, ignorando linee diverse da 2.5', () => {
  const raw = [{
    provider: { displayName: 'DraftKings' }, overUnder: 2.5,
    moneyline: { home: { open: { odds: '+300' }, close: { odds: '+320' } }, draw: { open: { odds: '+260' }, close: { odds: '+285' } }, away: { open: { odds: '-135' }, close: { odds: '-145' } } },
    total: { over: { open: { line: 'o2.5', odds: '-145' }, close: { line: 'o2.5', odds: '-150' } }, under: { open: { line: 'u2.5', odds: '+105' }, close: { line: 'u2.5', odds: '+115' } } }
  }];
  const odds = normalizeEspnOdds(raw, '2026-10-10T00:00:00Z');
  assert.deepEqual(odds.values, { 1: 4.2, X: 3.85, 2: 1.69, OVER_2_5: 1.667, UNDER_2_5: 2.15 });
  assert.equal(odds.opening['1'], 4);
  assert.equal(odds.bookmaker, 'DraftKings via ESPN');
  const otherLine = normalizeEspnOdds([{ ...raw[0], overUnder: 3.5 }], 'x');
  assert.equal(otherLine.values.OVER_2_5, undefined);
  assert.equal(normalizeEspnOdds([], 'x'), null);
});

test('snapshot: nasconde le gare già iniziate e restituisce copie dei bundle', async () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  const fixture = (id, kickoff) => ({ id, kickoff, league: { id: 'ita.1', name: 'Serie A' }, home: { name: 'A' }, away: { name: 'B' } });
  const provider = new SnapshotProvider({
    generatedAt: '2026-10-10T08:00:00Z', source: 'ESPN',
    fixtures: [fixture('espn:ita.1:1', '2026-10-10T07:00:00Z'), fixture('espn:ita.1:2', '2026-10-10T18:00:00Z')],
    bundles: { 'espn:ita.1:2': { fixture: fixture('espn:ita.1:2', '2026-10-10T18:00:00Z') } }
  }, { now: () => now });
  assert.deepEqual((await provider.getFixtures()).map((item) => item.id), ['espn:ita.1:2']);
  const bundle = await provider.getAnalysisBundle('espn:ita.1:2');
  bundle.fixture.home.name = 'modificato';
  assert.equal((await provider.getAnalysisBundle('espn:ita.1:2')).fixture.home.name, 'A');
  await assert.rejects(provider.getAnalysisBundle('espn:ita.1:9'), { code: 'not_found' });
  assert.equal(provider.snapshotInfo.fixtures, 2);
});

test('DATA_PROVIDER: ESPN senza chiave, API-Football solo con chiave', () => {
  assert.equal(buildConfig({ DEMO_MODE: 'false' }).dataProvider, 'espn');
  assert.equal(buildConfig({ DEMO_MODE: 'false', API_FOOTBALL_KEY: 'k' }).dataProvider, 'api-football');
  assert.equal(buildConfig({ DEMO_MODE: 'false', API_FOOTBALL_KEY: 'k', DATA_PROVIDER: 'espn' }).dataProvider, 'espn');
  assert.equal(buildConfig({ DEMO_MODE: 'true', DATA_PROVIDER: 'espn' }).dataProvider, 'demo');
});
