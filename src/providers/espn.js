// Provider live senza chiave: API pubbliche ESPN (calendario, classifiche, forma, scontri diretti,
// notizie, quote DraftKings con apertura/attuale). Nessuna dipendenza Node: usato anche dallo script snapshot.
import { TTLCache } from '../cache.js';
import { ELO_DEFAULTS, eloForFixture } from '../prediction/elo.js';
import { addDays, round } from '../utils.js';
import { WeatherService } from './weather.js';

const BASE = 'https://site.api.espn.com/apis';

/** Competizioni scansionate di default. `format: 'league'` = girone all'italiana (regolamento certo). */
export const ESPN_LEAGUES = Object.freeze([
  { slug: 'ita.1', name: 'Serie A', country: 'Italia', format: 'league' },
  { slug: 'eng.1', name: 'Premier League', country: 'Inghilterra', format: 'league' },
  { slug: 'esp.1', name: 'LaLiga', country: 'Spagna', format: 'league' },
  { slug: 'ger.1', name: 'Bundesliga', country: 'Germania', format: 'league' },
  { slug: 'fra.1', name: 'Ligue 1', country: 'Francia', format: 'league' },
  { slug: 'ita.2', name: 'Serie B', country: 'Italia', format: 'league' },
  { slug: 'eng.2', name: 'Championship', country: 'Inghilterra', format: 'league' },
  { slug: 'por.1', name: 'Primeira Liga', country: 'Portogallo', format: 'league' },
  { slug: 'ned.1', name: 'Eredivisie', country: 'Paesi Bassi', format: 'league' },
  { slug: 'uefa.champions', name: 'Champions League', country: 'Europa', format: 'cup' },
  { slug: 'uefa.europa', name: 'Europa League', country: 'Europa', format: 'cup' },
  { slug: 'uefa.europa.conf', name: 'Conference League', country: 'Europa', format: 'cup' },
  { slug: 'usa.1', name: 'MLS', country: 'USA', format: 'league' },
  { slug: 'bra.1', name: 'Brasileirão', country: 'Brasile', format: 'league' },
  { slug: 'arg.1', name: 'Liga Profesional', country: 'Argentina', format: 'league' }
]);

const STATUS = {
  STATUS_SCHEDULED: 'NS', STATUS_FULL_TIME: 'FT', STATUS_FINAL: 'FT', STATUS_FINAL_AET: 'AET', STATUS_FINAL_PEN: 'PEN',
  STATUS_POSTPONED: 'PST', STATUS_CANCELED: 'CANC', STATUS_ABANDONED: 'ABD', STATUS_FORFEIT: 'AWD',
  STATUS_FIRST_HALF: '1H', STATUS_HALFTIME: 'HT', STATUS_SECOND_HALF: '2H', STATUS_EXTRA_TIME: 'ET', STATUS_SHOOTOUT: 'P', STATUS_IN_PROGRESS: 'LIVE'
};
const FINISHED = new Set(['FT', 'AET', 'PEN']);

export function americanToDecimal(value) {
  if (value == null) return null;
  const text = String(value).trim().toUpperCase();
  if (text === 'EVEN' || text === 'EV') return 2;
  const number = Number(text.replace('+', ''));
  if (!Number.isFinite(number) || number === 0 || Math.abs(number) < 100) return null;
  return round(number > 0 ? 1 + number / 100 : 1 + 100 / Math.abs(number), 3);
}

export function encodeFixtureId(slug, eventId) {
  return `espn:${slug}:${eventId}`;
}

export function decodeFixtureId(id) {
  const match = /^espn:([a-z0-9._]+):(\d+)$/i.exec(String(id));
  return match ? { slug: match[1], eventId: match[2] } : null;
}

