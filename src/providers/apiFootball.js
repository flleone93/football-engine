import { TTLCache } from '../cache.js';
import { addDays, asNumber, daysBetween, isoDate } from '../utils.js';

const FINISHED = new Set(['FT', 'AET', 'PEN']);

function mapFixture(item) {
  return {
    id: item.fixture.id,
    kickoff: item.fixture.date,
    status: item.fixture.status?.short || 'NS',
    venue: [item.fixture.venue?.name, item.fixture.venue?.city].filter(Boolean).join(', ') || 'Da confermare',
    referee: item.fixture.referee || null,
    league: {
      id: item.league.id, name: item.league.name, country: item.league.country,
      season: item.league.season, round: item.league.round, logo: item.league.logo || ''
    },
    home: { id: item.teams.home.id, name: item.teams.home.name, logo: item.teams.home.logo || '' },
    away: { id: item.teams.away.id, name: item.teams.away.name, logo: item.teams.away.logo || '' }
  };
}

function normalizeTeamStats(response) {
  if (!response || !response.fixtures) return null;
  const average = response.goals || {};
  return {
    played: response.fixtures.played?.total || 0,
    goalsForHome: asNumber(average.for?.average?.home),
    goalsAgainstHome: asNumber(average.against?.average?.home),
    goalsForAway: asNumber(average.for?.average?.away),
    goalsAgainstAway: asNumber(average.against?.average?.away),
    goalsForTotal: asNumber(average.for?.average?.total),
    goalsAgainstTotal: asNumber(average.against?.average?.total),
    cleanSheets: response.clean_sheet?.total ?? null,
    failedToScore: response.failed_to_score?.total ?? null,
    form: response.form || ''
  };
}

function normalizeRecent(items, teamId, kickoff) {
  const cutoff = new Date(kickoff).getTime();
  const matches = items
    .filter((item) => FINISHED.has(item.fixture.status?.short) && item.goals.home != null && item.goals.away != null)
    .filter((item) => new Date(item.fixture.date).getTime() < cutoff)
    .sort((a, b) => new Date(b.fixture.date) - new Date(a.fixture.date));
  if (!matches.length) return null;
  let wins = 0; let draws = 0; let losses = 0; let goalsFor = 0; let goalsAgainst = 0;
  for (const item of matches) {
    const isHome = item.teams.home.id === teamId;
    const scored = isHome ? item.goals.home : item.goals.away;
    const conceded = isHome ? item.goals.away : item.goals.home;
    goalsFor += scored; goalsAgainst += conceded;
    if (scored > conceded) wins += 1;
    else if (scored === conceded) draws += 1;
    else losses += 1;
  }
  return {
    matches: matches.length, wins, draws, losses,
    ppg: (wins * 3 + draws) / matches.length,
    goalsForAverage: goalsFor / matches.length,
    goalsAgainstAverage: goalsAgainst / matches.length,
    goalDifferenceAverage: (goalsFor - goalsAgainst) / matches.length,
    restDays: daysBetween(matches[0].fixture.date, kickoff)
  };
}

function normalizeH2H(items, homeId, kickoff) {
  const cutoff = new Date(kickoff).getTime();
  const matches = items.filter((item) => FINISHED.has(item.fixture.status?.short)
    && item.goals.home != null
    && new Date(item.fixture.date).getTime() < cutoff);
  if (!matches.length) return null;
  let home = 0; let draw = 0; let away = 0; let homeGoals = 0; let awayGoals = 0;
  for (const item of matches) {
    const selectedHomeWasHome = item.teams.home.id === homeId;
    const selectedHomeGoals = selectedHomeWasHome ? item.goals.home : item.goals.away;
    const selectedAwayGoals = selectedHomeWasHome ? item.goals.away : item.goals.home;
    homeGoals += selectedHomeGoals; awayGoals += selectedAwayGoals;
    if (selectedHomeGoals > selectedAwayGoals) home += 1;
    else if (selectedHomeGoals === selectedAwayGoals) draw += 1;
    else away += 1;
  }
  return { matches: matches.length, home, draw, away, homeGoalsAverage: homeGoals / matches.length, awayGoalsAverage: awayGoals / matches.length };
}

function normalizePrediction(item) {
  const percentages = item?.predictions?.percent;
  if (!percentages) return null;
  const parse = (value) => asNumber(String(value).replace('%', ''), 0) / 100;
  return {
    home: parse(percentages.home), draw: parse(percentages.draw), away: parse(percentages.away),
    advice: item.predictions.advice || '', underOver: item.predictions.under_over || null,
    expectedHome: asNumber(item.predictions.goals?.home), expectedAway: asNumber(item.predictions.goals?.away)
  };
}

