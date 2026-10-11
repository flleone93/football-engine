import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { devig, devigOdds, devigShin } from '../src/prediction/probability.js';
import { DemoProvider } from '../src/providers/demo.js';

const entries = (o1, ox, o2) => [{ key: '1', odd: o1 }, { key: 'X', odd: ox }, { key: '2', odd: o2 }];
const sum = (probabilities) => Object.values(probabilities).reduce((total, value) => total + value, 0);

test('Shin: somma 1, quota più alta → probabilità più bassa', () => {
  const result = devigShin(entries(1.5, 4.2, 6.5));
  assert.equal(result.converged, true);
  assert.ok(Math.abs(sum(result.probabilities) - 1) < 1e-6);
  assert.ok(result.probabilities['1'] > result.probabilities.X && result.probabilities.X > result.probabilities['2']);
  assert.ok(result.z > 0 && result.z < 0.2);
});

test('Shin: corregge il favorite-longshot bias rispetto al proporzionale', () => {
  const shin = devigShin(entries(1.5, 4.2, 6.5)).probabilities;
  const proportional = devigOdds(entries(1.5, 4.2, 6.5));
  assert.ok(shin['1'] > proportional['1'], 'la favorita sale');
  assert.ok(shin['2'] < proportional['2'], 'la sfavorita scende');
});

test('Shin: margine zero → uguale al proporzionale', () => {
  assert.deepEqual(devigShin(entries(2, 4, 4)).probabilities, devigOdds(entries(2, 4, 4)));
  assert.equal(devigShin(entries(2, 4, 4)).z, 0);
});

test('Shin: quote non valide, arbitraggio e mancata convergenza', () => {
  assert.equal(devigShin(entries(1.5, null, 6)), null);
  assert.equal(devigShin([{ key: 'a', odd: 2 }]), null);
  assert.equal(devigShin(entries(3, 3.5, 4)).converged, false, 'somma delle implicite < 1: Shin non definito');
  assert.equal(devigShin(entries(1.5, 4.2, 6.5), { maxIterations: 1 }).converged, false);
});

test('devig: metodo scelto, fallback tracciato', () => {
  assert.equal(devig(entries(1.5, 4.2, 6.5), 'shin').method, 'shin');
  assert.deepEqual(devig(entries(1.5, 4.2, 6.5), 'proportional'), { probabilities: devigOdds(entries(1.5, 4.2, 6.5)), method: 'proportional', fallback: false, z: null });
  const arbitrage = devig(entries(3, 3.5, 4), 'shin');
  assert.deepEqual([arbitrage.method, arbitrage.fallback], ['proportional', true]);
  assert.ok(Math.abs(sum(arbitrage.probabilities) - 1) < 1e-6);
  assert.equal(devig(entries(1.5, null, 6), 'shin'), null);
});

test('configurazione: DEVIG_METHOD predefinito shin, valori ammessi', () => {
  assert.equal(buildConfig({ DEMO_MODE: 'true' }).devigMethod, 'shin');
  assert.equal(buildConfig({ DEMO_MODE: 'true', DEVIG_METHOD: 'proportional' }).devigMethod, 'proportional');
});

test('motore: Shin usato per benchmark e edge, tracciato nella governance', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const shin = analyzeMatch(bundle, { neutral: true }, buildConfig({ DEMO_MODE: 'true' }));
  const proportional = analyzeMatch(bundle, { neutral: true }, buildConfig({ DEMO_MODE: 'true', DEVIG_METHOD: 'proportional' }));
  assert.equal(shin.governance.devig.requested, 'shin');
  assert.equal(shin.governance.devig.oneXtwo.method, 'shin');
  assert.equal(proportional.governance.devig.oneXtwo.method, 'proportional');
  const market = (analysis) => analysis.agents.find((agent) => agent.id === 'market').probabilities;
  assert.notDeepEqual(market(shin), market(proportional));
  const edge = (analysis) => analysis.markets.find((item) => item.key === '1').marketProbability;
  assert.notEqual(edge(shin), edge(proportional));
  assert.deepEqual(shin.governance.devig.fallbacks, []);
});
