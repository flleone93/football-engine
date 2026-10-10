import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { createApi } from '../src/api.js';
import { createHash as browserCreateHash, randomUUID } from '../src/browser/crypto.js';
import { TTLCache } from '../src/cache.js';
import { buildConfig } from '../src/configCore.js';
import { DemoProvider } from '../src/providers/demo.js';

test('lo shim SHA-256 del browser coincide con node:crypto', () => {
  for (const input of ['', 'abc', 'Malmö – Djurgården ⚽', 'x'.repeat(55), 'y'.repeat(64), JSON.stringify({ a: [1, 2, 3], b: 'ç' }).repeat(40)]) {
    assert.equal(browserCreateHash('sha256').update(input).digest('hex'), createHash('sha256').update(input).digest('hex'));
  }
  assert.match(randomUUID(), /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});

test('buildConfig tratta i valori numerici vuoti come default', () => {
  const config = buildConfig({ MONTE_CARLO_RUNS: '', PORT: '9000' });
  assert.equal(config.monteCarloRuns, 50000);
  assert.equal(config.port, 9000);
  assert.equal(config.ai.mode, 'off');
});

function demoApi() {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  return createApi({
    config,
    provider: new DemoProvider(),
    aiOrchestrator: new HybridAiOrchestrator(config),
    analysisCache: new TTLCache(config.cacheTtlMs, config.cacheMaxEntries)
  });
}

test('API condivisa: calendario, analisi, Top Picks ed errori', async () => {
  const api = demoApi();
  const fixtures = await api.handle({ method: 'GET', pathname: '/api/fixtures', requestId: 't' });
  assert.equal(fixtures.status, 200);
  assert.ok(fixtures.payload.fixtures.length >= 10);

  const analysis = await api.handle({ method: 'POST', pathname: '/api/analyze', readBody: async () => ({ fixtureId: 'demo-france-spain', neutral: true }), requestId: 't' });
  assert.equal(analysis.status, 200);
  assert.ok(analysis.payload.layers);

  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(fixtures.payload.fixtures[0].kickoff));
  const top = await api.handle({ method: 'POST', pathname: '/api/top-picks', readBody: async () => ({ date, limit: 5, stake: 10 }), requestId: 't' });
  assert.equal(top.status, 200);
  assert.ok(Array.isArray(top.payload.picks));

  await assert.rejects(
    api.handle({ method: 'POST', pathname: '/api/analyze', readBody: async () => ({ fixtureId: 'inesistente' }), requestId: 't' }),
    (error) => error.code === 'not_found'
  );
  assert.equal((await api.handle({ method: 'GET', pathname: '/api/nope', requestId: 't' })).status, 404);
  assert.equal(await api.handle({ method: 'GET', pathname: '/index.html', requestId: 't' }), null);
});
