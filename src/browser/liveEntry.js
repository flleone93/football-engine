// Entry point "live snapshot": dati reali ESPN incorporati dalla build (globalThis.__FOOTBALL_SNAPSHOT__),
// motore deterministico completo e, dentro un Artifact claude.ai, i sei agenti AI eseguiti da Claude (capability `sample`).
// Aperto come file locale, senza runtime Claude, gli agenti restano disattivati e vale la sola baseline statistica.
import { HybridAiOrchestrator } from '../ai/orchestrator.js';
import { APP_VERSION, createApi } from '../api.js';
import { TTLCache } from '../cache.js';
import { buildConfig, validateConfigObject } from '../configCore.js';
import { SnapshotProvider } from '../providers/snapshot.js';
import { MemoryLedgerStorage, PredictionLedger } from '../tracking/predictionLedger.js';
import { installApiFetch } from './fetchShim.js';

const snapshot = globalThis.__FOOTBALL_SNAPSHOT__;
const claudeRuntime = typeof globalThis.claude?.use === 'function';

const config = buildConfig({
  DEMO_MODE: 'false',
  DATA_PROVIDER: 'espn',
  TIMEZONE: 'Europe/Rome',
  BOOKMAKER_NAME: 'DraftKings via ESPN',
  AI_MODE: claudeRuntime ? 'active' : 'off',
  AI_PROVIDER: 'claude',
  AI_MAX_CONCURRENCY: '2',
  AI_MAX_INPUT_CHARS: '40000',
  AI_DAILY_CALL_LIMIT: '300',
  // Top Picks: ranking deterministico; gli agenti Claude girano sulla singola analisi richiesta.
  TOP_PICKS_AI_ENABLED: 'false',
  MATCH_DAYS_AHEAD: '7'
});
validateConfigObject(config);

let samplePromise = null;
const sampler = claudeRuntime
  ? async (prompt, options) => {
    samplePromise ||= globalThis.claude.use('sample').catch(() => null);
    const sample = await samplePromise;
    if (!sample) throw Object.assign(new Error('Claude non disponibile in questa vista.'), { code: 'claude_unavailable' });
    return sample.json(prompt, options);
  }
  : null;

const provider = new SnapshotProvider(snapshot, { timezone: config.timezone });
const aiOrchestrator = new HybridAiOrchestrator(config, { sampler });
const analysisCache = new TTLCache(config.cacheTtlMs, config.cacheMaxEntries);
const storage = new MemoryLedgerStorage();
storage.events = Array.isArray(snapshot.ledgerEvents) ? snapshot.ledgerEvents : [];
const ledger = new PredictionLedger({ storage, settlementDelayMinutes: config.predictionLedger.settlementDelayMinutes });
const api = createApi({ config, provider, aiOrchestrator, analysisCache, ledger });

installApiFetch(api);
globalThis.__FOOTBALL_ENGINE_STANDALONE__ = { config, api, version: APP_VERSION, variant: 'live-snapshot', claudeRuntime };
