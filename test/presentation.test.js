import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { formFromRecent, oddsMovementFromOdds, scoreGridFromMatrix } from '../src/prediction/presentation.js';
import { scoreMatrix } from '../src/prediction/probability.js';
import { DemoProvider } from '../src/providers/demo.js';

test('forma: lettere dai risultati recenti, massimo cinque', () => {
  assert.deepEqual(formFromRecent({ results: ['W 2-1 casa vs A', 'L 0-2 trasferta vs B', 'D 1-1 casa vs C'] }), ['W', 'L', 'D']);
  assert.deepEqual(formFromRecent({ results: ['W', 'W', 'W', 'L', 'D', 'W'] }), ['W', 'W', 'W', 'L', 'D']);
  assert.deepEqual(formFromRecent(null), []);
});

test('griglia risultati: 6x6 normalizzata con resto', () => {
  const grid = scoreGridFromMatrix(scoreMatrix(1.4, 1.1));
  assert.equal(grid.size, 6);
  assert.equal(grid.cells.length, 6);
  assert.ok(grid.cells.every((row) => row.length === 6));
  const total = grid.cells.flat().reduce((sum, value) => sum + value, 0) + grid.other;
  assert.ok(Math.abs(total - 1) < 1e-6);
  assert.ok(grid.cells[1][1] > grid.cells[5][5]);
});

test('movimento quote: solo con apertura, variazione in punti percentuali implicita', () => {
  assert.equal(oddsMovementFromOdds({ values: { 1: 2 } }), null);
  const movement = oddsMovementFromOdds({ bookmaker: 'DraftKings via ESPN', values: { 1: 2.45, X: 3.45, 2: 2.65 }, opening: { 1: 2.45, X: 3.35, 2: 2.55 } });
  assert.equal(movement.bookmaker, 'DraftKings via ESPN');
  assert.deepEqual(movement.items.map((item) => item.key), ['1', 'X', '2']);
  const draw = movement.items.find((item) => item.key === 'X');
  assert.equal(draw.open, 3.35);
  assert.equal(draw.current, 3.45);
  assert.ok(draw.impliedChangePp < 0, 'quota salita = probabilità implicita scesa');
});

test('workflow onesto: niente moduli finti, stati espliciti', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-mls');
  bundle.sourceStatus.referee = { available: false, error: 'Arbitro non fornito dalla fonte gratuita.' };
  bundle.fixture.referee = null;
  bundle.weather = { city: 'Miami', temperatureC: 29, precipitationMm: 0, precipitationProbability: 20, windKmh: 14, retrievedAt: 'x', source: 'Open-Meteo' };
  bundle.sourceStatus.weather = { available: true, error: null };
  const analysis = analyzeMatch(bundle, {}, buildConfig({ DEMO_MODE: 'true' }));
  const names = analysis.workflow.map((item) => item.name);
  assert.ok(!names.includes('Machine Learning'));
  assert.ok(!names.includes('Bayesian Update'));
  assert.ok(!names.includes('Player Availability & Impact AI'));
  assert.ok(names.includes('Lineups & Tactical AI'));
  const weather = analysis.workflow.find((item) => item.name === 'Weather & Pitch');
  assert.equal(weather.status, 'active');
  assert.match(weather.note, /29°C/);
  const referee = analysis.workflow.find((item) => item.name === 'Referee');
  assert.equal(referee.status, 'unavailable_source');
  assert.match(referee.note, /fonte gratuita/);
  assert.ok(analysis.workflow.every((item) => ['active', 'inactive', 'unavailable_source'].includes(item.status)));
  assert.equal(analysis.context.weather.city, 'Miami');
  assert.equal(analysis.scoreGrid.size, 6);
  assert.ok(Array.isArray(analysis.context.form.home));
});

test('modello esterno non fornito dalla fonte: motivo esplicito', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-mls');
  bundle.prediction = null;
  bundle.sourceStatus.prediction = { available: false, error: 'Nessuna previsione esterna nella fonte pubblica.' };
  const analysis = analyzeMatch(bundle, {}, buildConfig({ DEMO_MODE: 'true' }));
  const external = analysis.agents.find((agent) => agent.id === 'provider');
  assert.equal(external.active, false);
  assert.equal(external.unavailableReason, 'Nessuna previsione esterna nella fonte pubblica.');
  assert.equal(analysis.agents.find((agent) => agent.id === 'poisson').unavailableReason, null);
});
