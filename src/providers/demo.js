import { marketsFromMatrix, outcomesFromMatrix, scoreMatrix } from '../prediction/probability.js';
import { addDays, clamp, mulberry32, round } from '../utils.js';

const kickoff = (days, hour) => {
  const date = addDays(new Date(), days);
  date.setUTCHours(hour, 0, 0, 0);
  return date.toISOString();
};

const fixtures = [
  {
    id: 'demo-france-spain', kickoff: kickoff(1, 19), status: 'NS',
    venue: 'Dallas Stadium, Arlington', referee: null,
    league: { id: 1, name: 'Mondiale 2026', country: 'Internazionale', season: 2026, round: 'Semifinale', logo: '' },
    home: { id: 2, name: 'Francia', logo: '' }, away: { id: 3, name: 'Spagna', logo: '' }
  },
  {
    id: 'demo-germany-portugal', kickoff: kickoff(1, 16), status: 'NS',
    venue: 'New York New Jersey Stadium', referee: 'Da confermare',
    league: { id: 1, name: 'Mondiale 2026', country: 'Internazionale', season: 2026, round: 'Semifinale', logo: '' },
    home: { id: 10, name: 'Germania', logo: '' }, away: { id: 11, name: 'Portogallo', logo: '' }
  },
  {
    id: 'demo-flamengo-palmeiras', kickoff: kickoff(1, 20), status: 'NS',
    venue: 'Maracanã', referee: 'Da confermare',
    league: { id: 71, name: 'Brasileirão Série A', country: 'Brasile', season: 2026, round: 'Giornata 18', logo: '' },
    home: { id: 12, name: 'Flamengo', logo: '' }, away: { id: 13, name: 'Palmeiras', logo: '' }
  },
  {
    id: 'demo-river-racing', kickoff: kickoff(1, 21), status: 'NS',
    venue: 'Monumental', referee: 'Da confermare',
    league: { id: 128, name: 'Liga Profesional Argentina', country: 'Argentina', season: 2026, round: 'Giornata 7', logo: '' },
    home: { id: 14, name: 'River Plate', logo: '' }, away: { id: 15, name: 'Racing Club', logo: '' }
  },
  {
    id: 'demo-lafc-seattle', kickoff: kickoff(1, 21), status: 'NS',
    venue: 'BMO Stadium', referee: 'Da confermare',
    league: { id: 253, name: 'Major League Soccer', country: 'USA', season: 2026, round: 'Regular Season', logo: '' },
    home: { id: 16, name: 'Los Angeles FC', logo: '' }, away: { id: 17, name: 'Seattle Sounders', logo: '' }
  },
  {
    id: 'demo-malmo-djurgarden', kickoff: kickoff(1, 17), status: 'NS',
    venue: 'Eleda Stadion', referee: 'Da confermare',
    league: { id: 113, name: 'Allsvenskan', country: 'Svezia', season: 2026, round: 'Giornata 16', logo: '' },
    home: { id: 18, name: 'Malmö FF', logo: '' }, away: { id: 19, name: 'Djurgården', logo: '' }
  },
  {
    id: 'demo-urawa-kashima', kickoff: kickoff(1, 10), status: 'NS',
    venue: 'Saitama Stadium', referee: 'Da confermare',
    league: { id: 98, name: 'J1 League', country: 'Giappone', season: 2026, round: 'Giornata 22', logo: '' },
    home: { id: 20, name: 'Urawa Red Diamonds', logo: '' }, away: { id: 21, name: 'Kashima Antlers', logo: '' }
  },
  {
    id: 'demo-rosenborg-molde', kickoff: kickoff(1, 18), status: 'NS',
    venue: 'Lerkendal Stadion', referee: 'Da confermare',
    league: { id: 103, name: 'Eliteserien', country: 'Norvegia', season: 2026, round: 'Giornata 14', logo: '' },
    home: { id: 22, name: 'Rosenborg', logo: '' }, away: { id: 23, name: 'Molde', logo: '' }
  },
  {
    id: 'demo-celtic-motherwell', kickoff: kickoff(1, 14), status: 'NS',
    venue: 'Celtic Park', referee: 'Da confermare',
    league: { id: 179, name: 'Scottish Premiership', country: 'Scozia', season: 2026, round: 'Giornata 9', logo: '' },
    home: { id: 24, name: 'Celtic', logo: '' }, away: { id: 25, name: 'Motherwell', logo: '' }
  },
  {
    id: 'demo-psv-heerenveen', kickoff: kickoff(1, 12), status: 'NS',
    venue: 'Philips Stadion', referee: 'Da confermare',
    league: { id: 88, name: 'Eredivisie', country: 'Paesi Bassi', season: 2026, round: 'Giornata 8', logo: '' },
    home: { id: 26, name: 'PSV', logo: '' }, away: { id: 27, name: 'Heerenveen', logo: '' }
  },
  {
    id: 'demo-benfica-arouca', kickoff: kickoff(1, 18), status: 'NS',
    venue: 'Estádio da Luz', referee: 'Da confermare',
    league: { id: 94, name: 'Primeira Liga', country: 'Portogallo', season: 2026, round: 'Giornata 8', logo: '' },
    home: { id: 28, name: 'Benfica', logo: '' }, away: { id: 29, name: 'Arouca', logo: '' }
  },
  {
    id: 'demo-salzburg-altach', kickoff: kickoff(1, 15), status: 'NS',
    venue: 'Red Bull Arena', referee: 'Da confermare',
    league: { id: 218, name: 'Bundesliga austriaca', country: 'Austria', season: 2026, round: 'Giornata 10', logo: '' },
    home: { id: 30, name: 'Red Bull Salzburg', logo: '' }, away: { id: 31, name: 'Altach', logo: '' }
  },
  {
    id: 'demo-england-argentina', kickoff: kickoff(2, 19), status: 'NS',
    venue: 'Atlanta Stadium', referee: null,
    league: { id: 1, name: 'Mondiale 2026', country: 'Internazionale', season: 2026, round: 'Semifinale', logo: '' },
    home: { id: 4, name: 'Inghilterra', logo: '' }, away: { id: 5, name: 'Argentina', logo: '' }
  },
  {
    id: 'demo-brasileirao', kickoff: kickoff(2, 22), status: 'NS',
    venue: 'Maracanã', referee: 'Da confermare',
    league: { id: 71, name: 'Brasileirão Série A', country: 'Brasile', season: 2026, round: 'Giornata 18', logo: '' },
    home: { id: 6, name: 'Fluminense', logo: '' }, away: { id: 7, name: 'Santos', logo: '' }
  },
  {
    id: 'demo-mls', kickoff: kickoff(3, 23), status: 'NS',
    venue: 'Chase Stadium', referee: 'Da confermare',
    league: { id: 253, name: 'Major League Soccer', country: 'USA', season: 2026, round: 'Regular Season', logo: '' },
    home: { id: 8, name: 'Inter Miami', logo: '' }, away: { id: 9, name: 'New York City FC', logo: '' }
  }
];

