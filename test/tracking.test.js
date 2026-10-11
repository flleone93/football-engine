import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { createApi } from '../src/api.js';
import { TTLCache } from '../src/cache.js';
import { buildConfig } from '../src/configCore.js';
import { ApiFootballProvider } from '../src/providers/apiFootball.js';
import { DemoProvider } from '../src/providers/demo.js';
import { JsonlLedgerStorage } from '../src/tracking/fileStorage.js';
import { brierScore, calibrationBins, evaluatePredictions, logLoss, rankedProbabilityScore, settleMarket } from '../src/tracking/metrics.js';
import { PredictionLedger } from '../src/tracking/predictionLedger.js';

const HOUR = 3600000;

function fakeAnalysis({ id = 'f1', kickoff, generatedAt, outcomes = { home: 0.5, draw: 0.3, away: 0.2 }, status = 'NS', league = 'Lega Test' }) {
  return {
    generatedAt,
    mode: 'demo',
    dataVersion: 'dv',
    options: { neutral: false },
    fixture: { id, kickoff, status, league: { id: 1, name: league, round: 'G1' }, home: { id: 1, name: 'Casa' }, away: { id: 2, name: 'Ospite' } },
    summary: {
      outcomes,
      xg: { home: 1.5, away: 1 },
      confidence: 60,
      exactScore: { score: '1-0' },
      recommendation: { key: '1', label: '1 · Vittoria casa', probability: outcomes.home, edge: 0.03, hasValue: true }
    },
    markets: [{ key: '1', probability: outcomes.home, odd: 2.1 }, { key: 'OVER_2_5', probability: 0.5, odd: 1.9 }, { key: 'GOAL', probability: 0.55, odd: 1.8 }],
    agents: [{ id: 'market', probabilities: { home: 0.45, draw: 0.3, away: 0.25 } }],
    governance: { dataQuality: { score: 80 } },
    layers: { qualitativeAssessments: { applied: false } }
  };
}

test('metriche probabilistiche: valori di riferimento noti', () => {
  const uniform = { home: 1 / 3, draw: 1 / 3, away: 1 / 3 };
  assert.equal(brierScore({ home: 1, draw: 0, away: 0 }, 'home'), 0);
  assert.ok(Math.abs(brierScore(uniform, 'draw') - 2 / 3) < 1e-12);
  assert.ok(Math.abs(logLoss(uniform, 'away') - Math.log(3)) < 1e-12);
  assert.equal(rankedProbabilityScore({ home: 1, draw: 0, away: 0 }, 'away'), 1);
  assert.equal(rankedProbabilityScore({ home: 0, draw: 1, away: 0 }, 'draw'), 0);
  // RPS premia la vicinanza ordinale: sbagliare di un esito costa meno che sbagliare di due.
  assert.ok(rankedProbabilityScore({ home: 0, draw: 1, away: 0 }, 'away') < rankedProbabilityScore({ home: 1, draw: 0, away: 0 }, 'away'));
});

test('regolamento dei mercati al 90 minuti', () => {
  const goals = { home: 2, away: 1 };
  assert.equal(settleMarket('1', goals), true);
  assert.equal(settleMarket('X2', goals), false);
  assert.equal(settleMarket('GOAL', goals), true);
  assert.equal(settleMarket('OVER_2_5', goals), true);
  assert.equal(settleMarket('UNDER_1_5', goals), false);
  assert.equal(settleMarket('NO_GOAL', { home: 0, away: 0 }), true);
  assert.equal(settleMarket('SCONOSCIUTO', goals), null);
  assert.equal(settleMarket('1', null), null);
});

test('la calibrazione conta tre probabilità per partita e le assegna al bin corretto', () => {
  const bins = calibrationBins([{ prediction: { outcomes: { home: 0.55, draw: 0.25, away: 0.2 } }, result: { outcome: 'home' } }]);
  assert.equal(bins.reduce((sum, bin) => sum + bin.n, 0), 3);
  assert.equal(bins[5].n, 1);
  assert.equal(bins[5].observedRate, 1);
  assert.equal(bins[2].n, 2);
  assert.equal(bins[2].observedRate, 0);
});

