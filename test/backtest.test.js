import assert from 'node:assert/strict';
import test from 'node:test';
import { buildHistoricalBundles } from '../src/backtest/historicalBundles.js';

const match = (id, date, homeId, awayId, homeGoals, awayGoals, extra = {}) => ({ id, slug: 'ita.1', leagueName: 'Serie A', seasonYear: 2025, date, homeId, awayId, homeName: `T${homeId}`, awayName: `T${awayId}`, homeGoals, awayGoals, neutral: false, odds: { '1': 2, X: 3.3, '2': 3.8 }, ...extra });
const season = [
  match('1', '2025-08-20T18:00:00Z', 'A', 'B', 2, 0),
  match('2', '2025-08-27T18:00:00Z', 'B', 'C', 1, 1),
  match('3', '2025-09-03T18:00:00Z', 'C', 'A', 0, 3),
  match('4', '2025-09-10T18:00:00Z', 'A', 'B', 1, 2)
];

test('ricostruzione: solo partite precedenti, forma uguale al vivo', () => {
  const rows = buildHistoricalBundles(season);
  assert.deepEqual(rows.map((row) => row.match.id), ['1', '2', '3', '4']);
  const first = rows[0].bundle;
  assert.equal(first.homeStats, null, 'debutto: nessuna statistica');
  assert.equal(first.recentHome, null);
  assert.equal(first.elo.home.rating, 1500);
  const last = rows[3].bundle;
  assert.deepEqual([last.homeStats.played, last.homeStats.goalsForTotal, last.homeStats.goalsAgainstTotal], [2, 2.5, 0]);
  assert.equal(last.homeStats.goalsForHome, null, 'come dal vivo: niente divisione casa/trasferta');
  assert.deepEqual([last.recentHome.matches, last.recentHome.wins, last.recentHome.ppg], [2, 2, 3]);
  assert.equal(last.recentHome.restDays, 7);
  assert.deepEqual([last.h2h.matches, last.h2h.home, last.h2h.away], [1, 1, 0]);
  assert.deepEqual(last.odds.values, { '1': 2, X: 3.3, '2': 3.8 });
  assert.equal(last.fixture.status, 'NS');
  assert.equal(last.elo.matches, 3);
});

test('ricostruzione: nessun dato dal futuro (cambiare il risultato non cambia il bundle della stessa partita)', () => {
  const original = buildHistoricalBundles(season)[3].bundle;
  const altered = buildHistoricalBundles(season.map((item) => (item.id === '4' ? { ...item, homeGoals: 9, awayGoals: 0 } : item)))[3].bundle;
  assert.deepEqual(altered, original);
});

test('ricostruzione: stagioni e campionati separati, partita senza quote', () => {
  const rows = buildHistoricalBundles([
    match('a', '2025-08-20T18:00:00Z', 'A', 'B', 2, 0),
    match('b', '2025-08-21T18:00:00Z', 'A', 'B', 0, 0, { slug: 'eng.1', leagueName: 'Premier League' }),
    match('c', '2026-08-20T18:00:00Z', 'A', 'B', 1, 0, { seasonYear: 2026, odds: null })
  ]);
  const byId = Object.fromEntries(rows.map((row) => [row.match.id, row.bundle]));
  assert.equal(byId.b.homeStats, null, 'altro campionato: nessuna storia');
  assert.equal(byId.c.homeStats, null, 'nuova stagione: si riparte');
  assert.equal(byId.c.odds, null);
});