const baseStats = {
  played: 18, goalsForHome: 1.62, goalsAgainstHome: 0.96, goalsForAway: 1.28,
  goalsAgainstAway: 1.22, goalsForTotal: 1.46, goalsAgainstTotal: 1.08,
  cleanSheets: 7, failedToScore: 3, form: 'WWDWW'
};

const recent = (ppg, gf, ga, restDays = 4) => ({
  matches: 10, wins: Math.round(ppg * 10 / 3), draws: 2,
  losses: Math.max(0, 10 - Math.round(ppg * 10 / 3) - 2),
  ppg, goalsForAverage: gf, goalsAgainstAverage: ga,
  goalDifferenceAverage: gf - ga, restDays
});

const makeBundle = ({ homeFor, homeAgainst, awayFor, awayAgainst, homePpg, awayPpg, prediction, odds }) => ({
  homeStats: { ...baseStats, goalsForHome: homeFor, goalsAgainstHome: homeAgainst },
  awayStats: { ...baseStats, goalsForAway: awayFor, goalsAgainstAway: awayAgainst },
  recentHome: recent(homePpg, homeFor, homeAgainst, 4),
  recentAway: recent(awayPpg, awayFor, awayAgainst, 4),
  injuries: { home: [], away: [] },
  prediction,
  h2h: { matches: 5, home: 2, draw: 2, away: 1, homeGoalsAverage: 1.4, awayGoalsAverage: 1.1 },
  lineups: { home: [], away: [], confirmed: false },
  odds: { bookmaker: 'Bet365 Italia · dati dimostrativi', updatedAt: new Date().toISOString(), values: odds }
});

