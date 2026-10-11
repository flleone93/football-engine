// Entry point dell'app iPhone (PWA): tutto gira sul dispositivo.
// Dati reali ESPN in diretta (CORS aperto), motore deterministico completo, agenti AI Gemini/OpenAI con la chiave
// dell'utente salvata solo sul telefono (Anthropic Claude consigliato, oppure Gemini/OpenAI), registro previsioni persistente in IndexedDB con regolazione automatica.
import { HybridAiOrchestrator } from '../ai/orchestrator.js';
import { APP_VERSION, createApi } from '../api.js';
import { TTLCache } from '../cache.js';
import { buildConfig, validateConfigObject } from '../configCore.js';
import { isNeutralFixture } from '../prediction/topPicks.js';
import { ESPN_LEAGUES, EspnProvider } from '../providers/espn.js';
import { BetJournal } from '../tracking/betJournal.js';
import { PredictionLedger } from '../tracking/predictionLedger.js';
import { installApiFetch } from './fetchShim.js';
import { openIdbLedgerStorage } from './idbLedgerStorage.js';

const SETTINGS_KEY = 'football-engine-settings-v1';
const TRACK_KEY = 'football-engine-last-autotrack';
const DEFAULT_SETTINGS = Object.freeze({
  // Claude è il provider consigliato: senza chiave gli agenti restano spenti e lavora il motore statistico.
  aiProvider: 'anthropic',
  apiKey: '',
  aiMode: 'active',
  daysAhead: 5,
  leagues: ESPN_LEAGUES.map((league) => league.slug),
  autoTrack: true
});