function oddsKey(betName, value) {
  const bet = betName.toLowerCase();
  const selection = String(value).toLowerCase().trim();
  if (bet.includes('match winner') || bet === 'winner') {
    if (selection === 'home') return '1';
    if (selection === 'draw') return 'X';
    if (selection === 'away') return '2';
  }
  if (bet.includes('double chance')) {
    if (['home/draw', '1x', 'home or draw'].includes(selection)) return '1X';
    if (['draw/away', 'x2', 'draw or away'].includes(selection)) return 'X2';
  }
  if (bet.includes('both teams') || bet.includes('both team score')) {
    if (['yes', 'goal'].includes(selection)) return 'GOAL';
    if (['no', 'no goal'].includes(selection)) return 'NO_GOAL';
  }
  if (bet.includes('goals over/under') || bet.includes('over/under')) {
    if (selection === 'over 1.5') return 'OVER_1_5';
    if (selection === 'under 1.5') return 'UNDER_1_5';
    if (selection === 'over 2.5') return 'OVER_2_5';
    if (selection === 'under 2.5') return 'UNDER_2_5';
  }
  return null;
}

function normalizeOdds(items, preferredBookmaker) {
  const containers = items.flatMap((item) => item.bookmakers || []);
  if (!containers.length) return null;
  const preference = preferredBookmaker.toLowerCase();
  const bookmaker = containers.find((item) => item.name.toLowerCase() === preference)
    || containers.find((item) => item.name.toLowerCase().includes(preference))
    || containers.find((item) => /bet365/i.test(item.name))
    || containers[0];
  const values = {};
  for (const bet of bookmaker.bets || []) {
    for (const selection of bet.values || []) {
      const key = oddsKey(bet.name, selection.value);
      const odd = asNumber(selection.odd);
      if (key && odd && !values[key]) values[key] = odd;
    }
  }
  return {
    bookmaker: bookmaker.name,
    updatedAt: items.find((item) => item.update)?.update || new Date().toISOString(),
    values
  };
}

export class ApiFootballProvider {
  constructor(config) {
    this.config = config;
    this.mode = 'live';
    this.cache = new TTLCache(config.cacheTtlMs);
  }