const localDate = (value, timeZone) => new Intl.DateTimeFormat('sv-SE', { timeZone }).format(new Date(value));
const compactDate = (date) => date.toISOString().slice(0, 10).replace(/-/g, '');
const sideOdd = (side) => americanToDecimal(side?.close?.odds ?? side?.current?.odds ?? side?.odds ?? side?.open?.odds);
const openingOdd = (side) => americanToDecimal(side?.open?.odds);

/** Quote DraftKings da ESPN: 1X2 e Over/Under 2.5, con valori di apertura per il movimento di mercato. */
export function normalizeEspnOdds(rawOdds, retrievedAt) {
  const odds = Array.isArray(rawOdds) ? rawOdds.find((item) => item?.moneyline || item?.homeTeamOdds) : null;
  if (!odds) return null;
  const values = {};
  const opening = {};
  const put = (target, key, value) => { if (Number.isFinite(value) && value > 1) target[key] = value; };
  put(values, '1', sideOdd(odds.moneyline?.home) ?? americanToDecimal(odds.homeTeamOdds?.moneyLine));
  put(values, 'X', sideOdd(odds.moneyline?.draw) ?? americanToDecimal(odds.drawOdds?.moneyLine));
  put(values, '2', sideOdd(odds.moneyline?.away) ?? americanToDecimal(odds.awayTeamOdds?.moneyLine));
  put(opening, '1', openingOdd(odds.moneyline?.home));
  put(opening, 'X', openingOdd(odds.moneyline?.draw));
  put(opening, '2', openingOdd(odds.moneyline?.away));
  const line = Number(odds.overUnder);
  const overLine = String(odds.total?.over?.close?.line ?? odds.total?.over?.open?.line ?? '');
  if (line === 2.5 && (!overLine || overLine.endsWith('2.5'))) {
    put(values, 'OVER_2_5', sideOdd(odds.total?.over));
    put(values, 'UNDER_2_5', sideOdd(odds.total?.under));
    put(opening, 'OVER_2_5', openingOdd(odds.total?.over));
    put(opening, 'UNDER_2_5', openingOdd(odds.total?.under));
  }
  if (!values['1'] || !values.X || !values['2']) return null;
  return {
    bookmaker: `${odds.provider?.displayName || odds.provider?.name || 'Bookmaker'} via ESPN`,
    updatedAt: retrievedAt,
    values,
    opening: Object.keys(opening).length ? opening : null
  };
}

function competitionStatus(competition) {
  return STATUS[competition?.status?.type?.name] || (competition?.status?.type?.completed ? 'FT' : competition?.status?.type?.state === 'in' ? 'LIVE' : 'NS');
}

function mapEvent(event, league) {
  const competition = event.competitions?.[0] || {};
  const home = competition.competitors?.find((item) => item.homeAway === 'home');
  const away = competition.competitors?.find((item) => item.homeAway === 'away');
  if (!home?.team || !away?.team) return null;
  const venue = competition.venue || {};
  return {
    id: encodeFixtureId(league.slug, event.id),
    kickoff: new Date(event.date).toISOString(),
    status: competitionStatus(competition),
    venue: [venue.fullName, venue.address?.city].filter(Boolean).join(', ') || 'Da confermare',
    referee: null,
    league: {
      id: league.slug, name: league.name, country: league.country,
      season: event.season?.year ?? null,
      round: event.week?.number ? `Giornata ${event.week.number}` : (competition.notes?.[0]?.headline || 'Stagione regolare'),
      logo: ''
    },
    home: { id: String(home.team.id), name: home.team.displayName || home.team.name, logo: home.team.logo || '' },
    away: { id: String(away.team.id), name: away.team.displayName || away.team.name, logo: away.team.logo || '' }
  };
}