function readSettings() {
  try {
    const stored = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    return { ...DEFAULT_SETTINGS, ...stored };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(next) {
  const clean = {
    aiProvider: ['off', 'anthropic', 'gemini', 'openai'].includes(next.aiProvider) ? next.aiProvider : 'off',
    apiKey: String(next.apiKey || '').trim(),
    aiMode: ['active', 'shadow'].includes(next.aiMode) ? next.aiMode : 'active',
    daysAhead: Math.min(7, Math.max(1, Number(next.daysAhead) || 5)),
    leagues: (Array.isArray(next.leagues) ? next.leagues : []).filter((slug) => ESPN_LEAGUES.some((league) => league.slug === slug)),
    autoTrack: next.autoTrack !== false
  };
  if (!clean.leagues.length) clean.leagues = DEFAULT_SETTINGS.leagues;
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(clean));
  return clean;
}

const settings = readSettings();
const aiEnabled = settings.aiProvider !== 'off' && settings.apiKey;
// Stime di costo per milione di token del modello predefinito di ciascun provider (limite giornaliero in USD).
const COSTS = {
  anthropic: { input: '4', cached: '0.20', output: '20', timeout: '120000' },
  gemini: { input: '0.30', cached: '0.03', output: '2.50', timeout: '45000' },
  openai: { input: '0', cached: '0', output: '0', timeout: '60000' }
};
const cost = COSTS[settings.aiProvider] || COSTS.gemini;
const config = buildConfig({
  DEMO_MODE: 'false',
  DATA_PROVIDER: 'espn',
  TIMEZONE: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Rome',
  BOOKMAKER_NAME: 'DraftKings via ESPN',
  MATCH_DAYS_AHEAD: String(settings.daysAhead),
  AI_MODE: aiEnabled ? settings.aiMode : 'off',
  AI_PROVIDER: ['anthropic', 'openai'].includes(settings.aiProvider) ? settings.aiProvider : 'gemini',
  ANTHROPIC_API_KEY: settings.aiProvider === 'anthropic' ? settings.apiKey : '',
  GEMINI_API_KEY: settings.aiProvider === 'gemini' ? settings.apiKey : '',
  OPENAI_API_KEY: settings.aiProvider === 'openai' ? settings.apiKey : '',
  AI_REQUEST_TIMEOUT_MS: cost.timeout,
  // Top Picks: ranking deterministico, gli agenti AI girano sulla singola analisi (costi contenuti).
  TOP_PICKS_AI_ENABLED: 'false',
  AI_DAILY_CALL_LIMIT: '120',
  AI_DAILY_COST_LIMIT_USD: '3',
  AI_INPUT_COST_PER_MILLION: cost.input,
  AI_CACHED_INPUT_COST_PER_MILLION: cost.cached,
  AI_OUTPUT_COST_PER_MILLION: cost.output
});
validateConfigObject(config);

const leagues = ESPN_LEAGUES.filter((league) => settings.leagues.includes(league.slug));
const provider = new EspnProvider(config, { leagues });
provider.label = 'ESPN in diretta (dal telefono)';

const ready = (async () => {
  let seedEvents = [];
  try {
    const response = await fetch('seed-ledger.json', { cache: 'no-store' });
    if (response.ok) seedEvents = await response.json();
  } catch {
    // Seed facoltativo: senza rete si parte dal registro locale.
  }
  const storage = await openIdbLedgerStorage({ seedEvents });
  const ledger = new PredictionLedger({ storage, settlementDelayMinutes: config.predictionLedger.settlementDelayMinutes });
  // Diario delle giocate nell'IndexedDB del telefono (in memoria se l'archiviazione è bloccata).
  const journal = new BetJournal({ storage: await openIdbLedgerStorage({ name: 'football-engine-journal' }) });
  const api = createApi({
    config,
    provider,
    aiOrchestrator: new HybridAiOrchestrator(config),
    analysisCache: new TTLCache(config.cacheTtlMs, config.cacheMaxEntries),
    ledger,
    journal
  });
  return { api, ledger };
})();

installApiFetch({ handle: async (request) => (await ready).api.handle(request) });

/**
 * Tracciamento automatico (max ogni 6 ore, all'apertura dell'app): acquisisce i risultati delle previsioni passate
 * e registra la previsione pre-partita deterministica delle gare delle prossime 48 ore. Nessuna chiamata AI.
 */
async function autoTrack({ force = false } = {}) {
  const { api, ledger } = await ready;
  let last = 0;
  try { last = Number(localStorage.getItem(TRACK_KEY)) || 0; } catch { /* nessuna memoria locale */ }
  if (!force && Date.now() - last < 6 * 3600000) return { skipped: true };
  try { localStorage.setItem(TRACK_KEY, String(Date.now())); } catch { /* ignorato */ }
  const settlement = await api.settleDueResults({ force: true });
  const fixtures = (await provider.getFixtures({ days: config.matchDaysAhead }))
    .filter((fixture) => Date.parse(fixture.kickoff) - Date.now() < 48 * 3600000 && Date.parse(fixture.kickoff) > Date.now());
  let recorded = 0;
  for (const fixture of fixtures) {
    try {
      const before = ledger.stats().predictionsLogged;
      await api.analyzeFixture(fixture.id, isNeutralFixture(fixture), { useAi: false });
      if (ledger.stats().predictionsLogged > before) recorded += 1;
    } catch {
      // Una partita non disponibile non blocca le altre.
    }
    await new Promise((resolve) => setTimeout(resolve, 30));
  }
  return { skipped: false, settlement, fixtures: fixtures.length, recorded };
}

globalThis.__FOOTBALL_ENGINE_STANDALONE__ = {
  config,
  version: APP_VERSION,
  variant: 'mobile',
  leagues: ESPN_LEAGUES,
  settings: {
    get: () => ({ ...settings, apiKey: settings.apiKey ? '••••' + settings.apiKey.slice(-4) : '', hasKey: Boolean(settings.apiKey) }),
    save: (next) => {
      const merged = { ...readSettings(), ...next };
      if (next.apiKey === undefined) merged.apiKey = readSettings().apiKey;
      return saveSettings(merged);
    },
    clearKey: () => saveSettings({ ...readSettings(), apiKey: '', aiProvider: 'off' })
  },
  autoTrack
};

if (settings.autoTrack) {
  // Dopo il primo disegno dell'interfaccia, per non rallentare l'apertura.
  setTimeout(() => autoTrack().catch((error) => console.warn('[autotrack]', error)), 4000);
}