test('il registro accetta solo previsioni pre-partita e usa l’ultima prima del calcio d’inizio', () => {
  const ledger = new PredictionLedger();
  const kickoff = new Date(Date.now() - 5 * HOUR).toISOString();
  assert.equal(ledger.record(fakeAnalysis({ kickoff, generatedAt: new Date(Date.now() - 4 * HOUR).toISOString() })), null, 'analisi a gara iniziata respinta');
  assert.equal(ledger.record(fakeAnalysis({ kickoff, generatedAt: new Date(Date.now() - 9 * HOUR).toISOString(), status: '1H' })), null, 'stato non pre-partita respinto');
  const early = ledger.record(fakeAnalysis({ kickoff, generatedAt: new Date(Date.now() - 9 * HOUR).toISOString(), outcomes: { home: 0.4, draw: 0.3, away: 0.3 } }));
  const late = ledger.record(fakeAnalysis({ kickoff, generatedAt: new Date(Date.now() - 6 * HOUR).toISOString(), outcomes: { home: 0.6, draw: 0.25, away: 0.15 } }));
  assert.ok(early && late);
  assert.equal(ledger.record(fakeAnalysis({ kickoff, generatedAt: late.computedAt })), late, 'analisi in cache non duplicata');
  assert.equal(ledger.stats().predictionsLogged, 2);
  assert.equal(ledger.officialRecords().length, 1);
  assert.equal(ledger.officialRecords()[0].prediction.outcomes.home, 0.6);
  assert.deepEqual(ledger.pendingFixtureIds(), ['f1']);
  assert.equal(ledger.settle('f1', { status: 'NS', finished: false }), null, 'gara non conclusa non regolata');
  const result = ledger.settle('f1', { status: 'FT', finished: true, goals: { home: 2, away: 0 } });
  assert.equal(result.outcome, 'home');
  assert.deepEqual(ledger.pendingFixtureIds(), []);
  const evaluation = ledger.evaluate();
  assert.equal(evaluation.settled, 1);
  assert.equal(evaluation.recommendations.all.hits, 1);
  assert.equal(evaluation.recommendations.all.flatStake.profit, 1.1);
  assert.equal(ledger.exportRows()[0].recommendationHit, true);
});

test('le partite annullate non entrano nelle metriche', () => {
  const ledger = new PredictionLedger();
  ledger.record(fakeAnalysis({ kickoff: new Date(Date.now() - 5 * HOUR).toISOString(), generatedAt: new Date(Date.now() - 8 * HOUR).toISOString() }));
  assert.equal(ledger.settle('f1', { status: 'CANC' }).void, true);
  assert.equal(ledger.stats().voided, 1);
  assert.equal(ledger.evaluate().settled, 0);
});

test('il registro JSONL sopravvive al riavvio e tollera righe troncate', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ledger-'));
  const file = path.join(directory, 'nested', 'predictions.jsonl');
  try {
    const first = new PredictionLedger({ storage: new JsonlLedgerStorage(file) });
    first.record(fakeAnalysis({ kickoff: new Date(Date.now() - 5 * HOUR).toISOString(), generatedAt: new Date(Date.now() - 8 * HOUR).toISOString() }));
    first.settle('f1', { status: 'FT', finished: true, goals: { home: 0, away: 1 } });
    fs.appendFileSync(file, '{"type":"prediction","record":');
    const storage = new JsonlLedgerStorage(file);
    const restarted = new PredictionLedger({ storage });
    assert.equal(storage.corruptLines, 1);
    assert.equal(restarted.stats().settled, 1);
    assert.equal(restarted.evaluate().model.accuracy, 0);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('evaluatePredictions confronta il modello con mercato e uniforme sullo stesso campione', () => {
  const records = [
    { prediction: { outcomes: { home: 0.7, draw: 0.2, away: 0.1 }, marketOutcomes: { home: 0.5, draw: 0.3, away: 0.2 }, recommendation: { key: '1', probability: 0.7, odd: 1.8, hasValue: true }, markets: {} }, result: { outcome: 'home', goals: { home: 1, away: 0 } }, fixture: { league: { name: 'A' } } },
    { prediction: { outcomes: { home: 0.2, draw: 0.3, away: 0.5 }, marketOutcomes: null, recommendation: { key: '2', probability: 0.5, odd: null, hasValue: false }, markets: {} }, result: { outcome: 'draw', goals: { home: 1, away: 1 } }, fixture: { league: { name: 'B' } } }
  ];
  const evaluation = evaluatePredictions(records);
  assert.equal(evaluation.model.n, 2);
  assert.equal(evaluation.benchmarks.market.n, 1);
  assert.equal(evaluation.benchmarks.market.modelOnSameSample.n, 1);
  assert.ok(evaluation.benchmarks.market.brierSkillVsMarket > 0);
  assert.equal(evaluation.recommendations.all.flatStake.bets, 1);
  assert.equal(evaluation.byCompetition.length, 2);
});

function demoApi(ledger = new PredictionLedger()) {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  return createApi({
    config,
    provider: new DemoProvider(),
    aiOrchestrator: new HybridAiOrchestrator(config),
    analysisCache: new TTLCache(config.cacheTtlMs, config.cacheMaxEntries),
    ledger
  });
}

test('API performance: storico demo, registrazione analisi, export e protezione admin', async () => {
  const api = demoApi();
  const performance = await api.handle({ method: 'GET', pathname: '/api/performance', requestId: 't' });
  assert.equal(performance.status, 200);
  assert.equal(performance.payload.enabled, true);
  assert.equal(performance.payload.evaluation.settled, 60);
  assert.ok(performance.payload.evaluation.model.brier < performance.payload.evaluation.benchmarks.uniform.brier);
  assert.ok(performance.payload.methodology.demo);
  assert.ok(performance.payload.recent.every((record) => record.result?.finished));

  await api.handle({ method: 'POST', pathname: '/api/analyze', readBody: async () => ({ fixtureId: 'demo-mls' }), requestId: 't' });
  await api.handle({ method: 'POST', pathname: '/api/analyze', readBody: async () => ({ fixtureId: 'demo-mls' }), requestId: 't' });
  const after = await api.handle({ method: 'GET', pathname: '/api/performance', requestId: 't' });
  assert.equal(after.payload.ledger.awaitingKickoff, 1);
  assert.equal(after.payload.upcoming[0].fixture.id, 'demo-mls');

  const records = await api.handle({ method: 'GET', pathname: '/api/performance/records', requestId: 't' });
  assert.equal(records.payload.total, 61);
  assert.ok(records.payload.rows.some((row) => row.status === 'PENDING'));

  const forbidden = await api.handle({ method: 'POST', pathname: '/api/performance/settle', requestId: 't' });
  assert.equal(forbidden.status, 403);
  const allowed = await api.handle({ method: 'POST', pathname: '/api/performance/settle', isAdmin: true, requestId: 't' });
  assert.equal(allowed.status, 200);
});

test('API performance con registro disattivato', async () => {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const api = createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 100) });
  const performance = await api.handle({ method: 'GET', pathname: '/api/performance', requestId: 't' });
  assert.equal(performance.payload.enabled, false);
});