function regulationGoals(competition) {
  const home = competition?.competitors?.find((item) => item.homeAway === 'home');
  const away = competition?.competitors?.find((item) => item.homeAway === 'away');
  const fromPeriods = (team) => {
    const lines = (team?.linescores || []).map((item) => Number(item.value ?? item.displayValue));
    return lines.length >= 2 && lines.slice(0, 2).every(Number.isFinite) ? lines[0] + lines[1] : null;
  };
  let homeGoals = fromPeriods(home);
  let awayGoals = fromPeriods(away);
  const status = competitionStatus(competition);
  if ((homeGoals == null || awayGoals == null) && status === 'FT') {
    homeGoals = Number(home?.score?.value ?? home?.score);
    awayGoals = Number(away?.score?.value ?? away?.score);
  }
  return Number.isFinite(homeGoals) && Number.isFinite(awayGoals) ? { home: homeGoals, away: awayGoals } : null;
}

function teamStats(entry) {
  if (!entry) return null;
  const stat = (name) => entry.stats?.find((item) => item.name === name)?.value;
  const played = Number(stat('gamesPlayed'));
  if (!(played > 0)) return null;
  const goalsFor = Number(stat('pointsFor'));
  const goalsAgainst = Number(stat('pointsAgainst'));
  return {
    played,
    goalsForHome: null, goalsAgainstHome: null, goalsForAway: null, goalsAgainstAway: null,
    goalsForTotal: round(goalsFor / played, 3),
    goalsAgainstTotal: round(goalsAgainst / played, 3),
    cleanSheets: null, failedToScore: null,
    form: null,
    rank: Number(stat('rank')) || null,
    points: Number(stat('points')) || 0
  };
}

function recentForm(lastFive, teamId, kickoff) {
  const block = (lastFive || []).find((item) => String(item.team?.id) === String(teamId));
  const games = (block?.events || [])
    .filter((game) => Date.parse(game.gameDate) < Date.parse(kickoff))
    .filter((game) => Number.isFinite(Number(game.homeTeamScore)) && Number.isFinite(Number(game.awayTeamScore)));
  if (!games.length) return null;
  let wins = 0; let draws = 0; let losses = 0; let goalsFor = 0; let goalsAgainst = 0;
  for (const game of games) {
    const isHome = String(game.homeTeamId) === String(teamId);
    const scored = Number(isHome ? game.homeTeamScore : game.awayTeamScore);
    const conceded = Number(isHome ? game.awayTeamScore : game.homeTeamScore);
    goalsFor += scored; goalsAgainst += conceded;
    if (scored > conceded) wins += 1; else if (scored === conceded) draws += 1; else losses += 1;
  }
  const lastDate = Math.max(...games.map((game) => Date.parse(game.gameDate)));
  return {
    matches: games.length, wins, draws, losses,
    ppg: round((wins * 3 + draws) / games.length, 3),
    goalsForAverage: round(goalsFor / games.length, 3),
    goalsAgainstAverage: round(goalsAgainst / games.length, 3),
    goalDifferenceAverage: round((goalsFor - goalsAgainst) / games.length, 3),
    restDays: round((Date.parse(kickoff) - lastDate) / 86400000, 1),
    results: games.map((game) => `${game.gameResult || '?'} ${game.score || ''} ${game.atVs === '@' ? 'trasferta' : 'casa'} vs ${game.opponent?.displayName || ''}`.trim())
  };
}

function headToHead(seasonSeries, homeId, kickoff) {
  const events = (seasonSeries || []).flatMap((series) => series.events || [])
    .filter((event) => event.statusType?.completed && Date.parse(event.date) < Date.parse(kickoff));
  let home = 0; let draw = 0; let away = 0; let homeGoals = 0; let awayGoals = 0; let matches = 0;
  for (const event of events) {
    const teams = event.competitors || [];
    const selected = teams.find((item) => String(item.team?.id) === String(homeId));
    const other = teams.find((item) => String(item.team?.id) !== String(homeId));
    const scored = Number(selected?.score);
    const conceded = Number(other?.score);
    if (!Number.isFinite(scored) || !Number.isFinite(conceded)) continue;
    matches += 1; homeGoals += scored; awayGoals += conceded;
    if (scored > conceded) home += 1; else if (scored === conceded) draw += 1; else away += 1;
  }
  return matches ? { matches, home, draw, away, homeGoalsAverage: round(homeGoals / matches, 3), awayGoalsAverage: round(awayGoals / matches, 3) } : null;
}

