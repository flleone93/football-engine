#!/usr/bin/env node
// Snapshot live con dati reali ESPN (nessuna chiave richiesta):
// 1. acquisisce calendario, classifiche, forma, scontri diretti, notizie e quote dei prossimi giorni;
// 2. regola nel registro persistente data/live-predictions.jsonl le previsioni passate con il risultato al 90';
// 3. registra la previsione deterministica pre-partita di ogni gara (tracciamento in avanti, senza look-ahead);
// 4. genera dist/live-snapshot.json, la pagina offline dist/football-engine-live.html
//    e il contenuto Artifact dist/artifact/football-engine-live.html (agenti AI eseguiti da Claude).
import path from 'node:path';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { APP_VERSION } from '../src/api.js';
import { buildConfig } from '../src/configCore.js';
import { runHybridAnalysis } from '../src/hybridEngine.js';
import { isNeutralFixture } from '../src/prediction/topPicks.js';
import { ESPN_LEAGUES, EspnProvider } from '../src/providers/espn.js';
import { JsonlLedgerStorage } from '../src/tracking/fileStorage.js';
import { PredictionLedger } from '../src/tracking/predictionLedger.js';
import { bundleModules, inlineJson, renderPage, root, writeOutput } from './lib/bundler.mjs';

const days = Math.min(14, Math.max(1, Number(process.env.SNAPSHOT_DAYS) || 7));
const config = buildConfig({ ...process.env, DEMO_MODE: 'false', DATA_PROVIDER: 'espn', AI_MODE: 'off', MATCH_DAYS_AHEAD: String(days) });
const provider = new EspnProvider(config);
const aiOrchestrator = new HybridAiOrchestrator(config);

async function mapLimited(items, limit, mapper) {
  const results = new Array(items.length);
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await mapper(items[index], index);
    }
  }));
  return results;
}

const startedAt = Date.now();
console.log(`Acquisizione ESPN: ${ESPN_LEAGUES.length} competizioni, ${days} giorni…`);
const fixtures = await provider.getFixtures({ days, force: true });
const errors = [];
const bundles = {};
await mapLimited(fixtures, 4, async (fixture) => {
  try {
    bundles[fixture.id] = await provider.getAnalysisBundle(fixture.id, { force: true });
  } catch (error) {
    errors.push({ fixtureId: fixture.id, match: `${fixture.home.name} - ${fixture.away.name}`, message: error.message });
  }
});
const analyzedFixtures = fixtures.filter((fixture) => bundles[fixture.id]);
console.log(`Partite: ${fixtures.length} trovate, ${analyzedFixtures.length} con dati completi, ${errors.length} errori.`);

const storage = new JsonlLedgerStorage(path.join(root, process.env.LIVE_LEDGER_PATH || 'data/live-predictions.jsonl'));
const ledger = new PredictionLedger({ storage, settlementDelayMinutes: config.predictionLedger.settlementDelayMinutes });
const due = ledger.pendingFixtureIds();
let settled = 0;
await mapLimited(due, 4, async (fixtureId) => {
  try {
    if (ledger.settle(fixtureId, await provider.getFixtureResult(fixtureId))) settled += 1;
  } catch {
    // Il risultato verrà ricercato allo snapshot successivo.
  }
});
console.log(`Registro: ${due.length} risultati cercati, ${settled} acquisiti.`);

let recorded = 0;
for (const fixture of analyzedFixtures) {
  const analysis = await runHybridAnalysis({ bundle: bundles[fixture.id], options: { neutral: isNeutralFixture(fixture) }, config, aiOrchestrator, useAi: false });
  if (ledger.record(analysis)) recorded += 1;
}
const stats = ledger.stats();
console.log(`Registro: ${recorded} previsioni registrate · ${stats.fixturesTracked} partite tracciate · ${stats.settled} regolate.`);

const snapshot = {
  schemaVersion: 1,
  appVersion: APP_VERSION,
  generatedAt: new Date().toISOString(),
  source: 'ESPN',
  sourceUrl: 'https://www.espn.com/soccer/',
  bookmaker: 'DraftKings via ESPN',
  leagues: ESPN_LEAGUES.map(({ slug, name, country }) => ({ slug, name, country })),
  fixtures: analyzedFixtures,
  bundles,
  results: {},
  errors,
  ledgerEvents: storage.load()
};
writeOutput('dist/live-snapshot.json', JSON.stringify(snapshot));

const { source, moduleCount } = bundleModules(path.join(root, 'src/browser/liveEntry.js'));
const prelude = `globalThis.__FOOTBALL_SNAPSHOT__ = ${inlineJson(snapshot)};`;
const comment = `Snapshot live ESPN ${snapshot.generatedAt}: ${analyzedFixtures.length} partite reali. Generato da scripts/build-live-snapshot.mjs.`;
const fileHtml = renderPage({ bundle: source, prelude, title: 'Enterprise Football Engine Live', comment });
const artifactHtml = renderPage({ bundle: source, prelude, variant: 'artifact', title: 'Enterprise Football Engine', comment });
writeOutput('dist/football-engine-live.html', fileHtml);
writeOutput('dist/artifact/football-engine-live.html', artifactHtml);
console.log(`Pagine generate (${moduleCount} moduli): dist/football-engine-live.html ${(fileHtml.length / 1024).toFixed(0)} KB · dist/artifact/football-engine-live.html ${(artifactHtml.length / 1024).toFixed(0)} KB · ${((Date.now() - startedAt) / 1000).toFixed(1)} s`);
