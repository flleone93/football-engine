import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { eloOutcomes } from '../src/prediction/elo.js';
import { analyzeMatch, mixOutcomes } from '../src/prediction/engine.js';
import { ENSEMBLE, resolveEnsemble } from '../src/prediction/ensembleWeights.js';
import { DemoProvider } from '../src/providers/demo.js';

const sum = (p) => p.home + p.draw + p.away;
const config = buildConfig({ DEMO_MODE: 'true' });

test('eloOutcomes: somma 1, simmetria, pareggio massimo a 0,5 e limitato', () => {
  const even = eloOutcomes(0.5, 0.3);
  assert.ok(Math.abs(sum(even) - 1) < 1e-9);
  assert.ok(Math.abs(even.home - even.away) < 1e-9);
  assert.ok(Math.abs(even.draw - 0.3) < 1e-9);
  const strong = eloOutcomes(0.8, 0.3);
  const mirrored = eloOutcomes(0.2, 0.3);
  assert.ok(strong.draw < even.draw && strong.draw >= 0.12);
  assert.ok(Math.abs(strong.home - mirrored.away) < 1e-9);
  assert.ok(eloOutcomes(0.99, 0.3).away >= 0);
});

test('mixOutcomes: pesi, ridistribuzione delle fonti mancanti, limite agli scontri diretti', () => {
  const p = { a: { home: 0.6, draw: 0.2, away: 0.2 }, b: { home: 0.2, draw: 0.2, away: 0.6 } };
  const mixed = mixOutcomes({ market: p.a, poisson: p.b }, { market: 0.75, poisson: 0.25 });
  assert.ok(Math.abs(mixed.home - 0.5) < 1e-9);
  assert.deepEqual(mixOutcomes({ market: p.a, poisson: null }, { market: 0.5, poisson: 0.5 }), p.a, 'fonte mancante: peso ridistribuito');
  const capped = mixOutcomes({ market: p.a, h2h: p.b }, { market: 0.5, h2h: 0.5 });
  assert.ok(capped.home > 0.55, 'scontri diretti limitati al 7% come nel motore');
  assert.equal(mixOutcomes({ market: null }, { market: 1 }), null);
});

test('pesi: file valido, fallback se malformato', () => {
  assert.equal(resolveEnsemble().fallback, false);
  assert.equal(typeof ENSEMBLE.version, 'string');
  const broken = resolveEnsemble({ weights: { market: -1 } });
  assert.equal(broken.fallback, true);
  assert.deepEqual(broken.config.weights, { poisson: 25, montecarlo: 15, market: 25, form: 18, provider: 10, h2h: 7, elo: 0 });
});

test('motore: pesi da options, fonte a peso 0 esclusa, Elo come fonte, campo neutro ricalcolato', async () => {
  const base = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const elo = { home: { rating: 1600, games: 10 }, away: { rating: 1500, games: 10 }, expectedHome: 0.7, matches: 50, season: '2026', k: 20, homeAdvantage: 60 };
  const bundle = { ...base, elo };
  const onlyMarket = analyzeMatch(bundle, { neutral: true, weights: { market: 1 } }, config);
  const market = onlyMarket.agents.find((agent) => agent.id === 'market').probabilities;
  assert.ok(Math.abs(onlyMarket.summary.outcomes.home - market.home) < 1e-3, 'solo mercato → esito = mercato');
  const poisson = onlyMarket.agents.find((agent) => agent.id === 'poisson');
  assert.equal(poisson.excludedByData, true);
  assert.equal(poisson.effectiveWeight, 0);
  const withElo = analyzeMatch(bundle, { neutral: true, weights: { elo: 1 } }, config);
  assert.ok(withElo.agents.find((agent) => agent.id === 'elo').active);
  assert.ok(Math.abs(withElo.context.elo.expectedHome - 1 / (1 + 10 ** (-100 / 400))) < 1e-3, 'campo neutro: niente +60');
  const home = analyzeMatch(bundle, { neutral: false, weights: { elo: 1 } }, config);
  assert.ok(home.context.elo.expectedHome > withElo.context.elo.expectedHome);
  assert.equal(home.governance.modelVersion, ENSEMBLE.version);
  assert.equal(home.governance.mathVersion, '2.4.0');
});

test('soglie del Valore lette attraverso il controllo di validità', async () => {
  const { valueThresholdsFrom } = await import('../src/prediction/ensembleWeights.js');
  assert.deepEqual(valueThresholdsFrom({ weights: { market: 1 }, valueThresholds: { edge: null } }), { edge: 0.025, ev: 0.03 });
  assert.deepEqual(valueThresholdsFrom({}), { edge: 0.025, ev: 0.03 });
});

test('partita senza quote: pesi senza mercato (manuali, validati meglio sul banco di prova)', async () => {
  const base = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const analysis = analyzeMatch({ ...base, odds: null, sourceStatus: { ...base.sourceStatus, odds: { available: false } } }, { neutral: true }, config);
  const weight = (id) => analysis.agents.find((agent) => agent.id === id).effectiveWeight;
  assert.ok(weight('poisson') > 0.2, 'Poisson torna a pesare senza quote');
  assert.equal(analysis.governance.ensemble.noMarket, true);
});

test('mercati gol: edge non validati, niente Kelly', async () => {
  const { buildRecommendation } = await import('../src/prediction/recommendation.js');
  const markets = { '1': 0.4, X: 0.3, '2': 0.3, '1X': 0.7, X2: 0.6, GOAL: 0.6, NO_GOAL: 0.4, OVER_1_5: 0.8, UNDER_1_5: 0.2, OVER_2_5: 0.6, UNDER_2_5: 0.4 };
  const result = buildRecommendation(markets, { values: { '1': 2.6, X: 3.3, '2': 2.8, GOAL: 1.9, NO_GOAL: 1.9, OVER_2_5: 2.1, UNDER_2_5: 1.75 } }, 60, 'shin');
  const over = result.candidates.find((item) => item.key === 'OVER_2_5');
  assert.equal(over.validated, false);
  assert.equal(over.kellyFraction, null);
  assert.equal(result.candidates.find((item) => item.key === '1').validated, true);
});
