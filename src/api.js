// Logica applicativa delle API, indipendente dal trasporto HTTP.
// Usata dal server Node (src/server.js) e dalla demo standalone nel browser (src/browser/entry.js).
import { runHybridAnalysis } from './hybridEngine.js';
import { buildDataVersion } from './provenance.js';
import { LABELS } from './prediction/recommendation.js';
import { recommendedStake } from './prediction/staking.js';
import { rankAnalyses, buildTopPicks, isNeutralFixture } from './prediction/topPicks.js';
import { DEFAULT_STAKING, deriveBet, limitStatus, periodLosses, summarize, toNumber } from './tracking/betJournal.js';

export const APP_VERSION = '2.0.0';

export function failValidation(message) {
  const error = new Error(message);
  error.code = 'validation_error';
  return error;
}

export function publicError(error, fallbackStatus = 500) {
  const code = error?.code || '';
  if (code === 'validation_error') return { status: 400, message: error.message };
  if (code === 'not_found') return { status: 404, message: 'Risorsa non trovata.' };
  if (code === 'rate_limited') return { status: 429, message: 'Troppe richieste. Riprova tra poco.' };
  return { status: fallbackStatus, message: fallbackStatus >= 500 ? 'Errore interno. Riprova tra poco.' : error.message };
}

function validateFixtureId(value) {
  const fixtureId = String(value ?? '').trim();
  if (!/^[A-Za-z0-9:._-]{1,100}$/.test(fixtureId)) throw failValidation('fixtureId non valido.');
  return fixtureId;
}

