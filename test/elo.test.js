import assert from 'node:assert/strict';
import test from 'node:test';
import { computeElo, eloExpectation, eloForFixture } from '../src/prediction/elo.js';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { DemoProvider } from '../src/providers/demo.js';
import { EspnProvider, seasonMatchesFromEvents } from '../src/providers/espn.js';

const match = (date, homeId, awayId, homeGoals, awayGoals, neutral = false) => ({ date, homeId, awayId, homeGoals, awayGoals, neutral });

test('Elo: valori noti con K=20 e vantaggio casa 60', () => {
  const expected = 1 / (1 + 10 ** (-60 / 400));
  assert.ok(Math.abs(eloExpectation(1500, 1500) - expected) < 1e-12);
  const ratings = computeElo([match('2026-09-01', 'A', 'B', 2, 0)]);
  assert.ok(Math.abs(ratings.get('A').rating - (1500 + 20 * (1 - expected))) < 1e-9);
  assert.ok(Math.abs(ratings.get('B').rating - (1500 - 20 * (1 - expected))) < 1e-9);
  assert.equal(ratings.get('A').games, 1);
});

test('Elo: pareggio, ordine cronologico e somma costante', () => {
  const ratings = computeElo([match('2026-09-08', 'B', 'A', 1, 1), match('2026-09-01', 'A', 'B', 0, 1)]);
  const afterFirst = 1500 + 20 * eloExpectation(1500, 1500);
  assert.ok(ratings.get('B').rating < afterFirst, 'B vince fuori, poi pareggia in casa da favorita e perde punti');
  assert.ok(ratings.get('B').rating > 1500);
  assert.ok(Math.abs(ratings.get('A').rating + ratings.get('B').rating - 3000) < 1e-9);
});

test('Elo: campo neutro senza vantaggio casa', () => {
  assert.equal(eloExpectation(1500, 1500, { neutral: true }), 0.5);
  const ratings = computeElo([match('2026-09-01', 'A', 'B', 1, 0, true)]);
  assert.ok(Math.abs(ratings.get('A').rating - 1510) < 1e-9);
});

test('Elo per la partita: squadra senza partite a 1500, nessun crash', () => {
  const elo = eloForFixture([match('2026-09-01', 'A', 'B', 3, 1)], { homeId: 'A', awayId: 'NUOVA', neutral: false });
  assert.equal(elo.away.rating, 1500);
  assert.equal(elo.away.games, 0);
  assert.equal(elo.matches, 1);
  assert.ok(elo.expectedHome > 0.5 && elo.expectedHome < 1);
  assert.equal(eloForFixture([], { homeId: 'X', awayId: 'Y' }).matches, 0);
});

const espnEvent = (id, date, slug, homeId, awayId, homeScore, awayScore, completed = true, neutral = false) => ({
  id, date, season: { year: Number(String(slug).slice(0, 4)), slug },
  competitions: [{ neutralSite: neutral, status: { type: { completed } }, competitors: [
    { homeAway: 'home', team: { id: homeId }, score: homeScore == null ? undefined : { value: homeScore } },
    { homeAway: 'away', team: { id: awayId }, score: awayScore == null ? undefined : String(awayScore) }
  ] }]
});

test('ESPN → partite della stessa stagione, concluse e precedenti al calcio d inizio', () => {
  const events = [
    espnEvent('1', '2026-05-20T18:00Z', '2025-26', 'A', 'B', 1, 0),
    espnEvent('2', '2026-09-01T18:00Z', '2026-27', 'A', 'B', 2, 2),
    espnEvent('3', '2026-09-08T18:00Z', '2026-27', 'B', 'C', 0, 1, true, true),
    espnEvent('4', '2026-10-20T18:00Z', '2026-27', 'C', 'A', null, null, false),
    espnEvent('9', '2026-10-12T18:00Z', '2026-27', 'A', 'C', null, null, false)
  ];
  const { season, matches } = seasonMatchesFromEvents(events, { eventId: '9', kickoff: '2026-10-12T18:00:00Z' });
  assert.equal(season, '2026');
  assert.deepEqual(matches.map((item) => [item.homeId, item.awayId, item.homeGoals, item.awayGoals, item.neutral]), [['A', 'B', 2, 2, false], ['B', 'C', 0, 1, true]]);
  assert.deepEqual(seasonMatchesFromEvents(events, { eventId: 'assente', kickoff: '2026-10-12T18:00:00Z' }), { season: null, matches: [] });
});

