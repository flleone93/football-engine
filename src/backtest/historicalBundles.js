// Ricostruisce, per ogni partita passata, i dati che il motore avrebbe avuto PRIMA del calcio d'inizio.
// Solo partite precedenti della stessa stagione e dello stesso campionato: nessun dato dal futuro.
import { ELO_DEFAULTS, eloForFixture } from '../prediction/elo.js';
import { round } from '../utils.js';

const groupKey = (match) => `${match.slug}|${match.seasonYear}`;

function teamGames(previous, teamId) {
  return previous.filter((item) => item.homeId === teamId || item.awayId === teamId).map((item) => {
    const home = item.homeId === teamId;
    return { date: item.date, scored: home ? item.homeGoals : item.awayGoals, conceded: home ? item.awayGoals : item.homeGoals };
  });
}

function stats(games) {
  if (!games.length) return null;
  const goalsFor = games.reduce((sum, game) => sum + game.scored, 0);
  const goalsAgainst = games.reduce((sum, game) => sum + game.conceded, 0);
  return {
    played: games.length,
    goalsForHome: null, goalsAgainstHome: null, goalsForAway: null, goalsAgainstAway: null,
    goalsForTotal: round(goalsFor / games.length, 3),
    goalsAgainstTotal: round(goalsAgainst / games.length, 3),
    cleanSheets: null, failedToScore: null, form: null, rank: null, points: 0
  };
}

function recent(games, kickoff) {
  const last = games.slice(-5);
  if (!last.length) return null;
  let wins = 0; let draws = 0; let losses = 0; let goalsFor = 0; let goalsAgainst = 0;
  for (const game of last) {
    goalsFor += game.scored; goalsAgainst += game.conceded;
    if (game.scored > game.conceded) wins += 1; else if (game.scored === game.conceded) draws += 1; else losses += 1;
  }
  return {
    matches: last.length, wins, draws, losses,
    ppg: round((wins * 3 + draws) / last.length, 3),
    goalsForAverage: round(goalsFor / last.length, 3),
    goalsAgainstAverage: round(goalsAgainst / last.length, 3),
    goalDifferenceAverage: round((goalsFor - goalsAgainst) / last.length, 3),
    restDays: round((Date.parse(kickoff) - Date.parse(last[last.length - 1].date)) / 86400000, 1),
    results: last.map((game) => `${game.scored}-${game.conceded}`)
  };
}

function headToHead(previous, homeId, awayId) {
  const meetings = previous.filter((item) => (item.homeId === homeId && item.awayId === awayId) || (item.homeId === awayId && item.awayId === homeId));
  if (!meetings.length) return null;
  let home = 0; let draw = 0; let away = 0; let homeGoals = 0; let awayGoals = 0;
  for (const item of meetings) {
    const scored = item.homeId === homeId ? item.homeGoals : item.awayGoals;
    const conceded = item.homeId === homeId ? item.awayGoals : item.homeGoals;
    homeGoals += scored; awayGoals += conceded;
    if (scored > conceded) home += 1; else if (scored === conceded) draw += 1; else away += 1;
  }
  return { matches: meetings.length, home, draw, away, homeGoalsAverage: round(homeGoals / meetings.length, 3), awayGoalsAverage: round(awayGoals / meetings.length, 3) };
}

export function buildHistoricalBundles(matches) {
  const ordered = [...matches].sort((left, right) => left.date.localeCompare(right.date) || String(left.id).localeCompare(String(right.id)));
  const history = new Map();
  const rows = [];
  for (const match of ordered) {
    const key = groupKey(match);
    const previous = history.get(key) || [];
    const homeGames = teamGames(previous, match.homeId);
    const awayGames = teamGames(previous, match.awayId);
    const elo = eloForFixture(previous.map((item) => ({ date: item.date, homeId: item.homeId, awayId: item.awayId, homeGoals: item.homeGoals, awayGoals: item.awayGoals, neutral: item.neutral })), { homeId: match.homeId, awayId: match.awayId, neutral: match.neutral });
    const bundle = {
      fixture: { id: `bt:${match.slug}:${match.id}`, kickoff: match.date, status: 'NS', referee: null, venue: '', league: { id: match.slug, name: match.leagueName, season: match.seasonYear, round: '' }, home: { id: match.homeId, name: match.homeName }, away: { id: match.awayId, name: match.awayName } },
      homeStats: stats(homeGames),
      awayStats: stats(awayGames),
      recentHome: recent(homeGames, match.date),
      recentAway: recent(awayGames, match.date),
      h2h: headToHead(previous, match.homeId, match.awayId),
      injuries: null,
      prediction: null,
      lineups: null,
      news: [],
      weather: null,
      odds: match.odds ? { values: { ...match.odds }, bookmaker: 'DraftKings (chiusura)' } : null,
      elo: { ...elo, season: String(match.seasonYear), k: ELO_DEFAULTS.k, homeAdvantage: ELO_DEFAULTS.homeAdvantage },
      sourceStatus: { odds: { available: Boolean(match.odds) } },
      sourceErrors: []
    };
    rows.push({ match, bundle });
    history.set(key, [...previous, match]);
  }
  return rows;
}