const demoBundles = {
  'demo-france-spain': {
    homeStats: { ...baseStats, played: 6, goalsForHome: 2.67, goalsAgainstHome: 0.33, goalsForTotal: 2.67, goalsAgainstTotal: 0.33, cleanSheets: 4, form: 'WWWWW' },
    awayStats: { ...baseStats, played: 6, goalsForAway: 1.83, goalsAgainstAway: 0.17, goalsForTotal: 1.83, goalsAgainstTotal: 0.17, cleanSheets: 5, form: 'WWWWW' },
    recentHome: recent(3, 2.67, 0.33, 5), recentAway: recent(2.8, 1.83, 0.17, 4),
    injuries: { home: [{ name: 'A. Tchouaméni', reason: 'Condizione da verificare' }, { name: 'W. Saliba', reason: 'Allenamento differenziato' }], away: [] },
    prediction: { home: 0.43, draw: 0.29, away: 0.28, advice: 'Francia leggermente favorita; partita equilibrata.' },
    h2h: { matches: 5, home: 2, draw: 0, away: 3, homeGoalsAverage: 1.8, awayGoalsAverage: 2 },
    lineups: { home: [], away: [], confirmed: false },
    odds: {
      bookmaker: 'Bet365 Italia · dati dimostrativi', updatedAt: new Date().toISOString(),
      values: { '1': 2.35, X: 3.25, '2': 3.1, '1X': 1.36, X2: 1.57, GOAL: 1.8, NO_GOAL: 1.95, OVER_1_5: 1.3, UNDER_1_5: 3.4, OVER_2_5: 1.98, UNDER_2_5: 1.82 }
    }
  },
  'demo-england-argentina': {
    homeStats: { ...baseStats, goalsForHome: 1.75, goalsAgainstHome: 0.88 },
    awayStats: { ...baseStats, goalsForAway: 1.7, goalsAgainstAway: 0.82 },
    recentHome: recent(2.2, 1.8, 0.9, 4), recentAway: recent(2.5, 2, 0.8, 4),
    injuries: { home: [], away: [{ name: 'Giocatore in verifica', reason: 'Affaticamento' }] },
    prediction: { home: 0.32, draw: 0.3, away: 0.38, advice: 'Argentina di misura.' },
    h2h: { matches: 3, home: 1, draw: 1, away: 1, homeGoalsAverage: 1, awayGoalsAverage: 1 },
    lineups: { home: [], away: [], confirmed: false },
    odds: { bookmaker: 'Bet365 Italia · dati dimostrativi', updatedAt: new Date().toISOString(), values: { '1': 2.8, X: 3.1, '2': 2.55, '1X': 1.47, X2: 1.4, GOAL: 1.9, NO_GOAL: 1.84, OVER_1_5: 1.38, UNDER_1_5: 3, OVER_2_5: 2.15, UNDER_2_5: 1.7 } }
  },
  'demo-brasileirao': {
    homeStats: { ...baseStats, goalsForHome: 1.7, goalsAgainstHome: 0.9 },
    awayStats: { ...baseStats, goalsForAway: 1.05, goalsAgainstAway: 1.45 },
    recentHome: recent(2.1, 1.6, 1, 3), recentAway: recent(1.1, 1, 1.5, 3),
    injuries: { home: [], away: [] }, prediction: { home: 0.52, draw: 0.27, away: 0.21, advice: 'Fluminense favorito.' },
    h2h: { matches: 8, home: 4, draw: 2, away: 2, homeGoalsAverage: 1.5, awayGoalsAverage: 1 }, lineups: { home: [], away: [], confirmed: false },
    odds: { bookmaker: 'Bet365 Italia · dati dimostrativi', updatedAt: new Date().toISOString(), values: { '1': 1.85, X: 3.45, '2': 4.2, '1X': 1.2, X2: 1.88, GOAL: 1.95, NO_GOAL: 1.8, OVER_1_5: 1.32, UNDER_1_5: 3.25, OVER_2_5: 2.05, UNDER_2_5: 1.75 } }
  },
  'demo-mls': {
    homeStats: { ...baseStats, goalsForHome: 2.05, goalsAgainstHome: 1.48 },
    awayStats: { ...baseStats, goalsForAway: 1.55, goalsAgainstAway: 1.7 },
    recentHome: recent(1.9, 2, 1.4, 4), recentAway: recent(1.5, 1.5, 1.6, 4),
    injuries: { home: [], away: [] }, prediction: { home: 0.49, draw: 0.25, away: 0.26, advice: 'Inter Miami favorito in gara da gol.' },
    h2h: { matches: 7, home: 3, draw: 2, away: 2, homeGoalsAverage: 1.7, awayGoalsAverage: 1.4 }, lineups: { home: [], away: [], confirmed: false },
    odds: { bookmaker: 'Bet365 Italia · dati dimostrativi', updatedAt: new Date().toISOString(), values: { '1': 1.95, X: 3.8, '2': 3.5, '1X': 1.28, X2: 1.78, GOAL: 1.6, NO_GOAL: 2.2, OVER_1_5: 1.18, UNDER_1_5: 4.5, OVER_2_5: 1.65, UNDER_2_5: 2.18 } }
  },
  'demo-germany-portugal': makeBundle({
    homeFor: 1.85, homeAgainst: 0.8, awayFor: 1.65, awayAgainst: 0.9, homePpg: 2.35, awayPpg: 2.2,
    prediction: { home: 0.39, draw: 0.3, away: 0.31, advice: 'Germania di misura in partita equilibrata.' },
    odds: { '1': 2.45, X: 3.2, '2': 2.9, '1X': 1.38, X2: 1.5, GOAL: 1.78, NO_GOAL: 1.98, OVER_1_5: 1.3, UNDER_1_5: 3.45, OVER_2_5: 1.95, UNDER_2_5: 1.85 }
  }),
  'demo-flamengo-palmeiras': makeBundle({
    homeFor: 2.05, homeAgainst: 0.82, awayFor: 1.45, awayAgainst: 1.08, homePpg: 2.5, awayPpg: 1.85,
    prediction: { home: 0.5, draw: 0.28, away: 0.22, advice: 'Flamengo favorito per forza interna.' },
    odds: { '1': 1.82, X: 3.5, '2': 4.35, '1X': 1.19, X2: 1.9, GOAL: 1.9, NO_GOAL: 1.84, OVER_1_5: 1.29, UNDER_1_5: 3.55, OVER_2_5: 1.98, UNDER_2_5: 1.82 }
  }),
  'demo-river-racing': makeBundle({
    homeFor: 1.9, homeAgainst: 0.72, awayFor: 1.2, awayAgainst: 1.22, homePpg: 2.4, awayPpg: 1.55,
    prediction: { home: 0.54, draw: 0.27, away: 0.19, advice: 'River Plate favorito.' },
    odds: { '1': 1.72, X: 3.55, '2': 5, '1X': 1.15, X2: 2.05, GOAL: 2.02, NO_GOAL: 1.72, OVER_1_5: 1.32, UNDER_1_5: 3.3, OVER_2_5: 2.08, UNDER_2_5: 1.72 }
  }),
  'demo-lafc-seattle': makeBundle({
    homeFor: 2.15, homeAgainst: 1.35, awayFor: 1.62, awayAgainst: 1.58, homePpg: 2.05, awayPpg: 1.45,
    prediction: { home: 0.49, draw: 0.25, away: 0.26, advice: 'LAFC favorito in gara aperta.' },
    odds: { '1': 1.92, X: 3.85, '2': 3.6, '1X': 1.27, X2: 1.82, GOAL: 1.55, NO_GOAL: 2.35, OVER_1_5: 1.17, UNDER_1_5: 4.8, OVER_2_5: 1.62, UNDER_2_5: 2.22 }
  }),
  'demo-malmo-djurgarden': makeBundle({
    homeFor: 2.2, homeAgainst: 0.78, awayFor: 1.18, awayAgainst: 1.35, homePpg: 2.55, awayPpg: 1.4,
    prediction: { home: 0.58, draw: 0.25, away: 0.17, advice: 'Malmö nettamente favorito.' },
    odds: { '1': 1.6, X: 3.95, '2': 5.6, '1X': 1.11, X2: 2.25, GOAL: 1.88, NO_GOAL: 1.86, OVER_1_5: 1.24, UNDER_1_5: 3.9, OVER_2_5: 1.82, UNDER_2_5: 1.98 }
  }),
  'demo-urawa-kashima': makeBundle({
    homeFor: 1.55, homeAgainst: 0.92, awayFor: 1.35, awayAgainst: 1.05, homePpg: 2.05, awayPpg: 1.75,
    prediction: { home: 0.43, draw: 0.3, away: 0.27, advice: 'Urawa leggermente favorito.' },
    odds: { '1': 2.15, X: 3.2, '2': 3.45, '1X': 1.3, X2: 1.67, GOAL: 1.92, NO_GOAL: 1.82, OVER_1_5: 1.36, UNDER_1_5: 3.05, OVER_2_5: 2.15, UNDER_2_5: 1.7 }
  }),
  'demo-rosenborg-molde': makeBundle({
    homeFor: 1.82, homeAgainst: 1.3, awayFor: 1.88, awayAgainst: 1.38, homePpg: 1.8, awayPpg: 1.95,
    prediction: { home: 0.35, draw: 0.28, away: 0.37, advice: 'Equilibrio con lieve vantaggio Molde.' },
    odds: { '1': 2.65, X: 3.55, '2': 2.45, '1X': 1.52, X2: 1.43, GOAL: 1.58, NO_GOAL: 2.28, OVER_1_5: 1.2, UNDER_1_5: 4.2, OVER_2_5: 1.67, UNDER_2_5: 2.15 }
  }),
  'demo-celtic-motherwell': makeBundle({
    homeFor: 2.7, homeAgainst: 0.62, awayFor: 0.95, awayAgainst: 1.75, homePpg: 2.65, awayPpg: 1.15,
    prediction: { home: 0.7, draw: 0.18, away: 0.12, advice: 'Celtic nettamente favorito.' },
    odds: { '1': 1.75, X: 4.23, '2': 5.7, '1X': 1.14, X2: 2.43, GOAL: 1.7, NO_GOAL: 2.16, OVER_1_5: 1.19, UNDER_1_5: 4.81, OVER_2_5: 1.67, UNDER_2_5: 2.21 }
  }),
  'demo-psv-heerenveen': makeBundle({
    homeFor: 2.85, homeAgainst: 0.75, awayFor: 1.25, awayAgainst: 1.85, homePpg: 2.6, awayPpg: 1.3,
    prediction: { home: 0.68, draw: 0.18, away: 0.14, advice: 'PSV favorito in gara ad alto punteggio.' },
    odds: { '1': 1.79, X: 4.25, '2': 5.23, '1X': 1.16, X2: 2.35, GOAL: 1.6, NO_GOAL: 2.36, OVER_1_5: 1.15, UNDER_1_5: 5.51, OVER_2_5: 1.57, UNDER_2_5: 2.43 }
  }),
  'demo-benfica-arouca': makeBundle({
    homeFor: 2.4, homeAgainst: 0.7, awayFor: 1.05, awayAgainst: 1.6, homePpg: 2.5, awayPpg: 1.25,
    prediction: { home: 0.66, draw: 0.2, away: 0.14, advice: 'Benfica favorito.' },
    odds: { '1': 1.86, X: 4, '2': 5.01, '1X': 1.18, X2: 2.23, GOAL: 1.71, NO_GOAL: 2.15, OVER_1_5: 1.21, UNDER_1_5: 4.51, OVER_2_5: 1.73, UNDER_2_5: 2.12 }
  }),
  'demo-salzburg-altach': makeBundle({
    homeFor: 2.55, homeAgainst: 0.8, awayFor: 1.0, awayAgainst: 1.65, homePpg: 2.45, awayPpg: 1.2,
    prediction: { home: 0.64, draw: 0.2, away: 0.16, advice: 'Salzburg favorito.' },
    odds: { '1': 1.87, X: 4.02, '2': 4.93, '1X': 1.18, X2: 2.21, GOAL: 1.69, NO_GOAL: 2.19, OVER_1_5: 1.19, UNDER_1_5: 4.69, OVER_2_5: 1.69, UNDER_2_5: 2.17 }
  })
};

