// Entry point della demo standalone: esegue nel browser lo stesso motore e le stesse API del server Node,
// intercettando le chiamate fetch('/api/...') del frontend. Nessun server, nessuna rete, nessuna chiave.
import { HybridAiOrchestrator } from '../ai/orchestrator.js';
import { APP_VERSION, createApi } from '../api.js';
import { TTLCache } from '../cache.js';
import { buildConfig, validateConfigObject } from '../configCore.js';
import { DemoProvider } from '../providers/demo.js';
import { PredictionLedger } from '../tracking/predictionLedger.js';
import { installApiFetch } from './fetchShim.js';

const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off', TIMEZONE: 'Europe/Rome', BOOKMAKER_NAME: 'Bet365' });
validateConfigObject(config);

const provider = new DemoProvider();
const aiOrchestrator = new HybridAiOrchestrator(config);
const analysisCache = new TTLCache(config.cacheTtlMs, config.cacheMaxEntries);
const ledger = new PredictionLedger({ settlementDelayMinutes: config.predictionLedger.settlementDelayMinutes });
const api = createApi({ config, provider, aiOrchestrator, analysisCache, ledger });

installApiFetch(api);
globalThis.__FOOTBALL_ENGINE_STANDALONE__ = { config, api, version: APP_VERSION, variant: 'demo' };