function fakeEspnFetch({ failYear = null } = {}) {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    if (url.includes('/scoreboard?dates=')) {
      const year = url.match(/dates=(\d{4})&/)?.[1];
      if (year === failYear) return new Response('{}', { status: 500 });
      if (year === '2025') return ok({ events: [espnEvent('1', '2025-12-10T18:00Z', '2025-26', '10', '20', 3, 0)] });
      return ok({ events: [espnEvent('2', '2026-01-05T18:00Z', '2025-26', '20', '10', 1, 1), espnEvent('777', '2026-01-20T18:00Z', '2025-26', '10', '20', null, null, false)] });
    }
    return ok({});
  };
  return { fetchImpl, calls };
}

test('provider: Elo da due anni solari (stagione a cavallo), una richiesta fallita non blocca', async () => {
  const provider = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: fakeEspnFetch().fetchImpl, weather: { forecastAt: async () => null } });
  const elo = await provider.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20', neutral: false });
  assert.equal(elo.matches, 2, 'dicembre 2025 + gennaio 2026');
  assert.equal(elo.season, '2025');
  assert.ok(elo.home.rating > elo.away.rating);
  assert.deepEqual([elo.k, elo.homeAdvantage], [20, 60]);
  const partial = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: fakeEspnFetch({ failYear: '2025' }).fetchImpl, weather: { forecastAt: async () => null } });
  const reduced = await partial.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20', neutral: false });
  assert.equal(reduced.matches, 1);
  const cached = fakeEspnFetch();
  const again = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: cached.fetchImpl, weather: { forecastAt: async () => null } });
  await again.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20' });
  await again.seasonElo('ita.1', { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '20', awayId: '10' });
  assert.equal(cached.calls.length, 2, 'risultati della stagione in cache');
});

test('motore: Elo mostrato e tra i fattori, ensemble invariato', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const config = buildConfig({ DEMO_MODE: 'true' });
  const without = analyzeMatch(bundle, { neutral: true }, config);
  const elo = { home: { rating: 1600, games: 8 }, away: { rating: 1450, games: 8 }, expectedHome: 0.7, matches: 40, season: '2026-27', k: 20, homeAdvantage: 60 };
  const withElo = analyzeMatch({ ...bundle, elo }, { neutral: true }, config);
  assert.deepEqual(withElo.summary.outcomes, without.summary.outcomes, 'l Elo non entra nell ensemble');
  assert.deepEqual([withElo.context.elo.home, withElo.context.elo.away], [elo.home, elo.away]);
  assert.ok(Math.abs(withElo.context.elo.expectedHome - 1 / (1 + 10 ** (-150 / 400))) < 1e-3, 'campo neutro: attesa ricalcolata senza vantaggio casa');
  assert.equal(without.context.elo, null);
  const factor = withElo.factors.find((item) => item.name === 'Rating Elo');
  assert.equal(factor.direction, bundle.fixture.home.name);
  assert.equal(without.factors.some((item) => item.name === 'Rating Elo'), false);
});

test('ESPN → stagione identificata dall anno: fasi diverse unite, anni diversi separati', () => {
  const event = (id, date, year, slug, home, away, hs, as, completed = true) => ({ ...espnEvent(id, date, slug, home, away, hs, as, completed), season: { year, slug } });
  const events = [
    event('1', '2025-09-10T18:00Z', 2025, 'regular-season', 'A', 'B', 1, 0),
    event('2', '2026-03-10T18:00Z', 2026, 'regular-season', 'A', 'B', 2, 0),
    event('3', '2026-05-10T18:00Z', 2026, 'promotion-final', 'B', 'A', 0, 0),
    event('9', '2026-06-10T18:00Z', 2026, 'promotion-final', 'A', 'B', null, null, false)
  ];
  const { season, matches } = seasonMatchesFromEvents(events, { eventId: '9', kickoff: '2026-06-10T18:00:00Z' });
  assert.equal(season, '2026');
  assert.equal(matches.length, 2, 'solo la stagione 2026, con tutte le sue fasi');
});