function relevantNews(leagueArticles, teamArticles, fixture) {
  const names = [fixture.home.name, fixture.away.name].map((name) => name.toLowerCase());
  const keys = names.flatMap((name) => [name, ...name.split(/\s+/).filter((part) => part.length >= 5)]);
  const teamIds = new Set([String(fixture.home.id), String(fixture.away.id)]);
  const mentions = (article) => {
    const text = `${article.headline || ''} ${article.description || ''}`.toLowerCase();
    return keys.some((key) => text.includes(key));
  };
  const taggedTeam = (article) => (article.categories || []).some((category) => category.type === 'team' && teamIds.has(String(category.teamId ?? category.team?.id)));
  const seen = new Set();
  return [...teamArticles.filter((article) => taggedTeam(article) || mentions(article)), ...leagueArticles.filter(mentions)]
    .filter((article) => {
      const key = article.headline || '';
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 8)
    .map((article) => ({
      title: article.headline || '',
      summary: article.description || '',
      publishedAt: article.published || null,
      source: 'ESPN',
      url: article.links?.web?.href || null
    }));
}

function lineupsFrom(rosters) {
  const starters = (side) => (rosters || []).find((item) => item.homeAway === side)?.roster?.filter((player) => player.starter)
    .map((player) => ({ name: player.athlete?.displayName, position: player.position?.abbreviation || null })) || [];
  const home = starters('home');
  const away = starters('away');
  return { home, away, confirmed: home.length >= 11 && away.length >= 11 };
}

/** Partite concluse della stessa stagione della gara (`season.slug`), giocate prima del suo calcio d'inizio. */
export function seasonMatchesFromEvents(events, { eventId, kickoff }) {
  const target = events.find((event) => String(event.id) === String(eventId));
  const season = target?.season?.slug || null;
  if (!season) return { season: null, matches: [] };
  const before = Date.parse(kickoff);
  const matches = [];
  for (const event of events) {
    const competition = event.competitions?.[0];
    if (event.season?.slug !== season || !competition?.status?.type?.completed || !(Date.parse(event.date) < before)) continue;
    const home = competition.competitors?.find((item) => item.homeAway === 'home');
    const away = competition.competitors?.find((item) => item.homeAway === 'away');
    const goals = (team) => Number(team?.score?.value ?? team?.score);
    if (!home?.team?.id || !away?.team?.id || !Number.isFinite(goals(home)) || !Number.isFinite(goals(away))) continue;
    matches.push({ date: event.date, homeId: String(home.team.id), awayId: String(away.team.id), homeGoals: goals(home), awayGoals: goals(away), neutral: Boolean(competition.neutralSite) });
  }
  return { season, matches };
}

export class EspnProvider {
  constructor(config = {}, { leagues = ESPN_LEAGUES, fetchImpl = globalThis.fetch?.bind(globalThis), weather = null } = {}) {
    this.config = config;
    this.mode = 'live';
    this.label = 'ESPN (dati pubblici)';
    this.leagues = leagues;
    this.fetch = fetchImpl;
    this.weather = weather || new WeatherService({ fetchImpl });
    this.cache = new TTLCache(config.cacheTtlMs || 900000, 5000);
    this.seasonCache = new TTLCache(12 * 3600000, 64);
    this.fixtureIndex = new Map();
    this.timezone = config.timezone || 'Europe/Rome';
  }

  async request(path, { force = false } = {}) {
    const url = `${BASE}${path}`;
    if (!force) {
      const cached = this.cache.get(url);
      if (cached !== undefined) return cached;
    }
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const response = await this.fetch(url, {
          headers: { accept: 'application/json' },
          signal: AbortSignal.timeout(this.config.requestTimeoutMs || 15000)
        });
        if (!response.ok) {
          const error = new Error(`ESPN HTTP ${response.status}.`);
          error.retryable = response.status === 429 || response.status >= 500;
          throw error;
        }
        return this.cache.set(url, await response.json());
      } catch (error) {
        lastError = error;
        const retryable = error.retryable === true || ['TimeoutError', 'AbortError', 'TypeError'].includes(error.name);
        if (attempt >= 2 || !retryable) break;
        await new Promise((resolve) => setTimeout(resolve, 300 * (2 ** attempt)));
      }
    }
    throw lastError;
  }

  async #scoreboard(league, yyyymmdd, force) {
    try {
      const payload = await this.request(`/site/v2/sports/soccer/${league.slug}/scoreboard?dates=${yyyymmdd}`, { force });
      return (payload.events || []).map((event) => ({ event, league }));
    } catch {
      return [];
    }
  }

  async getFixtures({ days = this.config.matchDaysAhead || 7, force = false } = {}) {
    const cacheKey = `fixtures:${days}`;
    if (force) this.cache.deleteByPrefix('fixtures:');
    const cached = this.cache.get(cacheKey);
    if (cached) return cached;
    const start = new Date();
    // ESPN interpreta la data nel fuso USA: si legge un giorno in più e si filtra per fuso locale.
    const dates = Array.from({ length: days + 1 }, (_, index) => compactDate(addDays(start, index)));
    const tasks = this.leagues.flatMap((league) => dates.map((date) => () => this.#scoreboard(league, date, force)));
    const results = [];
    let cursor = 0;
    await Promise.all(Array.from({ length: 6 }, async () => {
      while (cursor < tasks.length) {
        const task = tasks[cursor];
        cursor += 1;
        results.push(...await task());
      }
    }));
    const now = Date.now();
    const lastLocalDay = localDate(addDays(start, days - 1), this.timezone);
    const unique = new Map();
    for (const { event, league } of results) {
      const fixture = mapEvent(event, league);
      if (!fixture || unique.has(fixture.id)) continue;
      if (!['NS', 'TBD'].includes(fixture.status)) continue;
      if (Date.parse(fixture.kickoff) < now - 3 * 3600000 || localDate(fixture.kickoff, this.timezone) > lastLocalDay) continue;
      unique.set(fixture.id, fixture);
      this.fixtureIndex.set(fixture.id, { fixture, competition: event.competitions?.[0] || {} });
    }
    const fixtures = [...unique.values()]
      .sort((left, right) => left.kickoff.localeCompare(right.kickoff) || left.league.name.localeCompare(right.league.name))
      .slice(0, this.config.maxFixtures || 400);
    return this.cache.set(cacheKey, fixtures);
  }

  async getFixturesByDate(date, { force = false } = {}) {
    const fixtures = await this.getFixtures({ days: this.config.matchDaysAhead || 7, force });
    return fixtures.filter((fixture) => localDate(fixture.kickoff, this.timezone) === date);
  }

  async #standings(slug, force) {
    const payload = await this.request(`/v2/sports/soccer/${slug}/standings`, { force });
    const groups = payload.children?.length ? payload.children : [payload];
    return groups.flatMap((group) => group.standings?.entries || []);
  }

  /** Tutte le partite di un anno solare per un campionato (una richiesta), in cache 12 ore. */
  async #yearEvents(slug, year) {
    const key = `${slug}:${year}`;
    const cached = this.seasonCache.get(key);
    if (cached !== undefined) return cached;
    const payload = await this.request(`/site/v2/sports/soccer/${slug}/scoreboard?dates=${year}&limit=1000`);
    return this.seasonCache.set(key, payload.events || []);
  }

  /**
   * Elo della stagione: anno del calcio d'inizio e anno precedente (stagioni europee a cavallo dell'anno).
   * Un anno non disponibile non blocca: si usa quello che c'è. Senza la gara negli eventi → null.
   */
  async seasonElo(slug, { eventId, kickoff, homeId, awayId, neutral = false }) {
    const year = new Date(kickoff).getUTCFullYear();
    const results = await Promise.allSettled([this.#yearEvents(slug, year - 1), this.#yearEvents(slug, year)]);
    const events = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
    if (!events.length) throw new Error('Risultati della stagione non disponibili.');
    const { season, matches } = seasonMatchesFromEvents(events, { eventId, kickoff });
    if (!season) return null;
    return { ...eloForFixture(matches, { homeId, awayId, neutral }), season, k: ELO_DEFAULTS.k, homeAdvantage: ELO_DEFAULTS.homeAdvantage };
  }

  /** `lite`: previsione rapida per l'elenco, senza notizie di squadra né meteo (non mostrati nell'elenco). */
  async getAnalysisBundle(fixtureId, { force = false, lite = false } = {}) {
    const decoded = decodeFixtureId(fixtureId);
    if (!decoded) throw Object.assign(new Error('Identificativo ESPN non valido.'), { code: 'not_found' });
    const league = this.leagues.find((item) => item.slug === decoded.slug)
      || { slug: decoded.slug, name: decoded.slug, country: '', format: 'cup' };
    const retrievedAt = new Date().toISOString();
    const sourceErrors = [];
    const sourceStatus = {};
    const summary = await this.request(`/site/v2/sports/soccer/${decoded.slug}/summary?event=${decoded.eventId}`, { force });
    const headerCompetition = summary.header?.competitions?.[0];
    const indexed = this.fixtureIndex.get(fixtureId);
    const fixture = indexed?.fixture || (headerCompetition ? mapEvent({ ...summary.header, id: decoded.eventId, date: headerCompetition.date, competitions: [headerCompetition], season: summary.header?.season }, league) : null);
    if (!fixture) throw Object.assign(new Error('Partita non trovata su ESPN.'), { code: 'not_found' });
    fixture.status = competitionStatus(headerCompetition) || fixture.status;
    const officials = summary.gameInfo?.officials || [];
    fixture.referee = officials.find((item) => /referee/i.test(item.position?.name || item.position?.displayName || ''))?.displayName
      || officials[0]?.displayName || null;

    let standings = [];
    try {
      standings = await this.#standings(decoded.slug, force);
    } catch {
      sourceErrors.push('Classifica: fonte non disponibile.');
    }
    const entryFor = (teamId) => standings.find((entry) => String(entry.team?.id) === String(teamId));
    const homeStats = teamStats(entryFor(fixture.home.id));
    const awayStats = teamStats(entryFor(fixture.away.id));
    sourceStatus.homeStats = { available: Boolean(homeStats) };
    sourceStatus.awayStats = { available: Boolean(awayStats) };

    const recentHome = recentForm(summary.lastFiveGames, fixture.home.id, fixture.kickoff);
    const recentAway = recentForm(summary.lastFiveGames, fixture.away.id, fixture.kickoff);
    if (homeStats && recentHome) homeStats.form = recentHome.results.map((item) => item[0]).join('');
    if (awayStats && recentAway) awayStats.form = recentAway.results.map((item) => item[0]).join('');
    sourceStatus.recentHome = { available: Boolean(recentHome) };
    sourceStatus.recentAway = { available: Boolean(recentAway) };

    const h2h = headToHead(summary.seasonseries, fixture.home.id, fixture.kickoff);
    sourceStatus.h2h = { available: Boolean(h2h) };

    const odds = normalizeEspnOdds(summary.pickcenter?.length ? summary.pickcenter : (summary.odds || indexed?.competition?.odds), retrievedAt)
      || normalizeEspnOdds(indexed?.competition?.odds, retrievedAt);
    sourceStatus.odds = { available: Boolean(odds), error: odds ? null : 'Quote non pubblicate da ESPN per questa partita.' };

    const lineups = lineupsFrom(summary.rosters);
    sourceStatus.lineups = { available: lineups.confirmed, error: lineups.confirmed ? null : 'Formazioni ufficiali non ancora pubblicate.' };
    // ESPN non espone un elenco infortuni per partita: la fonte resta dichiarata come assente.
    sourceStatus.injuries = { available: false, error: 'Elenco indisponibili non fornito dalla fonte pubblica.' };
    sourceStatus.prediction = { available: false, error: 'Nessuna previsione esterna nella fonte pubblica.' };

    const teamArticles = lite ? [] : (await Promise.all([fixture.home.id, fixture.away.id].map(async (teamId) => {
      try {
        const payload = await this.request(`/site/v2/sports/soccer/${decoded.slug}/news?team=${teamId}`, { force });
        return payload.articles || [];
      } catch {
        return [];
      }
    }))).flat();
    const news = relevantNews(summary.news?.articles || [], teamArticles, fixture);

    let weather = null;
    if (!lite) try {
      weather = await this.weather.forecastAt({ venue: fixture.venue, kickoff: fixture.kickoff });
      sourceStatus.weather = { available: Boolean(weather), error: weather ? null : 'Meteo non disponibile: città non riconosciuta o partita oltre 16 giorni.' };
    } catch {
      sourceStatus.weather = { available: false, error: 'Meteo: fonte non raggiungibile.' };
    }
    let elo = null;
    const eloStatus = { available: false, error: lite ? 'Non calcolato nella previsione rapida.' : null };
    if (!lite) {
      try {
        elo = await this.seasonElo(decoded.slug, { eventId: decoded.eventId, kickoff: fixture.kickoff, homeId: fixture.home.id, awayId: fixture.away.id, neutral: Boolean(headerCompetition?.neutralSite) });
        eloStatus.available = Boolean(elo);
        if (!elo) eloStatus.error = 'Stagione non riconosciuta nei risultati ESPN.';
      } catch (error) {
        eloStatus.error = 'Risultati della stagione non disponibili.';
      }
    }
    sourceStatus.elo = eloStatus;
    sourceStatus.referee = { available: Boolean(fixture.referee), error: fixture.referee ? null : 'Arbitro non fornito dalla fonte gratuita.' };
    return {
      fixture,
      homeStats,
      awayStats,
      recentHome,
      recentAway,
      h2h,
      injuries: null,
      prediction: null,
      odds,
      lineups,
      news,
      weather,
      elo,
      standingsContext: {
        home: homeStats ? { rank: homeStats.rank, points: homeStats.points, played: homeStats.played } : null,
        away: awayStats ? { rank: awayStats.rank, points: awayStats.points, played: awayStats.played } : null
      },
      competitionRules: league.format === 'league'
        ? { confirmed: true, knockout: false, legs: 1, extraTime: false, penalties: false, source: 'espn_league_format' }
        : null,
      sourceStatus,
      sourceMetadata: { provider: 'ESPN', retrievedAt, eventUrl: `https://www.espn.com/soccer/match/_/gameId/${decoded.eventId}` },
      sourceErrors
    };
  }

  /** Risultato al 90': somma dei primi due tempi quando ESPN espone i parziali. */
  async getFixtureResult(fixtureId) {
    const decoded = decodeFixtureId(fixtureId);
    if (!decoded) return null;
    const summary = await this.request(`/site/v2/sports/soccer/${decoded.slug}/summary?event=${decoded.eventId}`, { force: true });
    const competition = summary.header?.competitions?.[0];
    if (!competition) return null;
    const status = competitionStatus(competition);
    const goals = regulationGoals(competition);
    return {
      status,
      finished: FINISHED.has(status) && Boolean(goals),
      void: ['CANC', 'ABD', 'AWD'].includes(status),
      goals,
      source: 'ESPN'
    };
  }
}
