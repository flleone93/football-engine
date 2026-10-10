import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoProvider } from '../src/providers/demo.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { buildTopPicks, isNeutralFixture } from '../src/prediction/topPicks.js';

const testConfig = { demoMode: true, monteCarloRuns: 10000 };
const localDate = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(value));

async function buildAnalyses() {
  const provider = new DemoProvider();
  const fixtures = await provider.getFixtures();
  const analyses = [];
  for (const fixture of fixtures) {
    const bundle = await provider.getAnalysisBundle(fixture.id);
    analyses.push(analyzeMatch(bundle, { neutral: isNeutralFixture(fixture) }, testConfig));
  }
  return analyses;
}

test('genera una Top 7 giornaliera con quote e una sola selezione per partita', async () => {
  const provider = new DemoProvider();
  const allFixtures = await provider.getFixtures();
  const date = localDate(allFixtures.find((fixture) => fixture.id === 'demo-france-spain').kickoff);
  const fixtures = await provider.getFixturesByDate(date);
  const analyses = [];
  for (const fixture of fixtures) {
    const bundle = await provider.getAnalysisBundle(fixture.id);
    analyses.push(analyzeMatch(bundle, { neutral: isNeutralFixture(fixture) }, testConfig));
  }
  const result = buildTopPicks({ analyses, date, limit: 7, stake: 25, scannedFixtures: fixtures.length, bookmaker: 'Bet365 Italia' });
  assert.equal(result.picks.length, 7);
  assert.equal(new Set(result.picks.map((pick) => pick.fixture.id)).size, 7);
  assert.ok(result.picks.every((pick) => pick.selection.odd > 1));
  assert.ok(result.picks.every((pick) => pick.selection.probability > 0 && pick.selection.probability < 1));
  assert.equal(result.simulation.stake, 25);
  assert.ok(result.simulation.accumulator.combinedOdd > 1);
  assert.ok(result.simulation.accumulator.potentialGrossReturn > 25);
});

test('la simulazione singole ripartisce l’importo sul numero di selezioni', async () => {
  const provider = new DemoProvider();
  const fixtures = await provider.getFixtures();
  const analyses = [];
  for (const fixture of fixtures.slice(0, 5)) {
    const bundle = await provider.getAnalysisBundle(fixture.id);
    analyses.push(analyzeMatch(bundle, { neutral: isNeutralFixture(fixture) }, testConfig));
  }
  const result = buildTopPicks({ analyses, date: '2026-07-14', limit: 5, stake: 50 });
  assert.equal(result.picks.length, 5);
  assert.equal(result.simulation.singles.stakePerSelection, 10);
  assert.equal(result.coverage.complete, true);
});

test('i quality gate possono restituire meno pick senza riempimento artificiale', async () => {
  const analyses = await buildAnalyses();
  const result = buildTopPicks({
    analyses,
    date: '2026-07-14',
    limit: 7,
    stake: 10,
    eligibilityPolicy: { minProbability: 0.99, minConfidence: 99, minDataQuality: 99, requirePositiveEv: true }
  });
  assert.equal(result.picks.length, 0);
  assert.equal(result.coverage.complete, false);
});
