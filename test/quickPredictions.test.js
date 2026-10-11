import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { createApi } from '../src/api.js';
import { TTLCache } from '../src/cache.js';
import { buildConfig } from '../src/configCore.js';
import { DemoProvider } from '../src/providers/demo.js';

function api() {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  return createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500) });
}
const call = (instance, body) => instance.handle({ method: 'POST', pathname: '/api/quick-predictions', readBody: async () => body, requestId: 't' });

test('previsioni rapide: sintesi per ogni partita, errori isolati', async () => {
  const result = await call(api(), { fixtureIds: ['demo-mls', 'sconosciuta', 'demo-france-spain'] });
  assert.equal(result.status, 200);
  const [mls, missing, wc] = result.payload.predictions;
  assert.equal(mls.fixtureId, 'demo-mls');
  assert.ok(Math.abs(mls.outcomes.home + mls.outcomes.draw + mls.outcomes.away - 1) < 1e-6);
  assert.equal(typeof mls.recommendation.label, 'string');
  assert.equal(typeof mls.recommendation.hasValue, 'boolean');
  assert.ok(mls.confidence > 0);
  assert.deepEqual(missing, { fixtureId: 'sconosciuta', error: 'Previsione non disponibile.' });
  assert.equal(wc.fixtureId, 'demo-france-spain');
});

test('previsioni rapide: validazione dell input', async () => {
  const instance = api();
  // Convenzione del progetto: handle lancia validation_error, il trasporto lo converte in HTTP 400.
  await assert.rejects(call(instance, { fixtureIds: [] }), { code: 'validation_error' });
  await assert.rejects(call(instance, { fixtureIds: Array.from({ length: 13 }, (_, i) => `id${i}`) }), { code: 'validation_error' });
  await assert.rejects(call(instance, {}), { code: 'validation_error' });
});

test('previsioni rapide: il provider viene chiamato in modalità lite', async () => {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const demo = new DemoProvider();
  const options = [];
  const provider = { mode: 'demo', getFixtures: (o) => demo.getFixtures(o), getAnalysisBundle: (id, o = {}) => { options.push(o); return demo.getAnalysisBundle(id, o); } };
  const instance = createApi({ config, provider, aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500) });
  await call(instance, { fixtureIds: ['demo-mls'] });
  assert.equal(options.length, 1);
  assert.equal(options[0].lite, true);
});
