// Scarica una volta l'archivio del banco di prova: partite concluse 2025–2026 dei 15 campionati e quote DraftKings
// dal riepilogo di ogni partita. Uscita: data/backtest/<slug>.json (escluso da git, rigenerabile).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESPN_LEAGUES, americanToDecimal, regulationGoals } from '../src/providers/espn.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(root, 'data/backtest');
const BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';
fs.mkdirSync(outDir, { recursive: true });

async function getJson(url) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
      if (response.ok) return await response.json();
      if (response.status < 500 && response.status !== 429) return null;
    } catch { /* nuovo tentativo */ }
    await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
  }
  return null;
}

async function mapLimit(items, limit, mapper) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (next < items.length) { const index = next; next += 1; results[index] = await mapper(items[index]); }
  }));
  return results;
}

let total = 0; let withOdds = 0; let failed = 0;
for (const league of ESPN_LEAGUES) {
  const events = [];
  for (const year of [2025, 2026]) {
    const payload = await getJson(`${BASE}/${league.slug}/scoreboard?dates=${year}&limit=1000`);
    for (const event of payload?.events || []) if (event.competitions?.[0]?.status?.type?.completed && [2025, 2026].includes(event.season?.year)) events.push(event);
  }
  const unique = [...new Map(events.map((event) => [event.id, event])).values()];
  const matches = (await mapLimit(unique, 4, async (event) => {
    const competition = event.competitions[0];
    const home = competition.competitors.find((item) => item.homeAway === 'home');
    const away = competition.competitors.find((item) => item.homeAway === 'away');
    const goals = regulationGoals(competition);
    if (!home || !away || !goals) return null;
    const summary = await getJson(`${BASE}/${league.slug}/summary?event=${event.id}`);
    if (!summary) failed += 1;
    const pick = summary?.pickcenter?.[0];
    const odds = pick ? { '1': americanToDecimal(pick.homeTeamOdds?.moneyLine), X: americanToDecimal(pick.drawOdds?.moneyLine), '2': americanToDecimal(pick.awayTeamOdds?.moneyLine) } : null;
    const validOdds = odds && Object.values(odds).every((value) => value > 1) ? odds : null;
    return { id: String(event.id), slug: league.slug, leagueName: league.name, seasonYear: event.season.year, date: new Date(event.date).toISOString(), homeId: String(home.team.id), awayId: String(away.team.id), homeName: home.team.displayName, awayName: away.team.displayName, homeGoals: goals.home, awayGoals: goals.away, neutral: Boolean(competition.neutralSite), odds: validOdds };
  })).filter(Boolean);
  total += matches.length; withOdds += matches.filter((item) => item.odds).length;
  fs.writeFileSync(path.join(outDir, `${league.slug}.json`), JSON.stringify(matches));
  console.log(`${league.slug}: ${matches.length} partite, ${matches.filter((item) => item.odds).length} con quote`);
}
console.log(`Totale ${total} partite, ${withOdds} con quote, ${failed} riepiloghi non scaricati.`);
