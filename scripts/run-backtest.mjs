// Esegue il banco di prova: pesi stimati sull'addestramento (stagione 2025), verifica sulla 2026, regole della spec.
// Scrive src/prediction/ensembleWeights.js e docs/backtest/2026-10-11-report.md.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../src/configCore.js';
import { buildHistoricalBundles } from '../src/backtest/historicalBundles.js';
import { chooseDrawBase, chooseValueThresholds, collectRows, decideElo, fitWeights, scoreRows, valueSignals, withEloSource } from '../src/backtest/evaluate.js';
import { DEFAULT_ENSEMBLE } from '../src/prediction/ensembleWeights.js';
import { mixOutcomes } from '../src/prediction/engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data/backtest');
const matches = fs.readdirSync(dir).filter((file) => file.endsWith('.json')).flatMap((file) => JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
const config = buildConfig({ DEMO_MODE: 'false', DATA_PROVIDER: 'espn', MONTE_CARLO_RUNS: '10000' });
const rows = collectRows(buildHistoricalBundles(matches), config);
const train = rows.filter((row) => row.seasonYear === 2025);
const testRows = rows.filter((row) => row.seasonYear === 2026);
if (testRows.length < 300) { console.error(`Solo ${testRows.length} partite di verifica (< 300): pesi non aggiornati.`); process.exit(2); }

const current = Object.fromEntries(Object.entries(DEFAULT_ENSEMBLE.weights).map(([id, value]) => [id, value / 100]));
const ids = ['poisson', 'montecarlo', 'market', 'form', 'h2h'];
const fitted = fitWeights(train, ids).weights;
const drawBase = chooseDrawBase(train);
const trainElo = withEloSource(train, drawBase);
const testElo = withEloSource(testRows, drawBase);
const fittedElo = fitWeights(trainElo, [...ids, 'elo']).weights;
const metrics = {
  current: scoreRows(testRows, current),
  fitted: scoreRows(testRows, fitted),
  fittedWithElo: scoreRows(testElo, fittedElo),
  market: scoreRows(testRows, { market: 1 })
};
const useElo = decideElo(metrics.fittedWithElo, metrics.fitted);
const production = useElo ? fittedElo : { ...fitted, elo: 0 };
const evalRows = useElo ? testElo : testRows;
const thresholds = chooseValueThresholds(evalRows, production, DEFAULT_ENSEMBLE.valueThresholds);
const valueBefore = valueSignals(testRows, current, 0.025, 0.03);
const valueAfter = valueSignals(evalRows, production, thresholds.edge, thresholds.ev);
const underdogGap = (weights, set) => {
  const gaps = [];
  for (const row of set) {
    if (!row.market || !row.odds) continue;
    const p = mixOutcomes(row.sources, weights);
    if (!p) continue;
    for (const [key, sign] of [['home', '1'], ['draw', 'X'], ['away', '2']]) if (Number(row.odds[sign]) >= 3) gaps.push(p[key] - row.market[key]);
  }
  return gaps.length ? gaps.reduce((sum, value) => sum + value, 0) / gaps.length : null;
};
const gapBefore = underdogGap(current, testRows);
const gapAfter = underdogGap(production, evalRows);
const toPercent = (weights) => Object.fromEntries(['poisson', 'montecarlo', 'market', 'form', 'provider', 'h2h', 'elo'].map((id) => [id, Math.round((weights[id] || 0) * 1000) / 10]));
const ensemble = {
  version: 'dati-2026-10-11',
  generatedAt: new Date().toISOString(),
  trainSeason: 2025,
  testSeason: 2026,
  matches: { train: train.length, test: testRows.length },
  weights: toPercent(production),
  eloDrawBase: drawBase,
  valueThresholds: { edge: thresholds.edge, ev: thresholds.ev },
  metrics: { ...metrics, useElo, valueBefore, valueAfter, underdogGap: { before: gapBefore, after: gapAfter }, thresholdReason: thresholds.reason }
};
const file = path.join(root, 'src/prediction/ensembleWeights.js');
const source = fs.readFileSync(file, 'utf8');
const marker = 'export const ENSEMBLE = DEFAULT_ENSEMBLE;';
if (!source.includes(marker) && !source.includes('export const ENSEMBLE = Object.freeze(')) throw new Error('ensembleWeights.js: marcatore non trovato');
const replaced = source.replace(/export const ENSEMBLE = (DEFAULT_ENSEMBLE|Object\.freeze\([\s\S]*?\));\n/, `export const ENSEMBLE = Object.freeze(${JSON.stringify(ensemble, null, 2)});\n`);
fs.writeFileSync(file, replaced);
const fmt = (value) => (value == null ? '—' : value.toFixed(4));
const table = (name, m) => `| ${name} | ${m.n} | ${fmt(m.brier)} | ${fmt(m.logLoss)} | ${fmt(m.rps)} | ${m.accuracy == null ? '—' : (m.accuracy * 100).toFixed(1) + '%'} |`;
const report = `# Banco di prova storico — ${new Date().toISOString().slice(0, 10)}\n\nAddestramento: stagione 2025 (${train.length} partite). Verifica: stagione 2026 (${testRows.length} partite), mai vista dalla stima.\n\n| Configurazione (verifica) | N | Brier | Log loss | RPS | Accuratezza |\n|---|---|---|---|---|---|\n${table('Pesi attuali (manuali)', metrics.current)}\n${table('Pesi stimati senza Elo', metrics.fitted)}\n${table('Pesi stimati con Elo', metrics.fittedWithElo)}\n${table('Solo mercato', metrics.market)}\n\nElo nella media: **${useElo ? 'sì' : 'no'}** (regola: almeno 0,002 di log loss in meno). drawBase Elo: ${drawBase}.\n\nPesi di produzione (%): ${JSON.stringify(ensemble.weights)}\n\nSegnale "Valore" sulla verifica: prima ${valueBefore.signals} segnali, ROI ${valueBefore.roi == null ? '—' : (valueBefore.roi * 100).toFixed(1) + '%'}; dopo ${valueAfter.signals} segnali, ROI ${valueAfter.roi == null ? '—' : (valueAfter.roi * 100).toFixed(1) + '%'}. Soglie: edge ${thresholds.edge}, EV ${thresholds.ev} — ${thresholds.reason}\n\nScostamento medio motore − mercato sugli esiti con quota ≥ 3: prima ${gapBefore == null ? '—' : (gapBefore * 100).toFixed(1) + ' pp'}, dopo ${gapAfter == null ? '—' : (gapAfter * 100).toFixed(1) + ' pp'}.\n\nDifferenze dichiarate rispetto al dal vivo: forma recente solo di campionato (dal vivo anche coppe); quote di chiusura (dal vivo quote attuali).\n`;
fs.mkdirSync(path.join(root, 'docs/backtest'), { recursive: true });
fs.writeFileSync(path.join(root, 'docs/backtest/2026-10-11-report.md'), report);
console.log(report);
