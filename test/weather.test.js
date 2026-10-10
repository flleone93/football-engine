import assert from 'node:assert/strict';
import test from 'node:test';
import { cityFromVenue, WeatherService, weatherSummary } from '../src/providers/weather.js';

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