function validateDate(value) {
  const date = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00Z`))) {
    throw failValidation('Data obbligatoria nel formato YYYY-MM-DD.');
  }
  return date;
}

async function mapWithConcurrency(items, concurrency, mapper) {
  const results = new Array(items.length);
  let nextIndex = 0;
  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}

export const EXPENSIVE_ROUTES = new Set(['POST /api/analyze', 'POST /api/top-picks']);

function compactRecord(record) {
  return {
    fixture: record.fixture,
    predictedAt: record.predictedAt,
    source: record.source,
    aiApplied: record.aiApplied,
    outcomes: record.prediction.outcomes,
    marketOutcomes: record.prediction.marketOutcomes,
    xg: record.prediction.xg,
    exactScore: record.prediction.exactScore,
    confidence: record.prediction.confidence,
    recommendation: record.prediction.recommendation,
    result: record.result
  };
}

export function createApi({ config, provider, aiOrchestrator, analysisCache, ledger = null, journal = null }) {
  const topPicksEligibilityPolicy = Object.freeze({
    minProbability: config.topPicksMinProbability,
    minConfidence: config.topPicksMinConfidence,
    minDataQuality: config.topPicksMinDataQuality,
    requirePositiveEv: config.topPicksRequirePositiveEv
  });

  function publicUsageSnapshot() {
    const snapshot = aiOrchestrator.usageSnapshot();
    return {
      provider: snapshot.provider,
      models: snapshot.models,
      day: snapshot.day,
      totals: snapshot.totals,
      pendingTokens: snapshot.pendingTokens,
      pendingEstimatedCostUsd: snapshot.pendingEstimatedCostUsd,
      byAgent: snapshot.byAgent,
      recentErrorCount: snapshot.recentErrors.length
    };
  }

  function cacheKey({ fixtureId, dataVersion, neutral, aiMode, useAi }) {
    return `analysis:v6:${fixtureId}:${dataVersion}:neutral=${Boolean(neutral)}:ai=${useAi ? aiMode : 'off'}:provider=${config.ai.provider}:models=${config.ai.modelDefault}:${config.ai.modelChallenge}:${config.ai.modelExplanation}:limits=${config.ai.maxProbabilityShiftPp}:${config.ai.maxTotalXgDelta}:dedup=${config.ai.duplicateEvidenceScale}`;
  }

  async function analyzeFixture(fixtureId, neutral, { refresh = false, useAi = true, lite = false } = {}) {
    const bundle = await provider.getAnalysisBundle(fixtureId, { force: refresh, lite });
    const dataVersion = buildDataVersion(bundle);
    const key = cacheKey({ fixtureId, dataVersion, neutral, aiMode: aiOrchestrator.effectiveMode(), useAi });
    const result = await analysisCache.getOrCompute(
      key,
      () => runHybridAnalysis({ bundle, options: { neutral }, config, aiOrchestrator, useAi }),
      { refresh }
    );
    recordPrediction(result.value);
    return { ...result.value, cached: result.cacheHit };
  }

  function recordPrediction(analysis) {
    if (!ledger) return;
    try {
      ledger.record(analysis);
    } catch (error) {
      // Il registro non deve mai bloccare la pubblicazione dell'analisi.
      console.error(JSON.stringify({ timestamp: new Date().toISOString(), event: 'ledger_record_error', message: error.message }));
    }
  }

  let demoArchiveSeeding = null;
  async function seedDemoArchive() {
    if (!ledger || typeof provider.getArchive !== 'function' || ledger.hasSource('demo_archive')) return;
    demoArchiveSeeding ||= (async () => {
      for (const item of provider.getArchive()) {
        const analysis = await runHybridAnalysis({ bundle: item.bundle, options: { neutral: false }, config, aiOrchestrator, useAi: false });
        const predictedAt = new Date(Date.parse(item.fixture.kickoff) - 3 * 3600000).toISOString();
        if (ledger.record(analysis, { source: 'demo_archive', predictedAt })) ledger.settle(item.fixture.id, item.result, new Date(Date.parse(item.fixture.kickoff) + 2 * 3600000).toISOString());
      }
    })();
    try {
      await demoArchiveSeeding;
    } finally {
      demoArchiveSeeding = null;
    }
  }

  let settlementRun = null;
  let lastSettlement = null;
  async function settleDueResults({ force = false } = {}) {
    if (!ledger || typeof provider.getFixtureResult !== 'function') return lastSettlement;
    const intervalMs = config.predictionLedger.settlementIntervalMinutes * 60000;
    if (!force && lastSettlement && Date.now() - Date.parse(lastSettlement.at) < intervalMs) return lastSettlement;
    settlementRun ||= (async () => {
      const due = ledger.pendingFixtureIds().slice(0, config.predictionLedger.settlementMaxPerRun);
      let settled = 0;
      let errors = 0;
      await mapWithConcurrency(due, 3, async (fixtureId) => {
        try {
          const result = await provider.getFixtureResult(fixtureId);
          if (ledger.settle(fixtureId, result)) settled += 1;
        } catch {
          errors += 1;
        }
      });
      lastSettlement = { at: new Date().toISOString(), checked: due.length, settled, errors };
      return lastSettlement;
    })();
    try {
      return await settlementRun;
    } finally {
      settlementRun = null;
    }
  }

  async function performanceReport(requestId) {
    if (!ledger) {
      return { enabled: false, mode: provider.mode, message: 'Registro previsioni disattivato (PREDICTION_LEDGER_ENABLED=false).', requestId };
    }
    await seedDemoArchive();
    const settlement = await settleDueResults();
    const official = ledger.officialRecords();
    return {
      enabled: true,
      mode: provider.mode,
      generatedAt: new Date().toISOString(),
      ledger: ledger.stats(),
      settlement,
      evaluation: ledger.evaluate(),
      recent: official.filter((record) => record.result).slice(0, 40).map(compactRecord),
      upcoming: official.filter((record) => !record.result).slice(0, 40).map(compactRecord),
      methodology: {
        officialPrediction: 'Per ogni partita conta l’ultima previsione registrata prima del calcio d’inizio; le analisi successive non entrano nel registro.',
        horizon: '1X2 e mercati goal valutati sul risultato al 90’; supplementari e rigori esclusi.',
        metrics: 'Brier multiclasse (0 ottimo, 2 peggiore), log loss, RPS ordinale, accuratezza dell’esito più probabile, ECE di calibrazione.',
        benchmark: 'Confronto con le probabilità de-vig delle quote 1X2 registrate al momento della previsione e con il modello uniforme 1/3.',
        roi: 'ROI a puntata unitaria sulle indicazioni principali con quota disponibile; non include commissioni, limiti o variazioni di quota.',
        demo: provider.mode === 'demo'
          ? 'Squadre fittizie e risultati simulati da un processo noto solo al generatore. Non rappresenta partite reali.'
          : null
      },
      requestId
    };
  }

  async function buildTopPicksResponse(body) {
    const date = validateDate(body.date);
    const limit = Number(body.limit);
    const stake = Number(body.stake);
    if (![5, 6, 7].includes(limit)) throw failValidation('limit deve essere 5, 6 oppure 7.');
    if (!Number.isFinite(stake) || stake < 1 || stake > 10000) throw failValidation('stake deve essere compreso tra 1 e 10.000.');

    const refresh = body.refresh === true;
    const availableFixtures = await provider.getFixturesByDate(date, { force: refresh });
    const fixtures = availableFixtures.slice(0, config.topPicksMaxFixtures);
    const baselineResults = await mapWithConcurrency(fixtures, config.topPicksConcurrency, async (fixture) => {
      try {
        const analysis = await analyzeFixture(fixture.id, isNeutralFixture(fixture), { refresh, useAi: false });
        return { analysis };
      } catch (error) {
        return { error: { fixtureId: fixture.id, match: `${fixture.home.name} - ${fixture.away.name}`, message: 'Analisi non completata.' } };
      }
    });
    let analyses = baselineResults.flatMap((result) => result.analysis ? [result.analysis] : []);
    const failed = baselineResults.flatMap((result) => result.error ? [result.error] : []);
    const aiMode = aiOrchestrator.effectiveMode();
    const aiShortlist = config.ai.topPicksEnabled && !String(aiMode).startsWith('off')
      ? rankAnalyses(analyses, topPicksEligibilityPolicy).slice(0, limit * config.ai.topPicksShortlistMultiplier)
      : [];
    if (aiShortlist.length) {
      const byFixtureId = new Map(analyses.map((analysis) => [String(analysis.fixture.id), analysis]));
      const enriched = await mapWithConcurrency(aiShortlist, Math.min(config.topPicksConcurrency, config.ai.maxConcurrency), async (pick) => {
        try {
          return await analyzeFixture(pick.fixture.id, isNeutralFixture(pick.fixture), { refresh, useAi: true });
        } catch {
          return null;
        }
      });
      for (const analysis of enriched.filter(Boolean)) byFixtureId.set(String(analysis.fixture.id), analysis);
      analyses = [...byFixtureId.values()];
    }
    const topPicks = buildTopPicks({
      analyses,
      date,
      limit,
      stake,
      availableFixtures: availableFixtures.length,
      scannedFixtures: fixtures.length,
      failed,
      bookmaker: analyses.find((analysis) => analysis.governance?.bookmaker)?.governance.bookmaker || config.bookmakerName,
      eligibilityPolicy: topPicksEligibilityPolicy
    });
    return {
      ...topPicks,
      mode: provider.mode,
      ai: {
        mode: aiMode,
        topPicksAiEnabled: Boolean(config.ai.topPicksEnabled),
        shortlistSize: aiShortlist.length
      }
    };
  }

  async function quickPredictions(body) {
    const ids = Array.isArray(body?.fixtureIds) ? body.fixtureIds : null;
    if (!ids || ids.length < 1 || ids.length > 12) throw failValidation('fixtureIds deve contenere da 1 a 12 partite.');
    const fixtures = await provider.getFixtures({ days: config.matchDaysAhead });
    const byId = new Map(fixtures.map((fixture) => [String(fixture.id), fixture]));
    return mapWithConcurrency(ids.map((id) => String(id)), 3, async (fixtureId) => {
      try {
        validateFixtureId(fixtureId);
        const fixture = byId.get(fixtureId);
        const analysis = await analyzeFixture(fixtureId, fixture ? isNeutralFixture(fixture) : false, { useAi: false, lite: true });
        const recommendation = analysis.summary.recommendation;
        return {
          fixtureId,
          outcomes: analysis.summary.outcomes,
          recommendation: { key: recommendation.key, label: recommendation.label, probability: recommendation.probability, hasValue: Boolean(recommendation.hasValue), edge: recommendation.edge ?? null },
          confidence: analysis.summary.confidence
        };
      } catch {
        return { fixtureId, error: 'Previsione non disponibile.' };
      }
    });
  }

  async function journalReport(requestId) {
    if (!journal) return { enabled: false, bets: [], requestId };
    await settleDueResults();
    const now = Date.now();
    const settings = journal.settings();
    const bets = journal.bets().map((bet) => deriveBet(bet, ledger?.fixtureSnapshot(bet.fixtureId) || null, now));
    const losses = periodLosses(bets, now, config.timezone);
    return { enabled: true, storage: journal.storage.kind || 'custom', settings, bets, summary: summarize(bets), losses, limits: limitStatus(losses, settings), requestId };
  }

  async function addJournalBet(body) {
    const fixtureId = validateFixtureId(body.fixtureId);
    const marketKey = String(body.marketKey || '');
    if (!LABELS[marketKey]) throw failValidation('Mercato non riconosciuto.');
    const snapshot = ledger?.fixtureSnapshot(fixtureId);
    if (!snapshot) throw failValidation('Analizza la partita prima di aggiungerla al diario.');
    if (Date.parse(snapshot.fixture.kickoff) <= Date.now()) throw failValidation('La partita è già iniziata: si registrano solo giocate pre-partita.');
    return journal.add({
      fixtureId,
      match: `${snapshot.fixture.home.name} - ${snapshot.fixture.away.name}`,
      competition: snapshot.fixture.league?.name || '',
      kickoff: snapshot.fixture.kickoff,
      marketKey,
      label: LABELS[marketKey],
      oddTaken: body.oddTaken,
      stake: body.stake,
      placedAt: new Date(Date.now()).toISOString()
    });
  }

  function meta(requestId) {
    return {
      app: 'Enterprise Football Prediction Engine',
      version: APP_VERSION,
      mode: provider.mode,
      timezone: config.timezone,
      bookmaker: config.bookmakerName,
      daysAhead: config.matchDaysAhead,
      autoRefreshMinutes: config.autoRefreshMinutes,
      topPicksLimits: [5, 6, 7],
      topPicksMaxFixtures: config.topPicksMaxFixtures,
      topPicksEligibilityPolicy,
      provider: provider.label || (config.demoMode ? 'Dati dimostrativi locali' : 'API-Football'),
      dataProvider: config.dataProvider,
      snapshot: provider.snapshotInfo || null,
      predictionLedger: {
        enabled: Boolean(ledger),
        storage: ledger?.storage?.kind || null,
        settlementDelayMinutes: config.predictionLedger.settlementDelayMinutes
      },
      ai: {
        provider: config.ai.provider,
        configuredMode: config.ai.mode,
        effectiveMode: aiOrchestrator.effectiveMode(),
        models: {
          default: config.ai.modelDefault,
          challenge: config.ai.modelChallenge,
          explanation: config.ai.modelExplanation
        },
        agentsNote: config.ai.provider === 'claude' ? 'Agenti eseguiti da Claude nel runtime Artifact, con il consenso e l’utilizzo dell’utente che visualizza.' : null,
        agents: ['Lineups & Tactical Context', 'News Intelligence', 'Competition Context', 'Challenge & Bias Detection', 'Final Explanation'],
        maxProbabilityShiftPp: config.ai.maxProbabilityShiftPp,
        maxTotalXgDelta: config.ai.maxTotalXgDelta,
        duplicateEvidenceScale: config.ai.duplicateEvidenceScale,
        dataMinimization: 'agent_scoped',
        topPicksAiEnabled: config.ai.topPicksEnabled
      },
      cache: analysisCache.stats(),
      requestId
    };
  }

  /**
   * Gestisce una richiesta API. Restituisce { status, payload } oppure null se il percorso non e un endpoint API.
   * `readBody` viene invocata solo per gli endpoint POST che richiedono un corpo JSON.
   */
  async function handle({ method, pathname, searchParams = new URLSearchParams(), readBody = async () => ({}), isAdmin = false, requestId }) {
    if (method === 'GET' && pathname === '/api/health') {
      return { status: 200, payload: { status: 'ok', mode: provider.mode, timestamp: new Date().toISOString(), requestId } };
    }
    if (method === 'GET' && pathname === '/api/ready') {
      return {
        status: 200,
        payload: { status: 'ready', provider: provider.mode, aiProvider: config.ai.provider, aiMode: aiOrchestrator.effectiveMode(), requestId }
      };
    }
    if (method === 'GET' && pathname === '/api/meta') {
      return { status: 200, payload: meta(requestId) };
    }
    if (method === 'GET' && pathname === '/api/usage') {
      const ai = isAdmin ? aiOrchestrator.usageSnapshot() : publicUsageSnapshot();
      return { status: 200, payload: { ai, cache: analysisCache.stats(), detailed: isAdmin, requestId } };
    }
    if (method === 'GET' && pathname === '/api/fixtures') {
      const days = Math.min(14, Math.max(1, Number(searchParams.get('days')) || config.matchDaysAhead));
      const force = searchParams.get('refresh') === '1';
      const fixtures = await provider.getFixtures({ days, force });
      return { status: 200, payload: { fixtures, updatedAt: new Date().toISOString(), mode: provider.mode, requestId } };
    }
    if (method === 'POST' && pathname === '/api/analyze') {
      const body = await readBody();
      const fixtureId = validateFixtureId(body.fixtureId);
      const analysis = await analyzeFixture(fixtureId, body.neutral === true, { refresh: body.refresh === true, useAi: body.useAi !== false });
      return { status: 200, payload: { ...analysis, requestId } };
    }
    if (method === 'POST' && pathname === '/api/quick-predictions') {
      const body = await readBody();
      return { status: 200, payload: { predictions: await quickPredictions(body), requestId } };
    }
    if (method === 'POST' && pathname === '/api/top-picks') {
      const body = await readBody();
      const topPicks = await buildTopPicksResponse(body);
      return { status: 200, payload: { ...topPicks, requestId } };
    }
    if (method === 'GET' && pathname === '/api/performance') {
      return { status: 200, payload: await performanceReport(requestId) };
    }
    if (method === 'GET' && pathname === '/api/performance/records') {
      if (!ledger) return { status: 200, payload: { enabled: false, rows: [], requestId } };
      await seedDemoArchive();
      const rows = ledger.exportRows();
      return { status: 200, payload: { enabled: true, mode: provider.mode, total: rows.length, rows: rows.slice(0, 5000), requestId } };
    }
    if (method === 'POST' && pathname === '/api/performance/settle') {
      if (!isAdmin) return { status: 403, payload: { error: 'Operazione riservata: serve ADMIN_API_TOKEN.', requestId } };
      if (!ledger) return { status: 409, payload: { error: 'Registro previsioni disattivato.', requestId } };
      const settlement = await settleDueResults({ force: true });
      return { status: 200, payload: { settlement, ledger: ledger.stats(), requestId } };
    }
    if (method === 'GET' && pathname === '/api/journal') {
      return { status: 200, payload: await journalReport(requestId) };
    }
    if (method === 'POST' && pathname === '/api/journal/suggest') {
      // La puntata consigliata non richiede il diario: senza diario valgono le impostazioni predefinite.
      const body = await readBody();
      const settings = journal ? journal.settings() : { ...DEFAULT_STAKING };
      return { status: 200, payload: { ...recommendedStake({ probability: toNumber(body.probability), odd: toNumber(body.odd), settings }), settings, requestId } };
    }
    if (method === 'POST' && pathname.startsWith('/api/journal')) {
      if (!journal) return { status: 409, payload: { error: 'Diario delle giocate non disponibile.', requestId } };
      const body = await readBody();
      if (pathname === '/api/journal') return { status: 200, payload: { bet: await addJournalBet(body), requestId } };
      if (pathname === '/api/journal/delete') return { status: 200, payload: { deleted: await journal.remove(String(body.id || '')), requestId } };
      if (pathname === '/api/journal/settings') return { status: 200, payload: { settings: await journal.saveSettings(body), requestId } };
    }
    if (pathname.startsWith('/api/')) {
      if (method === 'GET') return { status: 404, payload: { error: 'Endpoint non trovato.', requestId } };
      return { status: 405, payload: { error: 'Metodo non consentito.', requestId } };
    }
    return null;
  }

  return { handle, analyzeFixture, buildTopPicksResponse, meta, performanceReport, settleDueResults };
}
