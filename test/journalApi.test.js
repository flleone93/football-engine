import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { APP_VERSION, createApi } from '../src/api.js';
import { TTLCache } from '../src/cache.js';
import { buildConfig } from '../src/configCore.js';
import { DemoProvider } from '../src/providers/demo.js';
import { BetJournal } from '../src/tracking/betJournal.js';
import { PredictionLedger } from '../src/tracking/predictionLedger.js';

function setup({ journal = new BetJournal() } = {}) {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const api = createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500), ledger: new PredictionLedger(), journal });
  const call = (method, pathname, body) => api.handle({ method, pathname, readBody: async () => body, requestId: 't' });
  return { api, call };
}

test('versione 1.11.0', () => assert.equal(APP_VERSION, '1.11.0'));

test('diario via API: aggiungi dopo l analisi, leggi, elimina', async () => {
  const { call } = setup();
  await assert.rejects(call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: '1', oddTaken: 2, stake: 5 }), { code: 'validation_error', message: /Analizza la partita/ });
  const analysis = (await call('POST', '/api/analyze', { fixtureId: 'demo-france-spain', useAi: false })).payload;
  const quoted = analysis.markets.find((market) => market.odd > 1);
  assert.equal(typeof quoted.kellyFraction, 'number');
  const added = await call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: quoted.key, oddTaken: '2,05', stake: '10' });
  assert.equal(added.status, 200);
  assert.equal(added.payload.bet.match, `${analysis.fixture.home.name} - ${analysis.fixture.away.name}`);
  assert.equal(added.payload.bet.label, quoted.label);
  assert.equal(added.payload.bet.oddTaken, 2.05);
  const listed = (await call('GET', '/api/journal')).payload;
  assert.equal(listed.enabled, true);
  assert.equal(listed.bets.length, 1);
  assert.equal(listed.bets[0].status, 'open');
  assert.equal(listed.bets[0].closingOdd, quoted.odd);
  assert.equal(listed.summary.count, 1);
  assert.equal(listed.limits.anyExceeded, false);
  await assert.rejects(call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: 'NON_ESISTE', oddTaken: 2, stake: 5 }), { code: 'validation_error' });
  assert.deepEqual((await call('POST', '/api/journal/delete', { id: listed.bets[0].id })).payload.deleted, true);
  assert.equal((await call('GET', '/api/journal')).payload.bets.length, 0);
});

test('diario via API: impostazioni e puntata suggerita', async () => {
  const { call } = setup();
  const saved = await call('POST', '/api/journal/settings', { bankroll: '500', kellyMultiplier: 0.25, maxStakePct: 0.02, dailyLossLimit: '', weeklyLossLimit: '50' });
  assert.equal(saved.payload.settings.bankroll, 500);
  const suggestion = (await call('POST', '/api/journal/suggest', { probability: 0.6, odd: '2' })).payload;
  assert.deepEqual([suggestion.kellyFraction, suggestion.fraction, suggestion.stake, suggestion.hasStake], [0.2, 0.02, 10, true]);
  await assert.rejects(call('POST', '/api/journal/settings', { kellyMultiplier: 3 }), { code: 'validation_error' });
});

test('diario via API: partita già iniziata rifiutata', async () => {
  const journal = new BetJournal();
  const { api, call } = setup({ journal });
  const analysis = await api.analyzeFixture('demo-france-spain', false, { useAi: false });
  const realNow = Date.now;
  Date.now = () => Date.parse(analysis.fixture.kickoff) + 60000;
  try {
    await assert.rejects(call('POST', '/api/journal', { fixtureId: 'demo-france-spain', marketKey: '1', oddTaken: 2, stake: 5 }), { message: /già iniziata/ });
  } finally {
    Date.now = realNow;
  }
});

test('senza diario: lettura vuota, scritture 409', async () => {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const api = createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500) });
  const read = await api.handle({ method: 'GET', pathname: '/api/journal', requestId: 't' });
  assert.deepEqual([read.payload.enabled, read.payload.bets], [false, []]);
  const write = await api.handle({ method: 'POST', pathname: '/api/journal/settings', readBody: async () => ({}), requestId: 't' });
  assert.equal(write.status, 409);
});

test('server: diario disattivato di base, attivabile solo con BET_JOURNAL_ENABLED=true', () => {
  assert.equal(buildConfig({}).betJournal.enabled, false);
  assert.equal(buildConfig({ BET_JOURNAL_ENABLED: 'true' }).betJournal.enabled, true);
});
