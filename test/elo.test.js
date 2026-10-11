import assert from 'node:assert/strict';
import test from 'node:test';
import { computeElo, eloExpectation, eloForFixture } from '../src/prediction/elo.js';

const match = (date, homeId, awayId, homeGoals, awayGoals, neutral = false) => ({ date, homeId, awayId, homeGoals, awayGoals, neutral });

test('Elo: valori noti con K=20 e vantaggio casa 60', () => {
  const expected = 1 / (1 + 10 ** (-60 / 400));
  assert.ok(Math.abs(eloExpectation(1500, 1500) - expected) < 1e-12);
  const ratings = computeElo([match('2026-09-01', 'A', 'B', 2, 0)]);
  assert.ok(Math.abs(ratings.get('A').rating - (1500 + 20 * (1 - expected))) < 1e-9);
  assert.ok(Math.abs(ratings.get('B').rating - (1500 - 20 * (1 - expected))) < 1e-9);
  assert.equal(ratings.get('A').games, 1);
});

test('Elo: pareggio, ordine cronologico e somma costante', () => {
  const ratings = computeElo([match('2026-09-08', 'B', 'A', 1, 1), match('2026-09-01', 'A', 'B', 0, 1)]);
  const afterFirst = 1500 + 20 * eloExpectation(1500, 1500);
  assert.ok(ratings.get('B').rating < afterFirst, 'B vince fuori, poi pareggia in casa da favorita e perde punti');
  assert.ok(ratings.get('B').rating > 1500);
  assert.ok(Math.abs(ratings.get('A').rating + ratings.get('B').rating - 3000) < 1e-9);
});

test('Elo: campo neutro senza vantaggio casa', () => {
  assert.equal(eloExpectation(1500, 1500, { neutral: true }), 0.5);
  const ratings = computeElo([match('2026-09-01', 'A', 'B', 1, 0, true)]);
  assert.ok(Math.abs(ratings.get('A').rating - 1510) < 1e-9);
});

test('Elo per la partita: squadra senza partite a 1500, nessun crash', () => {
  const elo = eloForFixture([match('2026-09-01', 'A', 'B', 3, 1)], { homeId: 'A', awayId: 'NUOVA', neutral: false });
  assert.equal(elo.away.rating, 1500);
  assert.equal(elo.away.games, 0);
  assert.equal(elo.matches, 1);
  assert.ok(elo.expectedHome > 0.5 && elo.expectedHome < 1);
  assert.equal(eloForFixture([], { homeId: 'X', awayId: 'Y' }).matches, 0);
});