  async request(endpoint, params = {}, { force = false } = {}) {
    const query = new URLSearchParams(Object.entries(params).filter(([, value]) => value != null));
    const url = `${this.config.apiBaseUrl}${endpoint}?${query}`;
    if (!force) {
      const cached = this.cache.get(url);
      if (cached !== undefined) return cached;
    }
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await fetch(url, {
          headers: { 'x-apisports-key': this.config.apiKey, accept: 'application/json' },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs)
        });
        if (!response.ok) {
          const error = new Error(`API-Football HTTP ${response.status}.`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        const payload = await response.json();
        const errors = payload.errors && (Array.isArray(payload.errors) ? payload.errors : Object.values(payload.errors));
        if (errors?.length) throw new Error(`API-Football ha rifiutato la richiesta: ${errors.join(', ')}`);
        return this.cache.set(url, payload.response || []);
      } catch (error) {
        lastError = error;
        const retryable = error.retryable === true || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
        if (attempt >= 2 || !retryable) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (2 ** attempt) + Math.floor(Math.random() * 100)));
      }
    }
    throw lastError;
  }

  async getFixtures({ days = this.config.matchDaysAhead, force = false } = {}) {
    const cacheKey = `fixtures:${days}`;
    if (force) this.cache.deleteByPrefix('fixtures:');
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const localToday = new Intl.DateTimeFormat('sv-SE', { timeZone: this.config.timezone }).format(new Date());
    const start = new Date(`${localToday}T12:00:00Z`);
    const dates = Array.from({ length: days }, (_, index) => isoDate(addDays(start, index)));
    const responses = await Promise.all(dates.map((date) => this.getFixturesByDate(date, { force })));
    const fixtures = responses.flat()
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
      .slice(0, this.config.maxFixtures);
    return this.cache.set(cacheKey, fixtures);
  }

  async getFixturesByDate(date, { force = false } = {}) {
    const cacheKey = `fixtures:date:${date}`;
    if (force) this.cache.delete(cacheKey);
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const response = await this.request('/fixtures', { date, timezone: this.config.timezone }, { force });
    const now = Date.now();
    const fixtures = response
      .map(mapFixture)
      .filter((item) => !['FT', 'AET', 'PEN', 'PST', 'CANC', 'ABD'].includes(item.status))
      .filter((item) => new Date(item.kickoff).getTime() > now - 3 * 3600000)
      .sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff))
      .slice(0, this.config.maxFixtures);
    return this.cache.set(cacheKey, fixtures);
  }

  /** Risultato al 90' per il registro previsioni: `score.fulltime` esclude supplementari e rigori. */
  async getFixtureResult(fixtureId) {
    const [item] = await this.request('/fixtures', { id: fixtureId, timezone: this.config.timezone }, { force: true });
    if (!item) return null;
    const status = item.fixture?.status?.short || 'NS';
    const fulltime = item.score?.fulltime;
    const regulation = Number.isFinite(fulltime?.home) && Number.isFinite(fulltime?.away) ? fulltime : item.goals;
    return {
      status,
      finished: FINISHED.has(status) && Number.isFinite(regulation?.home) && Number.isFinite(regulation?.away),
      void: ['CANC', 'ABD', 'AWD', 'WO'].includes(status),
      goals: Number.isFinite(regulation?.home) && Number.isFinite(regulation?.away) ? { home: regulation.home, away: regulation.away } : null,
      source: 'API-Football'
    };
  }

  async safe(label, promise, errors, sourceStatus, key) {
    try {
      const result = await promise;
      sourceStatus[key] = { available: true, error: null };
      return result;
    } catch (error) {
      const publicMessage = `${label}: fonte non disponibile.`;
      errors.push(publicMessage);
      sourceStatus[key] = { available: false, error: publicMessage };
      return [];
    }
  }

  async getAnalysisBundle(fixtureId, { force = false } = {}) {
    const sourceErrors = [];
    const sourceStatus = {};
    const fixtureResponse = await this.request('/fixtures', { id: fixtureId, timezone: this.config.timezone }, { force });
    if (!fixtureResponse[0]) throw new Error('Partita non trovata nel provider.');
    const fixture = mapFixture(fixtureResponse[0]);
    const shared = { league: fixture.league.id, season: fixture.league.season };
    const [homeStatsRaw, awayStatsRaw, homeRecentRaw, awayRecentRaw, h2hRaw, injuriesRaw, predictionsRaw, oddsRaw, lineupsRaw] = await Promise.all([
      this.safe('Statistiche casa', this.request('/teams/statistics', { ...shared, team: fixture.home.id, date: isoDate(new Date(fixture.kickoff)) }, { force }), sourceErrors, sourceStatus, 'homeStats'),
      this.safe('Statistiche trasferta', this.request('/teams/statistics', { ...shared, team: fixture.away.id, date: isoDate(new Date(fixture.kickoff)) }, { force }), sourceErrors, sourceStatus, 'awayStats'),
      this.safe('Forma casa', this.request('/fixtures', { team: fixture.home.id, last: 10, timezone: this.config.timezone }, { force }), sourceErrors, sourceStatus, 'recentHome'),
      this.safe('Forma trasferta', this.request('/fixtures', { team: fixture.away.id, last: 10, timezone: this.config.timezone }, { force }), sourceErrors, sourceStatus, 'recentAway'),
      this.safe('Scontri diretti', this.request('/fixtures/headtohead', { h2h: `${fixture.home.id}-${fixture.away.id}`, last: 10 }, { force }), sourceErrors, sourceStatus, 'h2h'),
      this.safe('Infortuni', this.request('/injuries', { fixture: fixtureId }, { force }), sourceErrors, sourceStatus, 'injuries'),
      this.safe('Previsione provider', this.request('/predictions', { fixture: fixtureId }, { force }), sourceErrors, sourceStatus, 'prediction'),
      this.safe('Quote', this.request('/odds', { fixture: fixtureId }, { force }), sourceErrors, sourceStatus, 'odds'),
      this.safe('Formazioni', this.request('/fixtures/lineups', { fixture: fixtureId }, { force }), sourceErrors, sourceStatus, 'lineups')
    ]);
    const homeStatsPayload = Array.isArray(homeStatsRaw) ? homeStatsRaw[0] : homeStatsRaw;
    const awayStatsPayload = Array.isArray(awayStatsRaw) ? awayStatsRaw[0] : awayStatsRaw;
    return {
      fixture,
      homeStats: normalizeTeamStats(homeStatsPayload),
      awayStats: normalizeTeamStats(awayStatsPayload),
      recentHome: normalizeRecent(homeRecentRaw, fixture.home.id, fixture.kickoff),
      recentAway: normalizeRecent(awayRecentRaw, fixture.away.id, fixture.kickoff),
      h2h: normalizeH2H(h2hRaw, fixture.home.id, fixture.kickoff),
      injuries: {
        home: injuriesRaw.filter((item) => item.team?.id === fixture.home.id).map((item) => ({ name: item.player?.name, reason: item.player?.reason || item.player?.type || 'Indisponibile' })),
        away: injuriesRaw.filter((item) => item.team?.id === fixture.away.id).map((item) => ({ name: item.player?.name, reason: item.player?.reason || item.player?.type || 'Indisponibile' }))
      },
      prediction: normalizePrediction(predictionsRaw[0]),
      odds: normalizeOdds(oddsRaw, this.config.bookmakerName),
      lineups: {
        home: lineupsRaw.find((item) => item.team?.id === fixture.home.id)?.startXI || [],
        away: lineupsRaw.find((item) => item.team?.id === fixture.away.id)?.startXI || [],
        confirmed: lineupsRaw.length >= 2 && lineupsRaw.every((item) => (item.startXI || []).length >= 11)
      },
      news: [],
      competitionRules: null,
      sourceStatus,
      sourceMetadata: { provider: 'API-Football', retrievedAt: new Date().toISOString() },
      sourceErrors
    };
  }
}