test('API-Football: il risultato usa il punteggio al 90 minuti, non quello dopo i supplementari', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    errors: [],
    response: [{ fixture: { id: 7, status: { short: 'AET' } }, goals: { home: 2, away: 1 }, score: { fulltime: { home: 1, away: 1 }, extratime: { home: 1, away: 0 } } }]
  }), { status: 200, headers: { 'content-type': 'application/json' } });
  try {
    const provider = new ApiFootballProvider(buildConfig({ DEMO_MODE: 'false', API_FOOTBALL_KEY: 'test-key' }));
    const result = await provider.getFixtureResult(7);
    assert.equal(result.finished, true);
    assert.deepEqual(result.goals, { home: 1, away: 1 });
    const ledger = new PredictionLedger();
    ledger.record(fakeAnalysis({ id: 7, kickoff: new Date(Date.now() - 5 * HOUR).toISOString(), generatedAt: new Date(Date.now() - 8 * HOUR).toISOString() }));
    assert.equal(ledger.settle(7, result).outcome, 'draw');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('registro: salva tutte le quote e fornisce la fotografia della partita', () => {
  const ledger = new PredictionLedger();
  const kickoff = new Date(Date.now() + 6 * HOUR).toISOString();
  ledger.record(fakeAnalysis({ id: 'f9', kickoff, generatedAt: new Date(Date.now() - 2 * HOUR).toISOString() }));
  const later = fakeAnalysis({ id: 'f9', kickoff, generatedAt: new Date(Date.now() - HOUR).toISOString() });
  later.markets = [{ key: '1', probability: 0.5, odd: 1.95 }, { key: 'X', probability: 0.3, odd: null }];
  ledger.record(later);
  const snapshot = ledger.fixtureSnapshot('f9');
  assert.deepEqual(snapshot.closingOdds, { '1': 1.95 });
  assert.equal(snapshot.closingAt, later.generatedAt);
  assert.equal(snapshot.fixture.home.name, 'Casa');
  assert.equal(snapshot.result, null);
  assert.equal(ledger.fixtureSnapshot('sconosciuta'), null);
});

test('registro: previsioni vecchie senza quote → closingOdds null', () => {
  const kickoff = new Date(Date.now() - 5 * HOUR).toISOString();
  const record = { id: 'old|x|neutral=false', source: 'engine', predictedAt: new Date(Date.now() - 8 * HOUR).toISOString(), computedAt: 'x', fixture: { id: 'old', kickoff, league: { name: 'L' }, home: { name: 'A' }, away: { name: 'B' } }, prediction: { outcomes: { home: 0.4, draw: 0.3, away: 0.3 }, recommendation: {} } };
  const storage = { kind: 'memory', load: () => [{ type: 'prediction', record }, { type: 'settlement', fixtureId: 'old', result: { finished: true, void: false, goals: { home: 2, away: 1 }, outcome: 'home' } }], append() {} };
  const snapshot = new PredictionLedger({ storage }).fixtureSnapshot('old');
  assert.equal(snapshot.closingOdds, null);
  assert.deepEqual(snapshot.result.goals, { home: 2, away: 1 });
});
