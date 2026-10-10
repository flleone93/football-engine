import test from 'node:test';
import assert from 'node:assert/strict';
import { publicSourceSnapshot } from '../src/provenance.js';

test('una risposta fallback non viene dichiarata come dato osservato', () => {
  const snapshot = publicSourceSnapshot({
    fixture: { id: 1 },
    homeStats: {}, awayStats: {}, recentHome: {}, recentAway: {},
    injuries: { home: [], away: [] },
    lineups: { confirmed: false, home: [], away: [] },
    odds: { values: {} },
    competitionRules: null,
    sourceStatus: {
      homeStats: { available: false }, awayStats: { available: false },
      recentHome: { available: false }, recentAway: { available: false },
      injuries: { available: false }, lineups: { available: false }, odds: { available: false }
    },
    sourceErrors: ['upstream unavailable']
  });
  assert.equal(snapshot.observed.fixture, true);
  assert.equal(snapshot.observed.seasonStatistics, false);
  assert.equal(snapshot.observed.recentForm, false);
  assert.equal(snapshot.observed.injuries, false);
  assert.equal(snapshot.observed.lineups, false);
  assert.equal(snapshot.observed.odds, false);
  assert.deepEqual(snapshot.errors, ['upstream unavailable']);
});
