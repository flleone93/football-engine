import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { buildRecommendation } from '../src/prediction/recommendation.js';
import { DemoProvider } from '../src/providers/demo.js';

// Probabilità reali del motore per Sassuolo–AC Milan (11/10/2026) e quote DraftKings via ESPN.
const SASSUOLO_MILAN = { '1': 0.336204, X: 0.273343, '2': 0.390453, '1X': 0.609547, X2: 0.663796, GOAL: 0.567, NO_GOAL: 0.433, OVER_1_5: 0.768, UNDER_1_5: 0.232, OVER_2_5: 0.518, UNDER_2_5: 0.482 };
const SASSUOLO_MILAN_ODDS = { values: { '1': 3.95, X: 3.6, '2': 1.833, OVER_2_5: 1.69, UNDER_2_5: 2.15 } };
const markets = (p1, px, p2, over15 = 0.75) => ({ '1': p1, X: px, '2': p2, '1X': p1 + px, X2: px + p2, GOAL: 0.5, NO_GOAL: 0.5, OVER_1_5: over15, UNDER_1_5: 1 - over15, OVER_2_5: 0.5, UNDER_2_5: 0.5 });

test('Sassuolo–Milan: Indicazione sul Milan (più probabile), non sul Sassuolo con più edge', () => {
  const result = buildRecommendation(SASSUOLO_MILAN, SASSUOLO_MILAN_ODDS, 60, 'shin');
  assert.equal(result.key, '2');
  assert.equal(result.probability, 0.390453);
  assert.equal(result.hasValue, false, 'il valore è sul Sassuolo, non sul segno indicato');
  assert.match(result.status, /più probabile/);
  const [doubleChance, over] = result.safer;
  assert.equal(doubleChance.key, 'X2');
  assert.equal(doubleChance.probability, 0.663796);
  assert.equal(doubleChance.estimated, true);
  const x2 = result.candidates.find((item) => item.key === 'X2');
  assert.equal(doubleChance.odd, Math.round(100 / x2.marketProbability) / 100);
  assert.deepEqual([over.key, over.probability, over.odd, over.estimated], ['OVER_1_5', 0.768, null, false]);
  assert.ok(result.candidates.find((item) => item.key === '1').edge > 0.1, 'il valore resta visibile nei mercati');
});

test('favorita con valore → hasValue; favorita in casa → doppia chance 1X', () => {
  const result = buildRecommendation(markets(0.55, 0.25, 0.2), { values: { '1': 2.0, X: 3.4, '2': 4.0 } }, 70, 'shin');
  assert.equal(result.key, '1');
  assert.equal(result.hasValue, true);
  assert.equal(result.safer[0].key, '1X');
});

test('pareggio favorito e parità tra 1 e 2: scelte deterministiche', () => {
  const draw = buildRecommendation(markets(0.3, 0.4, 0.3), null, 50, 'shin');
  assert.equal(draw.key, 'X');
  assert.equal(draw.safer[0].key, '1X', 'con P(1) = P(2) vince 1X');
  const tie = buildRecommendation(markets(0.36, 0.28, 0.36), null, 50, 'shin');
  assert.equal(tie.key, '1', 'parità: 1 prima di 2');
  const away = buildRecommendation(markets(0.3, 0.32, 0.38), null, 50, 'shin');
  assert.equal(away.safer[0].key, 'X2');
});

test('senza quote: segno più probabile, nessun valore, quote vuote', () => {
  const result = buildRecommendation(markets(0.2, 0.3, 0.5), null, 50, 'shin');
  assert.equal(result.key, '2');
  assert.equal(result.hasValue, false);
  assert.equal(result.odd, null);
  assert.deepEqual(result.safer.map((pick) => pick.odd), [null, null]);
  assert.ok(result.safer.every((pick) => Number.isFinite(pick.probability)));
});

test('proprietà su tutte le partite demo: il segno indicato non è mai meno probabile di un altro segno 1X2', async () => {
  const provider = new DemoProvider();
  const config = buildConfig({ DEMO_MODE: 'true' });
  for (const fixture of await provider.getFixtures({ days: 14 })) {
    const analysis = analyzeMatch(await provider.getAnalysisBundle(fixture.id), { neutral: false }, config);
    const o = analysis.summary.outcomes;
    const chosen = { '1': o.home, X: o.draw, '2': o.away }[analysis.summary.recommendation.key];
    assert.ok(chosen != null, `${fixture.id}: Indicazione fuori dall'1X2`);
    assert.ok(chosen >= Math.max(o.home, o.draw, o.away) - 1e-6, fixture.id);
    assert.equal(analysis.summary.recommendation.safer.length, 2);
  }
});

test('doppia chance: quota reale del bookmaker se c è, stima equa solo se manca', () => {
  const real = buildRecommendation(markets(0.5, 0.27, 0.23, 0.8), { values: { '1': 2.0, X: 3.3, '2': 3.5, '1X': 1.25, OVER_1_5: 1.3 } }, 60, 'shin');
  assert.deepEqual([real.safer[0].key, real.safer[0].odd, real.safer[0].estimated], ['1X', 1.25, false]);
  assert.deepEqual([real.safer[1].odd, real.safer[1].estimated], [1.3, false]);
  const fair = buildRecommendation(markets(0.5, 0.27, 0.23, 0.8), { values: { '1': 2.0, X: 3.3, '2': 3.5 } }, 60, 'shin');
  assert.equal(fair.safer[0].estimated, true);
  assert.ok(fair.safer[0].odd > 1);
  assert.equal(fair.safer[1].odd, null, 'Over 1.5 senza quota resta vuoto, mai stimato');
});
