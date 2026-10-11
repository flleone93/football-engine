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