const localDate = (value) => new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Rome' }).format(new Date(value));

const allAvailableSources = () => ({
  homeStats: { available: true }, awayStats: { available: true },
  recentHome: { available: true }, recentAway: { available: true },
  h2h: { available: true }, injuries: { available: true },
  prediction: { available: true }, odds: { available: true }, lineups: { available: true }
});

// Archivio dimostrativo per il tab Performance: squadre fittizie, dati pre-partita rumorosi e risultati
// campionati da un processo "vero" noto solo al generatore. Deterministico (seed fisso), mai presentato come reale.
const ARCHIVE_SEED = 20260718;
const ARCHIVE_SIZE = 60;
const ARCHIVE_TEAMS = [
  'Valdora', 'Montebruno', 'Porto Alba', 'San Lauro', 'Castelvento', 'Ripafonda', 'Borgo Sereno', 'Lago Verde',
  'Torre Alta', 'Monteluce', 'Fiumara', 'Collerosso', 'Rocca Nera', 'Vallescura', 'Campobello Demo', 'Marina Grande'
];
const ARCHIVE_LEAGUES = [
  { id: 9001, name: 'Lega Demo Nord', country: 'Demo', season: 2026, logo: '' },
  { id: 9002, name: 'Lega Demo Sud', country: 'Demo', season: 2026, logo: '' }
];

