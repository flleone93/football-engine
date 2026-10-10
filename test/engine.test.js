import test from 'node:test';
import assert from 'node:assert/strict';
import { DemoProvider } from '../src/providers/demo.js';
import { analyzeMatch, inferLambdas } from '../src/prediction/engine.js';

const testConfig = { demoMode: true, monteCarloRuns: 10000 };

test('il motore produce un output completo e coerente', async () => {
  const provider = new DemoProvider();
  const bundle = await provider.getAnalysisBundle('demo-france-spain');
  const result = analyzeMatch(bundle, { neutral: true }, testConfig);
  const outcomes = result.summary.outcomes;
  assert.ok(Math.abs(outcomes.home + outcomes.draw + outcomes.away - 1) < 1e-6);
  assert.equal(result.exactScores.length, 10);
  assert.ok(result.exactScores.every((score) => ['1', 'X', '2'].includes(score.outcome)));
  assert.ok(result.exactScores.every((score) => score.contributionToOutcome > 0 && score.contributionToOutcome <= 1));
  assert.equal(result.scenarios.length, 3);
  assert.ok(result.summary.confidence >= 25 && result.summary.confidence <= 100);
  assert.ok(['1', 'X', '2', '1X', 'X2', 'GOAL', 'NO_GOAL', 'OVER_1_5', 'UNDER_1_5', 'OVER_2_5', 'UNDER_2_5'].includes(result.summary.recommendation.key));
  assert.equal(result.simulation.runs, 10000);
  assert.equal(result.progression.applicable, true);
  assert.ok(Math.abs(result.progression.qualification.home + result.progression.qualification.away - 1) < 1e-6);
  assert.equal(result.progression.extraTime, outcomes.draw);
  assert.ok(result.progression.penalties <= result.progression.extraTime);
  assert.ok(result.timeline.first15Goal >= 0 && result.timeline.first15Goal <= 1);
  assert.ok(result.summary.uncertainty.normalizedEntropy >= 0 && result.summary.uncertainty.normalizedEntropy <= 1);
});

test('le probabilita di qualificazione non vengono inventate nei campionati', async () => {
  const provider = new DemoProvider();
  const bundle = await provider.getAnalysisBundle('demo-flamengo-palmeiras');
  const result = analyzeMatch(bundle, { neutral: false }, testConfig);
  assert.equal(result.progression.applicable, false);
  assert.equal(result.progression.reason, 'not_knockout');
});

test('tutte le partite demo sono analizzabili', async () => {
  const provider = new DemoProvider();
  const fixtures = await provider.getFixtures();
  for (const fixture of fixtures) {
    const bundle = await provider.getAnalysisBundle(fixture.id);
    const result = analyzeMatch(bundle, { neutral: false }, testConfig);
    assert.equal(result.fixture.id, fixture.id);
    assert.ok(Number.isFinite(result.summary.xg.home));
    assert.ok(Number.isFinite(result.summary.xg.away));
  }
});

test('gli scontri diretti non superano il 7% effettivo', async () => {
  const provider = new DemoProvider();
  const bundle = await provider.getAnalysisBundle('demo-france-spain');
  bundle.odds = null;
  bundle.prediction = null;
  bundle.recentHome = null;
  bundle.recentAway = null;
  bundle.h2h = { matches: 10, home: 8, draw: 1, away: 1 };
  const result = analyzeMatch(bundle, { neutral: true }, testConfig);
  const h2h = result.agents.find((agent) => agent.id === 'h2h');
  assert.ok(h2h.effectiveWeight <= 0.07 + 1e-6);
});

test('le medie goal pari a zero restano dati validi', async () => {
  const provider = new DemoProvider();
  const bundle = await provider.getAnalysisBundle('demo-france-spain');
  bundle.homeStats = { ...bundle.homeStats, played: 20, goalsForHome: 0, goalsForTotal: 0 };
  bundle.awayStats = { ...bundle.awayStats, played: 20, goalsAgainstAway: 0, goalsAgainstTotal: 0 };
  bundle.recentHome = null;
  bundle.recentAway = null;
  const lambdas = inferLambdas(bundle, false);
  assert.equal(lambdas.home, 0.25);
});
