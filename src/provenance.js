import { createHash, randomUUID } from 'node:crypto';

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
  }
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return value;
}

export function sha256(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(canonicalize(value));
  return createHash('sha256').update(text).digest('hex');
}

export function buildDataVersion(bundle) {
  return sha256({
    fixture: bundle.fixture,
    homeStats: bundle.homeStats,
    awayStats: bundle.awayStats,
    recentHome: bundle.recentHome,
    recentAway: bundle.recentAway,
    h2h: bundle.h2h,
    injuries: bundle.injuries,
    lineups: bundle.lineups,
    odds: bundle.odds,
    prediction: bundle.prediction,
    news: bundle.news,
    competitionRules: bundle.competitionRules,
    sourceErrors: bundle.sourceErrors
  });
}

export function publicSourceSnapshot(bundle) {
  const source = bundle.sourceMetadata || {};
  const available = (key, fallback) => bundle.sourceStatus?.[key]?.available ?? fallback;
  return {
    provider: source.provider || (bundle.fixture?.id?.toString().startsWith('demo-') ? 'demo' : 'API-Football'),
    retrievedAt: source.retrievedAt || new Date().toISOString(),
    observed: {
      fixture: Boolean(bundle.fixture),
      seasonStatistics: available('homeStats', Boolean(bundle.homeStats)) && available('awayStats', Boolean(bundle.awayStats)) && Boolean(bundle.homeStats && bundle.awayStats),
      recentForm: available('recentHome', Boolean(bundle.recentHome)) && available('recentAway', Boolean(bundle.recentAway)) && Boolean(bundle.recentHome && bundle.recentAway),
      injuries: available('injuries', Array.isArray(bundle.injuries?.home) && Array.isArray(bundle.injuries?.away)),
      lineups: available('lineups', Boolean(bundle.lineups?.confirmed)) && Boolean(bundle.lineups?.confirmed),
      odds: available('odds', Boolean(bundle.odds?.values)) && Boolean(bundle.odds?.values && Object.keys(bundle.odds.values).length),
      news: Array.isArray(bundle.news) && bundle.news.length > 0,
      competitionRules: Boolean(bundle.competitionRules)
    },
    timestamps: {
      odds: bundle.odds?.updatedAt || null,
      news: bundle.news?.reduce?.((latest, item) => item.publishedAt > latest ? item.publishedAt : latest, '') || null
    },
    errors: (bundle.sourceErrors || []).map((error) => String(error)).slice(0, 20)
  };
}

export function createRequestId() {
  return randomUUID();
}

export function auditLog(event, fields = {}) {
  const safe = Object.fromEntries(Object.entries(fields).filter(([key]) => !/key|authorization|prompt|secret/i.test(key)));
  console.log(JSON.stringify({ timestamp: new Date().toISOString(), event, ...safe }));
}

export { canonicalize };
