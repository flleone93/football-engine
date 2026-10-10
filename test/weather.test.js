import assert from 'node:assert/strict';
import test from 'node:test';
import { cityFromVenue, WeatherService, weatherSummary } from '../src/providers/weather.js';
import { EspnProvider } from '../src/providers/espn.js';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const NOW = Date.parse('2026-10-10T12:00:00Z');

function fakeFetch(calls, { forecastStatus = 200 } = {}) {
  return async (url) => {
    calls.push(String(url));
    if (String(url).includes('geocoding-api')) return json({ results: [{ name: 'Como', latitude: 45.81, longitude: 9.08, country_code: 'IT' }] });
    if (forecastStatus !== 200) return json({ error: true }, forecastStatus);
    return json({ hourly: {
      time: ['2026-10-11T09:00', '2026-10-11T10:00', '2026-10-11T11:00'],
      temperature_2m: [14.1, 15.4, 16.0], precipitation: [0, 0.6, 1.2],
      precipitation_probability: [10, 55, 80], wind_speed_10m: [8.2, 12.7, 15.0]
    } });
  };
}

test('città ricavata dalla sede: ultimo segmento dopo la virgola', () => {
  assert.equal(cityFromVenue('Giuseppe Sinigaglia, Como'), 'Como');
  assert.equal(cityFromVenue('Selhurst Park, London'), 'London');
  assert.equal(cityFromVenue('Stadio X'), null);
  assert.equal(cityFromVenue('Da confermare'), null);
  assert.equal(cityFromVenue(null), null);
});

test('previsione all ora del calcio d inizio, geocoding in cache', async () => {
  const calls = [];
  const service = new WeatherService({ fetchImpl: fakeFetch(calls), now: () => NOW });
  const weather = await service.forecastAt({ venue: 'Giuseppe Sinigaglia, Como', kickoff: '2026-10-11T10:30:00.000Z' });
  assert.deepEqual({ ...weather, retrievedAt: 'x' }, {
    city: 'Como', temperatureC: 15.4, precipitationMm: 0.6, precipitationProbability: 55, windKmh: 12.7, retrievedAt: 'x', source: 'Open-Meteo'
  });
  await service.forecastAt({ venue: 'Altro stadio, Como', kickoff: '2026-10-11T10:30:00.000Z' });
  assert.equal(calls.filter((url) => url.includes('geocoding-api')).length, 1);
});

test('nessuna richiesta senza città, oltre 16 giorni o a gara iniziata', async () => {
  const calls = [];
  const service = new WeatherService({ fetchImpl: fakeFetch(calls), now: () => NOW });
  assert.equal(await service.forecastAt({ venue: 'Stadio X', kickoff: '2026-10-11T10:30:00Z' }), null);
  assert.equal(await service.forecastAt({ venue: 'A, Como', kickoff: '2026-10-30T10:30:00Z' }), null);
  assert.equal(await service.forecastAt({ venue: 'A, Como', kickoff: '2026-10-10T08:00:00Z' }), null);
  assert.equal(calls.length, 0);
});

test('errore della fonte: eccezione con codice, gestita dal provider', async () => {
  const service = new WeatherService({ fetchImpl: fakeFetch([], { forecastStatus: 500 }), now: () => NOW });
  await assert.rejects(service.forecastAt({ venue: 'A, Como', kickoff: '2026-10-11T10:30:00Z' }), { code: 'weather_http_500' });
});

test('testo sintetico leggibile', () => {
  assert.equal(weatherSummary({ temperatureC: 15.4, precipitationProbability: 55, precipitationMm: 0.6, windKmh: 12.7 }), '15°C · pioggia 55% (0,6 mm) · vento 13 km/h');
  assert.equal(weatherSummary({ temperatureC: 9, precipitationProbability: 5, precipitationMm: 0, windKmh: 30 }), '9°C · pioggia 5% · vento 30 km/h');
});


function espnFetch(calls) {
  return async (url) => {
    const u = String(url);
    calls.push(u);
    if (u.includes('/summary')) return json({
      header: { competitions: [{ date: '2026-10-11T10:30Z', status: { type: { name: 'STATUS_SCHEDULED' } }, venue: { fullName: 'Sinigaglia', address: { city: 'Como' } },
        competitors: [{ homeAway: 'home', team: { id: '1', displayName: 'Como' } }, { homeAway: 'away', team: { id: '2', displayName: 'AS Roma' } }] }] },
      lastFiveGames: [], news: { articles: [{ headline: 'Serie A round-up', description: 'generic' }] }, gameInfo: {}, rosters: []
    });
    if (u.includes('/standings')) return json({ children: [] });
    if (u.includes('/news?team=1')) return json({ articles: [{ headline: 'Como coach praises squad', description: 'Como', categories: [{ type: 'team', teamId: 1 }] }] });
    if (u.includes('/news?team=2')) return json({ articles: [{ headline: 'Roma injury update', description: 'AS Roma midfielder', categories: [{ type: 'team', teamId: 2 }] }, { headline: 'Unrelated LaLiga story', description: 'Madrid', categories: [] }] });
    return json({});
  };
}

test('bundle ESPN: meteo informativo, notizie di squadra, stato arbitro', async () => {
  const calls = [];
  const weather = { forecastAt: async () => ({ city: 'Como', temperatureC: 15, precipitationMm: 0, precipitationProbability: 10, windKmh: 9, retrievedAt: 'x', source: 'Open-Meteo' }) };
  const provider = new EspnProvider({ timezone: 'Europe/Rome' }, { fetchImpl: espnFetch(calls), weather });
  const bundle = await provider.getAnalysisBundle('espn:ita.1:99');
  assert.equal(bundle.weather.city, 'Como');
  assert.deepEqual(bundle.sourceStatus.weather, { available: true, error: null });
  assert.deepEqual(bundle.news.map((item) => item.title), ['Como coach praises squad', 'Roma injury update']);
  assert.equal(bundle.sourceStatus.referee.available, false);
  assert.match(bundle.sourceStatus.referee.error, /fonte gratuita/);
  assert.equal(bundle.sourceErrors.length, 0, 'il meteo non penalizza la qualità dati');
});

test('bundle ESPN: meteo non disponibile non blocca l analisi', async () => {
  const weather = { forecastAt: async () => { throw Object.assign(new Error('down'), { code: 'weather_http_500' }); } };
  const provider = new EspnProvider({ timezone: 'Europe/Rome' }, { fetchImpl: espnFetch([]), weather });
  const bundle = await provider.getAnalysisBundle('espn:ita.1:99');
  assert.equal(bundle.weather, null);
  assert.equal(bundle.sourceStatus.weather.available, false);
  assert.match(bundle.sourceStatus.weather.error, /Meteo/);
});