function gaussian(random) {
  const u = Math.max(random(), 1e-12);
  const v = random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function poissonSample(lambda, random) {
  const limit = Math.exp(-lambda);
  let product = random();
  let goals = 0;
  while (product > limit) {
    goals += 1;
    product *= random();
  }
  return goals;
}

function pricedOdd(probability, noise, margin = 1.06) {
  return round(clamp(1 / (probability * noise * margin), 1.01, 40), 2);
}

function buildArchive(now = new Date()) {
  const random = mulberry32(ARCHIVE_SEED);
  const ratings = ARCHIVE_TEAMS.map(() => clamp(gaussian(random) * 0.28, -0.5, 0.5));
  const items = [];
  for (let index = 0; index < ARCHIVE_SIZE; index += 1) {
    const leagueIndex = index % 2;
    const pool = ARCHIVE_TEAMS.map((_, teamIndex) => teamIndex).filter((teamIndex) => teamIndex % 2 === leagueIndex);
    const homeIndex = pool[Math.floor(random() * pool.length)];
    let awayIndex = pool[Math.floor(random() * pool.length)];
    if (awayIndex === homeIndex) awayIndex = pool[(pool.indexOf(homeIndex) + 1) % pool.length];
    const difference = ratings[homeIndex] - ratings[awayIndex];
    const trueHome = clamp(1.42 * Math.exp(0.62 * difference), 0.45, 3.2);
    const trueAway = clamp(1.12 * Math.exp(-0.62 * difference), 0.35, 2.8);
    const trueMatrix = scoreMatrix(trueHome, trueAway);
    const trueOutcomes = outcomesFromMatrix(trueMatrix);
    const trueMarkets = marketsFromMatrix(trueMatrix);
    const noisy = (value, spread = 0.14) => round(Math.max(0.15, value * Math.exp(gaussian(random) * spread)), 2);
    const bookNoise = () => Math.exp(gaussian(random) * 0.06);
    const kickoffDate = addDays(now, -(1 + Math.floor(index / 6)));
    kickoffDate.setUTCHours(11 + (index % 6) * 2, 0, 0, 0);
    const kickoff = kickoffDate.toISOString();
    const homePpg = round(clamp(1.45 + difference * 1.7 + gaussian(random) * 0.25, 0.3, 2.9), 2);
    const awayPpg = round(clamp(1.35 - difference * 1.7 + gaussian(random) * 0.25, 0.3, 2.9), 2);
    const providerNoise = [0, 1, 2].map(() => Math.exp(gaussian(random) * 0.12));
    const providerRaw = [trueOutcomes.home * providerNoise[0], trueOutcomes.draw * providerNoise[1], trueOutcomes.away * providerNoise[2]];
    const providerTotal = providerRaw.reduce((sum, value) => sum + value, 0);
    const odds = {
      '1': pricedOdd(trueOutcomes.home, bookNoise()), X: pricedOdd(trueOutcomes.draw, bookNoise()), '2': pricedOdd(trueOutcomes.away, bookNoise()),
      '1X': pricedOdd(trueOutcomes.home + trueOutcomes.draw, bookNoise(), 1.05), X2: pricedOdd(trueOutcomes.draw + trueOutcomes.away, bookNoise(), 1.05),
      GOAL: pricedOdd(trueMarkets.GOAL, bookNoise()), NO_GOAL: pricedOdd(trueMarkets.NO_GOAL, bookNoise()),
      OVER_1_5: pricedOdd(trueMarkets.OVER_1_5, bookNoise()), UNDER_1_5: pricedOdd(trueMarkets.UNDER_1_5, bookNoise()),
      OVER_2_5: pricedOdd(trueMarkets.OVER_2_5, bookNoise()), UNDER_2_5: pricedOdd(trueMarkets.UNDER_2_5, bookNoise())
    };
    const fixture = {
      id: `demo-archive-${String(index + 1).padStart(3, '0')}`,
      kickoff,
      status: 'FT',
      venue: `Stadio di ${ARCHIVE_TEAMS[homeIndex]} (demo)`,
      referee: 'Arbitro demo',
      league: { ...ARCHIVE_LEAGUES[leagueIndex], round: `Giornata ${10 + Math.floor(index / 6)}` },
      home: { id: 9100 + homeIndex, name: ARCHIVE_TEAMS[homeIndex], logo: '' },
      away: { id: 9100 + awayIndex, name: ARCHIVE_TEAMS[awayIndex], logo: '' }
    };
    const bundle = {
      fixture: { ...fixture, status: 'NS' },
      ...makeBundle({
        homeFor: noisy(trueHome), homeAgainst: noisy(trueAway), awayFor: noisy(trueAway), awayAgainst: noisy(trueHome),
        homePpg, awayPpg,
        prediction: {
          home: providerRaw[0] / providerTotal, draw: providerRaw[1] / providerTotal, away: providerRaw[2] / providerTotal,
          advice: 'Previsione provider dimostrativa.'
        },
        odds
      }),
      news: [],
      competitionRules: { confirmed: true, knockout: false, legs: 1, extraTime: false, penalties: false, source: 'demo_competition_rules' },
      sourceStatus: allAvailableSources(),
      sourceMetadata: { provider: 'demo', retrievedAt: new Date(Date.parse(kickoff) - 3 * 3600000).toISOString() },
      sourceErrors: []
    };
    bundle.odds.bookmaker = 'Bookmaker dimostrativo';
    bundle.odds.updatedAt = new Date(Date.parse(kickoff) - 4 * 3600000).toISOString();
    const goals = { home: poissonSample(trueHome, random), away: poissonSample(trueAway, random) };
    items.push({ fixture, bundle, result: { status: 'FT', finished: true, goals, source: 'demo_simulated_result' } });
  }
  return items;
}

export class DemoProvider {
  constructor() {
    this.mode = 'demo';
    this.archive = null;
  }

  async getFixtures() {
    return fixtures;
  }

  async getFixturesByDate(date) {
    return fixtures.filter((fixture) => localDate(fixture.kickoff) === date);
  }

  /** Partite dimostrative concluse con dati pre-partita, usate per popolare il registro Performance. */
  getArchive() {
    this.archive ||= buildArchive();
    return structuredClone(this.archive);
  }

  async getFixtureResult(fixtureId) {
    const archived = this.getArchive().find((item) => String(item.fixture.id) === String(fixtureId));
    if (archived) return archived.result;
    const fixture = fixtures.find((item) => String(item.id) === String(fixtureId));
    return fixture ? { status: fixture.status, finished: false, goals: null } : null;
  }

  async getAnalysisBundle(fixtureId) {
    const fixture = fixtures.find((item) => String(item.id) === String(fixtureId));
    if (!fixture) throw Object.assign(new Error('Partita dimostrativa non trovata.'), { code: 'not_found' });
    return {
      fixture,
      ...structuredClone(demoBundles[fixture.id]),
      news: [],
      competitionRules: fixture.league.id === 1 ? {
        confirmed: true,
        knockout: true,
        legs: 1,
        extraTime: true,
        penalties: true,
        awayGoalsRule: false,
        source: 'demo_competition_rules'
      } : {
        confirmed: true,
        knockout: false,
        legs: 1,
        extraTime: false,
        penalties: false,
        source: 'demo_competition_rules'
      },
      sourceStatus: allAvailableSources(),
      sourceMetadata: { provider: 'demo', retrievedAt: new Date().toISOString() },
      sourceErrors: []
    };
  }
}