test('agenti AI: il fattore Elo non entra nell evidence pack (non deve spostare le probabilità)', async () => {
  const { buildAgentEvidencePack } = await import('../src/ai/orchestrator.js');
  const bundle = await new DemoProvider().getAnalysisBundle('demo-france-spain');
  const elo = { home: { rating: 1600, games: 8 }, away: { rating: 1450, games: 8 }, expectedHome: 0.7, matches: 40, season: '2026', k: 20, homeAdvantage: 60 };
  const baseline = analyzeMatch({ ...bundle, elo }, { neutral: true }, buildConfig({ DEMO_MODE: 'true' }));
  assert.ok(baseline.factors.some((item) => item.name === 'Rating Elo'));
  for (const agentId of ['tactical_context', 'competition_context', 'challenge_bias', 'final_explanation', 'news_intelligence']) {
    const pack = buildAgentEvidencePack({ ...bundle, elo }, baseline, agentId);
    assert.equal(JSON.stringify(pack).includes('Rating Elo'), false, agentId);
    assert.equal(JSON.stringify(pack).includes('"elo"'), false, agentId);
  }
});

test('Top del giorno non chiede l Elo; l analisi singola sì (chiave di cache distinta)', async () => {
  const { createApi } = await import('../src/api.js');
  const { TTLCache } = await import('../src/cache.js');
  const { HybridAiOrchestrator } = await import('../src/ai/orchestrator.js');
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  const demo = new DemoProvider();
  const options = [];
  const provider = { mode: 'demo', getFixtures: (o) => demo.getFixtures(o), getFixturesByDate: (d, o) => demo.getFixturesByDate(d, o), getAnalysisBundle: (id, o = {}) => { options.push({ id, ...o }); return demo.getAnalysisBundle(id, o); } };
  const api = createApi({ config, provider, aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500) });
  const [first] = await demo.getFixtures({ days: 7 });
  const date = new Intl.DateTimeFormat('sv-SE', { timeZone: config.timezone }).format(new Date(first.kickoff));
  await api.handle({ method: 'POST', pathname: '/api/top-picks', readBody: async () => ({ date, limit: 5, stake: 10 }), requestId: 't' });
  assert.ok(options.length > 0);
  assert.ok(options.every((item) => item.elo === false), 'Top del giorno senza Elo');
  options.length = 0;
  await api.handle({ method: 'POST', pathname: '/api/analyze', readBody: async () => ({ fixtureId: first.id, useAi: false }), requestId: 't' });
  assert.equal(options.at(-1).elo, true, 'analisi singola con Elo, non presa dalla cache di Top del giorno');
});

test('provider: richieste annuali uguali in corso vengono unificate, tentativo unico', async () => {
  const fake = fakeEspnFetch();
  const provider = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: fake.fetchImpl, weather: { forecastAt: async () => null } });
  const args = { eventId: '777', kickoff: '2026-01-20T18:00:00Z', homeId: '10', awayId: '20' };
  await Promise.all([provider.seasonElo('ita.1', args), provider.seasonElo('ita.1', args), provider.seasonElo('ita.1', args)]);
  assert.equal(fake.calls.length, 2);
  const failing = fakeEspnFetch({ failYear: '2025' });
  const single = new EspnProvider({ cacheTtlMs: 60000 }, { fetchImpl: failing.fetchImpl, weather: { forecastAt: async () => null } });
  await single.seasonElo('ita.1', args);
  assert.equal(failing.calls.filter((url) => url.includes('dates=2025')).length, 1, 'nessun nuovo tentativo su una fonte informativa');
});
