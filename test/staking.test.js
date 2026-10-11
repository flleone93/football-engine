import assert from 'node:assert/strict';
import test from 'node:test';
import { buildRecommendation } from '../src/prediction/recommendation.js';
import { kellyFraction, recommendedStake } from '../src/prediction/staking.js';

const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} ≠ ${expected}`);
const settings = (extra = {}) => ({ bankroll: null, kellyMultiplier: 0.25, maxStakePct: 0.02, ...extra });

test('Kelly: valori di riferimento', () => {
  near(kellyFraction(0.6, 2), 0.2);
  near(kellyFraction(0.5, 2.2), 0.1 / 1.2);
  assert.equal(kellyFraction(0.4, 2), 0, 'valore atteso negativo → nessuna puntata');
  assert.equal(kellyFraction(0.5, 1), null);
  assert.equal(kellyFraction(0.5, null), null);
  assert.equal(kellyFraction(Number.NaN, 2), null);
  assert.equal(kellyFraction(1.2, 2), null);
});

test('puntata: frazione, tetto e arrotondamento a 0,50 €', () => {
  assert.deepEqual(recommendedStake({ probability: 0.6, odd: 2, settings: settings({ bankroll: 500 }) }), { kellyFraction: 0.2, fraction: 0.02, stake: 10, hasStake: true });
  const small = recommendedStake({ probability: 0.5, odd: 2.2, settings: settings({ bankroll: 1000, kellyMultiplier: 0.125 }) });
  near(small.fraction, Math.round(0.1 / 1.2 * 0.125 * 1e6) / 1e6);
  assert.equal(small.stake, 10.5);
  assert.equal(small.hasStake, true);
});

test('puntata: senza bankroll in %, senza valore nessuna puntata', () => {
  const percentOnly = recommendedStake({ probability: 0.6, odd: 2, settings: settings() });
  assert.equal(percentOnly.stake, null);
  assert.equal(percentOnly.fraction, 0.02);
  assert.equal(percentOnly.hasStake, true);
  assert.deepEqual(recommendedStake({ probability: 0.4, odd: 2, settings: settings({ bankroll: 500 }) }), { kellyFraction: 0, fraction: 0, stake: 0, hasStake: false });
  assert.equal(recommendedStake({ probability: 0.51, odd: 2, settings: settings({ bankroll: 10 }) }).hasStake, false, 'sotto 0,25 € arrotonda a zero');
  assert.deepEqual(recommendedStake({ probability: 0.5, odd: null, settings: settings({ bankroll: 500 }) }), { kellyFraction: null, fraction: null, stake: null, hasStake: false });
});

test('mercati: kellyFraction accanto a quota ed EV', () => {
  const result = buildRecommendation({ '1': 0.6, X: 0.25, '2': 0.15, '1X': 0.85, X2: 0.4, GOAL: 0.5, NO_GOAL: 0.5, OVER_1_5: 0.7, UNDER_1_5: 0.3, OVER_2_5: 0.5, UNDER_2_5: 0.5 }, { values: { '1': 2, X: 3.4, '2': 4 } }, 70);
  const home = result.candidates.find((item) => item.key === '1');
  near(home.kellyFraction, 0.2);
  assert.equal(result.candidates.find((item) => item.key === 'GOAL').kellyFraction, null);
});
