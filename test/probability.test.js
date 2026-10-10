import test from 'node:test';
import assert from 'node:assert/strict';
import { calibrateMatrixToOutcomes, marketsFromMatrix, outcomesFromMatrix, scoreMatrix } from '../src/prediction/probability.js';

test('la matrice dei risultati è normalizzata', () => {
  const matrix = scoreMatrix(1.48, 1.15);
  const total = matrix.reduce((sum, item) => sum + item.probability, 0);
  assert.ok(Math.abs(total - 1) < 1e-9);
  const outcomes = outcomesFromMatrix(matrix);
  assert.ok(Math.abs(outcomes.home + outcomes.draw + outcomes.away - 1) < 1e-9);
});

test('la calibrazione rispetta il target 1X2', () => {
  const target = { home: 0.43, draw: 0.29, away: 0.28 };
  const calibrated = calibrateMatrixToOutcomes(scoreMatrix(1.48, 1.15), target);
  const outcomes = outcomesFromMatrix(calibrated);
  assert.ok(Math.abs(outcomes.home - target.home) < 1e-9);
  assert.ok(Math.abs(outcomes.draw - target.draw) < 1e-9);
  assert.ok(Math.abs(outcomes.away - target.away) < 1e-9);
});

test('i mercati complementari sommano a uno', () => {
  const markets = marketsFromMatrix(scoreMatrix(1.6, 1.2));
  assert.ok(Math.abs(markets.GOAL + markets.NO_GOAL - 1) < 1e-6);
  assert.ok(Math.abs(markets.OVER_2_5 + markets.UNDER_2_5 - 1) < 1e-6);
  assert.ok(Math.abs(markets.OVER_1_5 + markets.UNDER_1_5 - 1) < 1e-6);
});
