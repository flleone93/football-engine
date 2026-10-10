// Meteo informativo dal servizio gratuito Open-Meteo (nessuna chiave, CORS aperto).
// Non modifica mai probabilità o confidenza: un effetto meteo non validato sarebbe falsa precisione.
import { TTLCache } from '../cache.js';

const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const MAX_AHEAD_MS = 16 * 86400000;

export function cityFromVenue(venue) {
  const parts = String(venue || '').split(',').map((part) => part.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const city = parts.at(-1);
  return /^da confermare$/i.test(city) ? null : city;
}

function httpError(prefix, status) {
  return Object.assign(new Error(`${prefix} HTTP ${status}`), { code: `${prefix}_http_${status}` });
}

export class WeatherService {
  constructor({ fetchImpl = globalThis.fetch?.bind(globalThis), now = () => Date.now(), cache = new TTLCache(7 * 86400000, 500) } = {}) {
    this.fetch = fetchImpl;
    this.now = now;
    this.cache = cache;
  }

  async #json(url, prefix) {
    const response = await this.fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) throw httpError(prefix, response.status);
    return response.json();
  }

  async geocode(city) {
    const key = `geo:${city.toLowerCase()}`;
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    const payload = await this.#json(`${GEO_URL}?name=${encodeURIComponent(city)}&count=1&language=it&format=json`, 'geocoding');
    const hit = payload.results?.[0];
    const place = hit ? { name: hit.name, latitude: hit.latitude, longitude: hit.longitude } : null;
    return this.cache.set(key, place);
  }

  async forecastAt({ venue, kickoff }) {
    const city = cityFromVenue(venue);
    const kickoffMs = Date.parse(kickoff);
    const now = this.now();
    if (!city || !Number.isFinite(kickoffMs) || kickoffMs < now || kickoffMs - now > MAX_AHEAD_MS) return null;
    const place = await this.geocode(city);
    if (!place) return null;
    const day = new Date(kickoffMs).toISOString().slice(0, 10);
    const query = new URLSearchParams({
      latitude: String(place.latitude), longitude: String(place.longitude),
      hourly: 'temperature_2m,precipitation,precipitation_probability,wind_speed_10m',
      timezone: 'GMT', start_date: day, end_date: day
    });
    const payload = await this.#json(`${FORECAST_URL}?${query}`, 'weather');
    const hourly = payload.hourly || {};
    const hourKey = new Date(Math.floor(kickoffMs / 3600000) * 3600000).toISOString().slice(0, 13);
    const index = (hourly.time || []).findIndex((time) => String(time).slice(0, 13) === hourKey);
    if (index < 0) return null;
    return {
      city: place.name,
      temperatureC: hourly.temperature_2m?.[index] ?? null,
      precipitationMm: hourly.precipitation?.[index] ?? null,
      precipitationProbability: hourly.precipitation_probability?.[index] ?? null,
      windKmh: hourly.wind_speed_10m?.[index] ?? null,
      retrievedAt: new Date(now).toISOString(),
      source: 'Open-Meteo'
    };
  }
}

export function weatherSummary(weather) {
  if (!weather) return '';
  const parts = [];
  if (Number.isFinite(weather.temperatureC)) parts.push(`${Math.round(weather.temperatureC)}°C`);
  if (Number.isFinite(weather.precipitationProbability)) {
    const mm = weather.precipitationMm > 0 ? ` (${String(weather.precipitationMm).replace('.', ',')} mm)` : '';
    parts.push(`pioggia ${weather.precipitationProbability}%${mm}`);
  }
  if (Number.isFinite(weather.windKmh)) parts.push(`vento ${Math.round(weather.windKmh)} km/h`);
  return parts.join(' · ');
}
