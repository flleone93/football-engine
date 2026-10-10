// Costruzione pura della configurazione: nessuna dipendenza da Node.
// Usata sia dal server (src/config.js, con process.env + .env) sia dalla demo standalone nel browser.

export function buildConfig(env = {}) {
  const number = (name, fallback, min, max) => {
    const parsed = Number(env[name]);
    if (env[name] == null || env[name] === '' || !Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  const bool = (name, fallback) => {
    const value = env[name];
    if (value == null) return fallback;
    return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
  };

  const text = (name, fallback = '') => {
    const value = env[name];
    return value == null || String(value).trim() === '' ? fallback : String(value).trim();
  };

  const choice = (name, fallback, allowed) => {
    const value = text(name, fallback).toLowerCase();
    return allowed.includes(value) ? value : fallback;
  };

  const aiProvider = choice('AI_PROVIDER', 'gemini', ['anthropic', 'openai', 'gemini', 'claude']);
  const aiProviderPrefix = { anthropic: 'ANTHROPIC', gemini: 'GEMINI', openai: 'OPENAI', claude: 'CLAUDE' }[aiProvider];
  const demoMode = bool('DEMO_MODE', true);
  const dataProvider = demoMode ? 'demo' : choice('DATA_PROVIDER', env.API_FOOTBALL_KEY ? 'api-football' : 'espn', ['api-football', 'espn']);
  const providerText = (suffix, fallback) => text(`AI_MODEL_${suffix}`, text(`${aiProviderPrefix}_MODEL_${suffix}`, fallback));
  // Il provider `claude` non usa chiavi: le chiamate passano dal runtime Artifact di claude.ai (capability `sample`).
  const selectedAiKey = { anthropic: text('ANTHROPIC_API_KEY'), gemini: text('GEMINI_API_KEY'), openai: text('OPENAI_API_KEY'), claude: '' }[aiProvider];
  const selectedAiBaseUrl = {
    anthropic: text('ANTHROPIC_BASE_URL', 'https://api.anthropic.com/v1'),
    gemini: text('GEMINI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    openai: text('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    claude: 'artifact-runtime'
  }[aiProvider];
  const modelDefaults = {
    anthropic: { default: 'claude-opus-5-5', challenge: 'claude-opus-5-5', explanation: 'claude-opus-5-5' },
    gemini: { default: 'gemini-2.5-flash-lite', challenge: 'gemini-2.5-flash', explanation: 'gemini-2.5-flash-lite' },
    openai: { default: 'gpt-5.6-luna', challenge: 'gpt-5.6-terra', explanation: 'gpt-5.6-luna' },
    claude: { default: 'claude-tier-default', challenge: 'claude-tier-default', explanation: 'claude-tier-default' }
  }[aiProvider];

  return Object.freeze({
    host: text('HOST', '0.0.0.0'),
    port: number('PORT', 8080, 1, 65535),
    demoMode,
    dataProvider,
    apiKey: env.API_FOOTBALL_KEY || '',
    apiBaseUrl: env.API_FOOTBALL_BASE_URL || 'https://v3.football.api-sports.io',
    timezone: env.TIMEZONE || 'Europe/Rome',
    matchDaysAhead: number('MATCH_DAYS_AHEAD', 7, 1, 14),
    maxFixtures: number('MAX_FIXTURES', 400, 20, 2000),
    cacheTtlMs: number('CACHE_TTL_SECONDS', 900, 30, 86400) * 1000,
    cacheMaxEntries: Math.round(number('CACHE_MAX_ENTRIES', 2000, 100, 100000)),
    maxBodyBytes: Math.round(number('MAX_BODY_BYTES', 1048576, 1024, 10485760)),
    autoRefreshMinutes: number('AUTO_REFRESH_MINUTES', 180, 1, 1440),
    monteCarloRuns: Math.round(number('MONTE_CARLO_RUNS', 50000, 10000, 500000)),
    topPicksMaxFixtures: Math.round(number('TOP_PICKS_MAX_FIXTURES', 400, 7, 2000)),
    topPicksConcurrency: Math.round(number('TOP_PICKS_CONCURRENCY', 3, 1, 10)),
    topPicksMinProbability: number('TOP_PICKS_MIN_PROBABILITY', 0.55, 0.34, 0.95),
    topPicksMinConfidence: Math.round(number('TOP_PICKS_MIN_CONFIDENCE', 45, 0, 100)),
    topPicksMinDataQuality: Math.round(number('TOP_PICKS_MIN_DATA_QUALITY', 40, 0, 100)),
    topPicksRequirePositiveEv: bool('TOP_PICKS_REQUIRE_POSITIVE_EV', false),
    bookmakerName: text('BOOKMAKER_NAME', 'Bet365'),
    requestTimeoutMs: Math.round(number('PROVIDER_TIMEOUT_MS', 15000, 1000, 60000)),
    requestRateLimit: Math.round(number('REQUESTS_PER_MINUTE', 90, 10, 10000)),
    expensiveRateLimit: Math.round(number('EXPENSIVE_REQUESTS_PER_MINUTE', 12, 1, 1000)),
    trustProxy: bool('TRUST_PROXY', false),
    adminApiToken: text('ADMIN_API_TOKEN'),
    predictionLedger: Object.freeze({
      enabled: bool('PREDICTION_LEDGER_ENABLED', true),
      path: text('PREDICTION_LEDGER_PATH', 'data/predictions.jsonl'),
      maxRecords: Math.round(number('PREDICTION_LEDGER_MAX_RECORDS', 20000, 100, 1000000)),
      settlementDelayMinutes: Math.round(number('RESULT_SETTLEMENT_DELAY_MINUTES', 150, 105, 1440)),
      settlementIntervalMinutes: Math.round(number('RESULT_SETTLEMENT_INTERVAL_MINUTES', 15, 1, 1440)),
      settlementMaxPerRun: Math.round(number('RESULT_SETTLEMENT_MAX_PER_RUN', 40, 1, 500))
    }),
    ai: Object.freeze({
      mode: choice('AI_MODE', 'off', ['off', 'shadow', 'active']),
      provider: aiProvider,
      apiKey: selectedAiKey,
      baseUrl: selectedAiBaseUrl,
      modelDefault: providerText('DEFAULT', modelDefaults.default),
      modelChallenge: providerText('CHALLENGE', modelDefaults.challenge),
      modelExplanation: providerText('EXPLANATION', modelDefaults.explanation),
      reasoningEffort: choice('AI_REASONING_EFFORT', 'low', ['none', 'low', 'medium', 'high']),
      requestTimeoutMs: Math.round(number('AI_REQUEST_TIMEOUT_MS', 20000, 1000, 120000)),
      maxOutputTokens: Math.round(number('AI_MAX_OUTPUT_TOKENS', 900, 200, 4000)),
      maxInputChars: Math.round(number('AI_MAX_INPUT_CHARS', 24000, 4000, 100000)),
      maxCallsPerAnalysis: Math.round(number('AI_MAX_CALLS_PER_ANALYSIS', 6, 1, 6)),
      maxConcurrency: Math.round(number('AI_MAX_CONCURRENCY', 2, 1, 6)),
      dailyCallLimit: Math.round(number('AI_DAILY_CALL_LIMIT', 500, 1, 1000000)),
      dailyTokenLimit: Math.round(number('AI_DAILY_TOKEN_LIMIT', 1000000, 1000, 1000000000)),
      dailyCostLimitUsd: number('AI_DAILY_COST_LIMIT_USD', 25, 0, 1000000),
      agentCacheTtlMs: number('AI_AGENT_CACHE_TTL_SECONDS', 3600, 60, 86400) * 1000,
      minEffectConfidence: number('AI_MIN_EFFECT_CONFIDENCE', 0.55, 0, 1),
      duplicateEvidenceScale: number('AI_DUPLICATE_EVIDENCE_SCALE', 0.5, 0, 1),
      maxPlayerXgDelta: number('AI_MAX_PLAYER_XG_DELTA', 0.12, 0, 0.5),
      maxTacticalXgDelta: number('AI_MAX_TACTICAL_XG_DELTA', 0.08, 0, 0.5),
      maxNewsXgDelta: number('AI_MAX_NEWS_XG_DELTA', 0.04, 0, 0.5),
      maxCompetitionXgDelta: number('AI_MAX_COMPETITION_XG_DELTA', 0.06, 0, 0.5),
      maxTotalXgDelta: number('AI_MAX_TOTAL_XG_DELTA', 0.20, 0, 1),
      maxProbabilityShiftPp: number('AI_MAX_PROBABILITY_SHIFT_PP', 5, 0, 20),
      maxChallengeConfidencePenalty: Math.round(number('AI_MAX_CHALLENGE_CONFIDENCE_PENALTY', 8, 0, 25)),
      topPicksEnabled: bool('TOP_PICKS_AI_ENABLED', false),
      topPicksShortlistMultiplier: Math.round(number('TOP_PICKS_AI_SHORTLIST_MULTIPLIER', 2, 1, 5)),
      inputCostPerMillion: number('AI_INPUT_COST_PER_MILLION', 0, 0, 1000) || null,
      cachedInputCostPerMillion: number('AI_CACHED_INPUT_COST_PER_MILLION', 0, 0, 1000) || null,
      outputCostPerMillion: number('AI_OUTPUT_COST_PER_MILLION', 0, 0, 1000) || null
    })
  });
}

export function validateConfigObject(config) {
  if (config.dataProvider === 'api-football' && !config.apiKey) {
    throw new Error('API_FOOTBALL_KEY obbligatoria con DATA_PROVIDER=api-football (oppure usa DATA_PROVIDER=espn, senza chiave).');
  }
  if (config.ai.mode !== 'off' && config.ai.provider === 'gemini'
    && ![config.ai.modelDefault, config.ai.modelChallenge, config.ai.modelExplanation].every((model) => model.startsWith('gemini-'))) {
    throw new Error('I modelli Gemini devono usare identificativi gemini-* oppure AI_MODEL_* coerenti con AI_PROVIDER=gemini.');
  }
  if (config.ai.mode !== 'off' && config.ai.provider === 'anthropic'
    && ![config.ai.modelDefault, config.ai.modelChallenge, config.ai.modelExplanation].every((model) => model.startsWith('claude-'))) {
    throw new Error('Con AI_PROVIDER=anthropic i modelli devono usare identificativi claude-*.');
  }
}
