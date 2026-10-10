# Fase 0 + Fase 1 (v1.10.0) — Pulizia agenti e grafica — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ogni componente dell'app lavora davvero o dichiara perché non può (meteo riparato, moduli finti eliminati, agente giocatori unito a quello tattico, notizie per squadra) e l'app iPhone diventa più ricca e leggibile (previsioni nell'elenco, preferiti, forma, mappa dei risultati, movimento quote, tema chiaro, guida al primo avvio, calendario, condivisione).

**Architecture:** Logica pura nei moduli `src/` con test `node:test`; l'interfaccia resta un unico `public/app.js` perché file offline e Artifact lo incorporano come singolo script. Le nuove fonti (Open-Meteo, notizie di squadra) passano dal provider ESPN con `sourceStatus` e non bloccano mai l'analisi. Il motore espone nuovi campi di sola presentazione (`context.form`, `context.standings`, `context.weather`, `scoreGrid`, `governance.oddsMovement`) senza cambiare le probabilità.

**Tech Stack:** Node ≥ 20 (ES modules, `node --test`), JavaScript del browser senza dipendenze, bundler interno `scripts/lib/bundler.mjs`, PWA su GitHub Pages.

**Spec:** `docs/superpowers/specs/2026-10-10-ottimizzazione-app-design.md` (sezioni 4, 5, 8, 9).

## Global Constraints

- Nessuna dipendenza esterna: il bundler rifiuta import non relativi.
- Fonti nuove solo gratuite, senza chiave, con CORS aperto: `https://geocoding-api.open-meteo.com`, `https://api.open-meteo.com`, ESPN.
- Il meteo è **solo informativo**: non modifica xG, probabilità, confidenza né qualità dati.
- Agenti AI qualitativi: `tactical_context`, `news_intelligence`, `competition_context` (5 agenti totali con `challenge_bias` e `final_explanation`); `AI_MAX_CALLS_PER_ANALYSIS` da 1 a 5, predefinito 5; `AI_MAX_TACTICAL_XG_DELTA` predefinito 0.10.
- La CSP dell'app iPhone resta senza script o stili inline: larghezze e colori dinamici via CSSOM (`element.style`).
- "Creata da Leone Francesco" resta in alto a destra.
- Italiano in tutta l'interfaccia; tocchi da almeno 44 px; nessuno scorrimento orizzontale a 390 px.
- Versione app: `1.10.0` (`src/api.js` `APP_VERSION`, `package.json`, `package-lock.json`).
- Git: usare `/Library/Developer/CommandLineTools/usr/bin/git` (quello di sistema è bloccato dalla licenza Xcode). Comandi dalla cartella `app/`.

## Review Focus

- Sede senza virgola o città sconosciuta (es. "Stadio X"): nessuna chiamata meteo, modulo "Non disponibile" con motivo, analisi completa.
- Partita oltre 16 giorni o già iniziata: meteo `null` senza richieste di rete.
- Open-Meteo che risponde 500 o non risponde: analisi completa, `sourceStatus.weather.available=false`.
- Previsioni rapide con un `fixtureId` sconosciuto in mezzo agli altri: le altre partite tornano comunque, quella fallita con `error`.
- Preferiti con `localStorage` bloccato (navigazione privata): l'elenco funziona, la stella non si salva e non lancia eccezioni.

---

## File structure

| File | Responsabilità |
|---|---|
| `src/providers/weather.js` (nuovo) | Città dalla sede, geocoding con cache, previsione oraria all'ora del calcio d'inizio, testo sintetico |
| `src/providers/espn.js` | Meteo e notizie di squadra nel bundle; `sourceStatus.weather` / `sourceStatus.referee` |
| `src/ai/schemas.js`, `src/ai/orchestrator.js`, `src/configCore.js` | Unione agente giocatori → tattico; categoria `weather` nell'evidence pack; limiti |
| `src/prediction/engine.js` | Workflow onesto (stati `active` / `inactive` / `unavailable_source`), nuovi campi di presentazione |
| `src/prediction/presentation.js` (nuovo) | Funzioni pure: `formFromRecent`, `scoreGridFromMatrix`, `oddsMovementFromOdds` |
| `src/api.js` | Endpoint `POST /api/quick-predictions` |
| `public/index.html`, `public/styles.css`, `public/app.js` | Elenco arricchito, preferiti, filtri, dettaglio, tema, guida, calendario, condivisione |
| `scripts/build-pwa.mjs` | CSP con Open-Meteo |
| test nuovi | `test/weather.test.js`, `test/presentation.test.js`, `test/quickPredictions.test.js` |

---

### Task 1: Servizio meteo Open-Meteo

**Files:**
- Create: `src/providers/weather.js`
- Test: `test/weather.test.js`

**Interfaces:**
- Produces: `cityFromVenue(venue: string): string|null`; `class WeatherService({fetchImpl, now})` con `async forecastAt({venue, kickoff}): Promise<Weather|null>`; `weatherSummary(w: Weather): string`. `Weather = {city, temperatureC, precipitationMm, precipitationProbability, windKmh, retrievedAt, source: 'Open-Meteo'}`.

- [ ] **Step 1: Write the failing test** — `test/weather.test.js`

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/weather.test.js`
Expected: FAIL — `Cannot find module '../src/providers/weather.js'`.

- [ ] **Step 3: Write minimal implementation** — `src/providers/weather.js`

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test test/weather.test.js`
Expected: PASS (5 test).

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add src/providers/weather.js test/weather.test.js
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: servizio meteo Open-Meteo informativo"
```

---

### Task 2: Meteo e notizie di squadra nel provider ESPN

**Files:**
- Modify: `src/providers/espn.js` (costruttore, `relevantNews`, `getAnalysisBundle`)
- Modify: `scripts/build-pwa.mjs` (CSP)
- Test: `test/claudeProvider.test.js` → aggiungere test in `test/weather.test.js`

**Interfaces:**
- Consumes: `WeatherService` (Task 1).
- Produces: nel bundle ESPN `bundle.weather: Weather|null`, `bundle.sourceStatus.weather = {available, error}`, `bundle.sourceStatus.referee = {available, error}`; `new EspnProvider(config, {leagues, fetchImpl, weather})`.

- [ ] **Step 1: Write the failing test** — aggiungere in fondo a `test/weather.test.js`

```js
import { EspnProvider } from '../src/providers/espn.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/weather.test.js`
Expected: FAIL — `bundle.weather` undefined.

- [ ] **Step 3: Implement** — in `src/providers/espn.js`:

Aggiungere l'import in testa:

```js
import { WeatherService } from './weather.js';
```

Nel costruttore sostituire la firma e aggiungere il servizio:

```js
  constructor(config = {}, { leagues = ESPN_LEAGUES, fetchImpl = globalThis.fetch?.bind(globalThis), weather = null } = {}) {
```

e, dopo `this.fetch = fetchImpl;`:

```js
    this.weather = weather || new WeatherService({ fetchImpl });
```

Sostituire `relevantNews` con una versione che accetta anche le notizie di squadra:

```js
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
```

In `getAnalysisBundle`, sostituire la riga `const news = relevantNews(summary.news?.articles, fixture);` con:

```js
    const teamArticles = (await Promise.all([fixture.home.id, fixture.away.id].map(async (teamId) => {
      try {
        const payload = await this.request(`/site/v2/sports/soccer/${decoded.slug}/news?team=${teamId}`, { force });
        return payload.articles || [];
      } catch {
        return [];
      }
    }))).flat();
    const news = relevantNews(summary.news?.articles || [], teamArticles, fixture);

    let weather = null;
    try {
      weather = await this.weather.forecastAt({ venue: fixture.venue, kickoff: fixture.kickoff });
      sourceStatus.weather = { available: Boolean(weather), error: weather ? null : 'Meteo non disponibile: città non riconosciuta o partita oltre 16 giorni.' };
    } catch {
      sourceStatus.weather = { available: false, error: 'Meteo: fonte non raggiungibile.' };
    }
    sourceStatus.referee = { available: Boolean(fixture.referee), error: fixture.referee ? null : 'Arbitro non fornito dalla fonte gratuita.' };
```

e aggiungere `weather,` nell'oggetto restituito, subito dopo `news,`.

In `scripts/build-pwa.mjs` sostituire la riga `connect-src` con:

```js
  "connect-src 'self' https://site.api.espn.com https://geocoding-api.open-meteo.com https://api.open-meteo.com https://api.anthropic.com https://generativelanguage.googleapis.com https://api.openai.com",
```

e in `test/pwa.test.js` sostituire l'asserzione CSP con:

```js
  assert.match(html, /connect-src 'self' https:\/\/site\.api\.espn\.com https:\/\/geocoding-api\.open-meteo\.com https:\/\/api\.open-meteo\.com https:\/\/api\.anthropic\.com/);
```

- [ ] **Step 4: Run tests**

Run: `node --test test/weather.test.js test/pwa.test.js test/claudeProvider.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add src/providers/espn.js scripts/build-pwa.mjs test/weather.test.js test/pwa.test.js
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: meteo e notizie di squadra nel bundle ESPN"
```

---

### Task 3: Unione agente giocatori → "Formazioni e tattica" e categoria meteo

**Files:**
- Modify: `src/ai/schemas.js` (AGENT_IDS, AGENT_SPECS)
- Modify: `src/ai/orchestrator.js:9,77-94,108-157,165-176`
- Modify: `src/configCore.js:94,102-103`; `.env.example`, `.env` (`AI_MAX_TACTICAL_XG_DELTA=0.10`, `AI_MAX_CALLS_PER_ANALYSIS=5`, rimuovere `AI_MAX_PLAYER_XG_DELTA`)
- Modify: `src/api.js` (lista `agents` in `meta`)
- Test: `test/ai.test.js`

**Interfaces:**
- Produces: `AGENT_IDS = ['tactical_context','news_intelligence','competition_context','challenge_bias','final_explanation']`; evidence pack con `weather: Weather|null` per `tactical_context`, `challenge_bias`, `final_explanation`.

- [ ] **Step 1: Update the tests first** — in `test/ai.test.js`:
  - nel primo test sostituire `agentId: 'player_availability_impact'` con `'tactical_context'` e il secondo agente `'tactical_context'` con `'competition_context'` (aspettative invariate: casa 0,1, trasferta −0,1);
  - nel secondo test usare `'tactical_context'` e `assert.equal(policy.lambdaAdjustment.home, config.ai.maxTacticalXgDelta);`;
  - nel terzo test usare `'tactical_context'` (primo) e `'competition_context'` (secondo);
  - nel quarto test sostituire `const player = buildAgentEvidencePack(bundle, baseline, 'player_availability_impact');` con:

```js
  bundle.weather = { city: 'Dallas', temperatureC: 30, precipitationMm: 0, precipitationProbability: 0, windKmh: 5, retrievedAt: 'x', source: 'Open-Meteo' };
  bundle.sourceStatus.weather = { available: true, error: null };
  const player = buildAgentEvidencePack(bundle, baseline, 'tactical_context');
```

  e aggiungere dopo le asserzioni esistenti:

```js
  assert.equal(player.weather.city, 'Dallas');
  assert.equal(player.evidenceCatalog.some((item) => item.evidenceId === 'weather'), true);
  assert.equal(news.weather, null);
```

  Aggiungere infine:

```js
test('cinque agenti: l agente giocatori è unito a quello tattico', async () => {
  const { AGENT_IDS, AGENT_SPECS } = await import('../src/ai/schemas.js');
  assert.deepEqual(AGENT_IDS, ['tactical_context', 'news_intelligence', 'competition_context', 'challenge_bias', 'final_explanation']);
  assert.equal(AGENT_SPECS.player_availability_impact, undefined);
  assert.match(AGENT_SPECS.tactical_context.prompt, /formazion/i);
  assert.equal(config.ai.maxTacticalXgDelta, 0.1);
  assert.ok(config.ai.maxCallsPerAnalysis <= 5);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test test/ai.test.js`
Expected: FAIL (agenti ancora 6, `weather` assente, limite 0,08).

- [ ] **Step 3: Implement**

`src/ai/schemas.js` — `AGENT_IDS` senza `'player_availability_impact'`; eliminare la voce `player_availability_impact` da `AGENT_SPECS`; sostituire `tactical_context` con:

```js
  tactical_context: {
    label: 'Lineups & Tactical Context Agent',
    model: 'default',
    schema: assessmentSchema,
    schemaName: 'tactical_context_output',
    maxXgDelta: 'maxTacticalXgDelta',
    prompt: 'Valuta formazioni e indisponibili quando presenti, compatibilita tattica, ritmo, forma e condizioni meteo solo dai dati ricevuti. Il meteo e informativo: segnala solo effetti plausibili e prudenti. Non inventare formazioni, diagnosi, moduli o piani gara; se i dati non bastano dichiara insufficient_data.'
  },
```

`src/ai/orchestrator.js`:
- riga 9: `const QUALITATIVE_AGENT_IDS = ['tactical_context', 'news_intelligence', 'competition_context'];`
- `AGENT_CATEGORIES`: eliminare la riga di `player_availability_impact` e usare `tactical_context: new Set(['fixture', 'lineups', 'injury', 'recent_form', 'season_statistics', 'weather']),`
- `OBSERVED_CATEGORY`: aggiungere `weather: 'weather',`
- in `observedAgentData` aggiungere `weather: sourceAvailable(bundle, 'weather', Boolean(bundle.weather)) ? (bundle.weather || null) : null,`
- in `buildEvidenceCatalog` aggiungere prima di `add('odds.snapshot', ...)`: `add('weather', 'weather', data.weather, 'weather');`
- in `buildAgentEvidencePack` aggiungere dopo `news: ...`: `weather: include('weather') ? data.weather : null,`
- in `hasUsefulData` eliminare il ramo `player_availability_impact` (righe 167-173).

`src/provenance.js` — in `publicSourceSnapshot().observed` aggiungere `weather: Boolean(bundle.weather),` (serve a `scopedSourceSnapshot`).

`src/configCore.js`:

```js
      maxCallsPerAnalysis: Math.round(number('AI_MAX_CALLS_PER_ANALYSIS', 5, 1, 5)),
```

eliminare la riga `maxPlayerXgDelta` e usare:

```js
      maxTacticalXgDelta: number('AI_MAX_TACTICAL_XG_DELTA', 0.10, 0, 0.5),
```

`.env.example` e `.env`: `AI_MAX_CALLS_PER_ANALYSIS=5`, `AI_MAX_TACTICAL_XG_DELTA=0.10`, rimuovere la riga `AI_MAX_PLAYER_XG_DELTA`.

`src/api.js` — in `meta()`:

```js
        agents: ['Lineups & Tactical Context', 'News Intelligence', 'Competition Context', 'Challenge & Bias Detection', 'Final Explanation'],
```

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS. I test `claudeProvider` e `anthropicProvider` usano le etichette di `AGENT_SPECS` e restano verdi.

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add -A src test .env.example
/Library/Developer/CommandLineTools/usr/bin/git commit -m "refactor: agente giocatori unito a Formazioni e tattica, 5 agenti, meteo nell'evidence pack"
```

---

### Task 4: Workflow onesto e campi di presentazione del motore

**Files:**
- Create: `src/prediction/presentation.js`
- Modify: `src/prediction/engine.js` (workflowAgents, return di `analyzeMatch`)
- Test: `test/presentation.test.js`

**Interfaces:**
- Consumes: `weatherSummary` (Task 1); `bundle.sourceStatus.weather/referee/odds` (Task 2).
- Produces:
  - `formFromRecent(recent): string[]` (es. `['W','L']`, massimo 5);
  - `scoreGridFromMatrix(matrix, size = 6): {size, cells: number[][], other: number}`;
  - `oddsMovementFromOdds(odds): {bookmaker, items: [{key,label,open,current,impliedChangePp}]}|null`;
  - `analysis.workflow[i] = {name, active, status: 'active'|'inactive'|'unavailable_source', note}`;
  - `analysis.context.form = {home, away}`, `analysis.context.standings = {home, away}`, `analysis.context.weather`;
  - `analysis.scoreGrid`, `analysis.governance.oddsMovement`.

- [ ] **Step 1: Write the failing test** — `test/presentation.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { buildConfig } from '../src/configCore.js';
import { analyzeMatch } from '../src/prediction/engine.js';
import { formFromRecent, oddsMovementFromOdds, scoreGridFromMatrix } from '../src/prediction/presentation.js';
import { scoreMatrix } from '../src/prediction/probability.js';
import { DemoProvider } from '../src/providers/demo.js';

test('forma: lettere dai risultati recenti, massimo cinque', () => {
  assert.deepEqual(formFromRecent({ results: ['W 2-1 casa vs A', 'L 0-2 trasferta vs B', 'D 1-1 casa vs C'] }), ['W', 'L', 'D']);
  assert.deepEqual(formFromRecent({ results: ['W', 'W', 'W', 'L', 'D', 'W'] }), ['W', 'W', 'W', 'L', 'D']);
  assert.deepEqual(formFromRecent(null), []);
});

test('griglia risultati: 6x6 normalizzata con resto', () => {
  const grid = scoreGridFromMatrix(scoreMatrix(1.4, 1.1));
  assert.equal(grid.size, 6);
  assert.equal(grid.cells.length, 6);
  assert.ok(grid.cells.every((row) => row.length === 6));
  const total = grid.cells.flat().reduce((sum, value) => sum + value, 0) + grid.other;
  assert.ok(Math.abs(total - 1) < 1e-6);
  assert.ok(grid.cells[1][1] > grid.cells[5][5]);
});

test('movimento quote: solo con apertura, variazione in punti percentuali implicita', () => {
  assert.equal(oddsMovementFromOdds({ values: { 1: 2 } }), null);
  const movement = oddsMovementFromOdds({ bookmaker: 'DraftKings via ESPN', values: { 1: 2.45, X: 3.45, 2: 2.65 }, opening: { 1: 2.45, X: 3.35, 2: 2.55 } });
  assert.equal(movement.bookmaker, 'DraftKings via ESPN');
  assert.deepEqual(movement.items.map((item) => item.key), ['1', 'X', '2']);
  const draw = movement.items.find((item) => item.key === 'X');
  assert.equal(draw.open, 3.35);
  assert.equal(draw.current, 3.45);
  assert.ok(draw.impliedChangePp < 0, 'quota salita = probabilità implicita scesa');
});

test('workflow onesto: niente moduli finti, stati espliciti', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-mls');
  bundle.sourceStatus.referee = { available: false, error: 'Arbitro non fornito dalla fonte gratuita.' };
  bundle.fixture.referee = null;
  bundle.weather = { city: 'Miami', temperatureC: 29, precipitationMm: 0, precipitationProbability: 20, windKmh: 14, retrievedAt: 'x', source: 'Open-Meteo' };
  bundle.sourceStatus.weather = { available: true, error: null };
  const analysis = analyzeMatch(bundle, {}, buildConfig({ DEMO_MODE: 'true' }));
  const names = analysis.workflow.map((item) => item.name);
  assert.ok(!names.includes('Machine Learning'));
  assert.ok(!names.includes('Bayesian Update'));
  assert.ok(!names.includes('Player Availability & Impact AI'));
  assert.ok(names.includes('Lineups & Tactical AI'));
  const weather = analysis.workflow.find((item) => item.name === 'Weather & Pitch');
  assert.equal(weather.status, 'active');
  assert.match(weather.note, /29°C/);
  const referee = analysis.workflow.find((item) => item.name === 'Referee');
  assert.equal(referee.status, 'unavailable_source');
  assert.match(referee.note, /fonte gratuita/);
  assert.ok(analysis.workflow.every((item) => ['active', 'inactive', 'unavailable_source'].includes(item.status)));
  assert.equal(analysis.context.weather.city, 'Miami');
  assert.equal(analysis.scoreGrid.size, 6);
  assert.ok(Array.isArray(analysis.context.form.home));
});

test('modello esterno non fornito dalla fonte: motivo esplicito', async () => {
  const bundle = await new DemoProvider().getAnalysisBundle('demo-mls');
  bundle.prediction = null;
  bundle.sourceStatus.prediction = { available: false, error: 'Nessuna previsione esterna nella fonte pubblica.' };
  const analysis = analyzeMatch(bundle, {}, buildConfig({ DEMO_MODE: 'true' }));
  const external = analysis.agents.find((agent) => agent.id === 'provider');
  assert.equal(external.active, false);
  assert.equal(external.unavailableReason, 'Nessuna previsione esterna nella fonte pubblica.');
  assert.equal(analysis.agents.find((agent) => agent.id === 'poisson').unavailableReason, null);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/presentation.test.js`
Expected: FAIL — modulo `presentation.js` mancante.

- [ ] **Step 3: Implement** — `src/prediction/presentation.js`

```js
// Campi di sola presentazione derivati da dati già calcolati: non modificano le probabilità.
import { LABELS } from './recommendation.js';
import { round } from '../utils.js';

export function formFromRecent(recent) {
  return (recent?.results || [])
    .map((item) => String(item).trim().charAt(0).toUpperCase())
    .filter((letter) => ['W', 'D', 'L'].includes(letter))
    .slice(0, 5);
}

export function scoreGridFromMatrix(matrix, size = 6) {
  const cells = Array.from({ length: size }, () => Array(size).fill(0));
  let other = 0;
  for (const { home, away, probability } of matrix) {
    if (home < size && away < size) cells[home][away] += probability;
    else other += probability;
  }
  return { size, cells: cells.map((row) => row.map((value) => round(value, 6))), other: round(other, 6) };
}

export function oddsMovementFromOdds(odds) {
  if (!odds?.opening || !odds?.values) return null;
  const items = Object.keys(LABELS)
    .filter((key) => odds.opening[key] > 1 && odds.values[key] > 1)
    .map((key) => ({
      key,
      label: LABELS[key],
      open: odds.opening[key],
      current: odds.values[key],
      impliedChangePp: round((1 / odds.values[key] - 1 / odds.opening[key]) * 100, 2)
    }));
  return items.length ? { bookmaker: odds.bookmaker || null, items } : null;
}
```

In `src/prediction/engine.js`:
- import: `import { formFromRecent, oddsMovementFromOdds, scoreGridFromMatrix } from './presentation.js';` e `import { weatherSummary } from '../providers/weather.js';`
- in `workflowAgents` eliminare la riga `const [playerActive, playerNote] = ...`; sostituire la riga `'Tactical Context AI'` con `['Lineups & Tactical AI', tacticalActive, tacticalNote, null],` ed eliminare la riga `'Player Availability & Impact AI'`;
- sostituire le righe `'Weather & Pitch'` e `'Referee'` con:

```js
    ['Weather & Pitch', Boolean(bundle.weather), bundle.weather ? `${weatherSummary(bundle.weather)} · ${bundle.weather.city} · solo informativo` : 'Previsione meteo non disponibile.', 'weather'],
    ['Referee', Boolean(bundle.fixture.referee), bundle.fixture.referee || 'Designazione non disponibile.', 'referee'],
```

- eliminare le righe `'Bayesian Update'` e `'Machine Learning'`;
- `['Market Odds', ..., 'odds']`: aggiungere il quarto elemento `'odds'`;
- sostituire la mappatura finale con:

```js
  ].map(([name, active, note, sourceKey = null]) => {
    const sourceError = sourceKey ? bundle.sourceStatus?.[sourceKey]?.error : null;
    const status = active ? 'active' : sourceError ? 'unavailable_source' : 'inactive';
    return { name, active, status, note: status === 'unavailable_source' ? sourceError : note };
  });
```

- nella costruzione di `agents` (lista dei modelli dell'ensemble) aggiungere a ogni elemento il campo `unavailableReason`, ricavato dalla fonte quando il modello è escluso:

```js
  const sourceKeyByModel = { market: 'odds', provider: 'prediction', h2h: 'h2h', form: 'recentHome' };
```

  e nell'oggetto mappato: `unavailableReason: source.probabilities ? null : (bundle.sourceStatus?.[sourceKeyByModel[source.id]]?.error || null),`
- nel `return` di `analyzeMatch`, dopo `exactScores: exactScores(calibratedMatrix, 10),` aggiungere `scoreGrid: scoreGridFromMatrix(calibratedMatrix),`; in `governance` aggiungere `oddsMovement: oddsMovementFromOdds(bundle.odds),`; in `context` aggiungere:

```js
      form: { home: formFromRecent(bundle.recentHome), away: formFromRecent(bundle.recentAway) },
      standings: bundle.standingsContext || { home: null, away: null },
      weather: bundle.weather || null,
```

Verificare con `grep -n "export const LABELS" src/prediction/recommendation.js` che `LABELS` sia esportato (lo è).

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add src/prediction test/presentation.test.js
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: workflow onesto e campi di presentazione (forma, griglia risultati, movimento quote, meteo)"
```

---

### Task 5: Endpoint previsioni rapide

**Files:**
- Modify: `src/api.js` (nuova funzione e route)
- Test: `test/quickPredictions.test.js`

**Interfaces:**
- Consumes: `analyzeFixture(fixtureId, neutral, {useAi:false})`, `isNeutralFixture`.
- Produces: `POST /api/quick-predictions` body `{fixtureIds: string[]}` (1–12) → `{predictions: [{fixtureId, outcomes, recommendation: {key,label,probability,hasValue,edge}, confidence} | {fixtureId, error}], requestId}`.

- [ ] **Step 1: Write the failing test** — `test/quickPredictions.test.js`

```js
import assert from 'node:assert/strict';
import test from 'node:test';
import { HybridAiOrchestrator } from '../src/ai/orchestrator.js';
import { createApi } from '../src/api.js';
import { TTLCache } from '../src/cache.js';
import { buildConfig } from '../src/configCore.js';
import { DemoProvider } from '../src/providers/demo.js';

function api() {
  const config = buildConfig({ DEMO_MODE: 'true', AI_MODE: 'off' });
  return createApi({ config, provider: new DemoProvider(), aiOrchestrator: new HybridAiOrchestrator(config), analysisCache: new TTLCache(60000, 500) });
}
const call = (instance, body) => instance.handle({ method: 'POST', pathname: '/api/quick-predictions', readBody: async () => body, requestId: 't' });

test('previsioni rapide: sintesi per ogni partita, errori isolati', async () => {
  const result = await call(api(), { fixtureIds: ['demo-mls', 'sconosciuta', 'demo-france-spain'] });
  assert.equal(result.status, 200);
  const [mls, missing, wc] = result.payload.predictions;
  assert.equal(mls.fixtureId, 'demo-mls');
  assert.ok(Math.abs(mls.outcomes.home + mls.outcomes.draw + mls.outcomes.away - 1) < 1e-6);
  assert.equal(typeof mls.recommendation.label, 'string');
  assert.equal(typeof mls.recommendation.hasValue, 'boolean');
  assert.ok(mls.confidence > 0);
  assert.deepEqual(missing, { fixtureId: 'sconosciuta', error: 'Previsione non disponibile.' });
  assert.equal(wc.fixtureId, 'demo-france-spain');
});

test('previsioni rapide: validazione dell input', async () => {
  const instance = api();
  assert.equal((await call(instance, { fixtureIds: [] })).status, 400);
  assert.equal((await call(instance, { fixtureIds: Array.from({ length: 13 }, (_, i) => `id${i}`) })).status, 400);
  assert.equal((await call(instance, {})).status, 400);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/quickPredictions.test.js`
Expected: FAIL — status 404/405.

- [ ] **Step 3: Implement** — in `src/api.js`, dentro `createApi`, prima di `function meta(`:

```js
  async function quickPredictions(body) {
    const ids = Array.isArray(body?.fixtureIds) ? body.fixtureIds : null;
    if (!ids || ids.length < 1 || ids.length > 12) throw failValidation('fixtureIds deve contenere da 1 a 12 partite.');
    const fixtures = await provider.getFixtures({ days: config.matchDaysAhead });
    const byId = new Map(fixtures.map((fixture) => [String(fixture.id), fixture]));
    return mapWithConcurrency(ids.map((id) => String(id)), 3, async (fixtureId) => {
      try {
        validateFixtureId(fixtureId);
        const fixture = byId.get(fixtureId);
        const analysis = await analyzeFixture(fixtureId, fixture ? isNeutralFixture(fixture) : false, { useAi: false });
        const recommendation = analysis.summary.recommendation;
        return {
          fixtureId,
          outcomes: analysis.summary.outcomes,
          recommendation: { key: recommendation.key, label: recommendation.label, probability: recommendation.probability, hasValue: Boolean(recommendation.hasValue), edge: recommendation.edge ?? null },
          confidence: analysis.summary.confidence
        };
      } catch {
        return { fixtureId, error: 'Previsione non disponibile.' };
      }
    });
  }
```

e in `handle`, prima di `if (method === 'POST' && pathname === '/api/top-picks')`:

```js
    if (method === 'POST' && pathname === '/api/quick-predictions') {
      const body = await readBody();
      return { status: 200, payload: { predictions: await quickPredictions(body), requestId } };
    }
```

In `src/server.js` nessuna modifica: la route non è in `EXPENSIVE_ROUTES` perché usa la cache e non chiama l'AI.

- [ ] **Step 4: Run all tests**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add src/api.js test/quickPredictions.test.js
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: endpoint previsioni rapide per l'elenco partite"
```

---

### Task 6: Elenco partite arricchito, ordinamento, filtri e preferiti

**Files:**
- Modify: `public/index.html` (controlli sopra l'elenco)
- Modify: `public/styles.css` (mini barra, badge, stella, chip filtro)
- Modify: `public/app.js` (stato, preferiti, previsioni rapide, render elenco)

**Interfaces:**
- Consumes: `POST /api/quick-predictions` (Task 5).
- Produces: `favorites.has(type, id)`, `favorites.toggle(type, id)` in `app.js` (tipi `'team'`, `'league'`), usati anche dal Task 7.

- [ ] **Step 1: Markup** — in `public/index.html`, subito dopo il `<div class="filter-row">…</div>` dentro `.filters`, aggiungere:

```html
            <div class="list-tools">
              <div class="chip-group" role="group" aria-label="Filtro elenco">
                <button type="button" class="filter-chip" data-list-filter="all" aria-pressed="true">Tutte</button>
                <button type="button" class="filter-chip" data-list-filter="favorites" aria-pressed="false">★ Preferiti</button>
                <button type="button" class="filter-chip" data-list-filter="value" aria-pressed="false">Solo valore</button>
              </div>
              <label for="sortSelect"><span class="sr-only">Ordina</span>
                <select id="sortSelect"><option value="time">Per orario</option><option value="value">Per valore</option><option value="probability">Per probabilità</option></select>
              </label>
            </div>
```

- [ ] **Step 2: Stili** — in `public/styles.css`, prima di `@keyframes spin`:

```css
/* Elenco arricchito */
.list-tools { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; }
.list-tools select { width: auto; min-width: 150px; }
.chip-group { display: flex; gap: 6px; overflow-x: auto; scrollbar-width: none; }
.filter-chip { flex: none; min-height: 36px; padding: 6px 12px; border: 1px solid var(--line-strong); border-radius: 999px; color: var(--muted); background: var(--surface); font-size: 13px; font-weight: 600; }
.filter-chip[aria-pressed="true"] { border-color: transparent; color: var(--accent-ink); background: var(--accent); }
.fixture-row { display: grid; grid-template-columns: minmax(0, 1fr) 44px; align-items: stretch; gap: 6px; margin-bottom: 6px; }
.fixture-row .fixture-card { margin-bottom: 0; }
.star-button { display: grid; place-items: center; width: 44px; border: 1px solid var(--line); border-radius: 14px; color: var(--dim); background: var(--surface); font-size: 20px; line-height: 1; }
.star-button[aria-pressed="true"] { color: var(--warn); }
.fixture-quick { display: flex; align-items: center; gap: 8px; margin-top: 4px; min-height: 18px; }
.mini-bar { display: flex; flex: 1; height: 6px; overflow: hidden; border-radius: 4px; background: var(--surface-3); }
.mini-bar span { height: 100%; }
.mini-bar .home { background: var(--home); }
.mini-bar .draw { background: var(--draw); }
.mini-bar .away { background: var(--away); }
.quick-label { overflow: hidden; color: var(--muted); font-size: 11.5px; white-space: nowrap; text-overflow: ellipsis; }
.value-badge { flex: none; padding: 1px 7px; border-radius: 999px; color: var(--accent-ink); background: var(--good); font-size: 10.5px; font-weight: 750; }
.skeleton-line { height: 6px; flex: 1; border-radius: 4px; background: linear-gradient(90deg, var(--surface-2), var(--surface-3), var(--surface-2)); background-size: 200% 100%; animation: shimmer 1.2s linear infinite; }
@keyframes shimmer { to { background-position: -200% 0; } }
```

- [ ] **Step 3: Logica** — in `public/app.js`:

Aggiungere a `state`: `quick: new Map(), quickPending: new Set(), listFilter: 'all',` e `'sortSelect'` all'elenco degli `elements`.

Subito dopo la funzione `relativeDay`, aggiungere il modulo preferiti:

```js
// Preferiti salvati nel browser; con archiviazione bloccata restano solo per la sessione.
const favorites = (() => {
  const KEY = 'football-engine-favorites-v1';
  let data = { team: [], league: [] };
  try { data = { ...data, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* sessione senza archiviazione */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch { /* ignorato */ } };
  return {
    has: (type, id) => data[type].includes(String(id)),
    toggle(type, id) {
      const key = String(id);
      data[type] = data[type].includes(key) ? data[type].filter((item) => item !== key) : [...data[type], key];
      persist();
      return data[type].includes(key);
    },
    fixtureIsFavorite: (fixture) => data.team.includes(String(fixture.home.id)) || data.team.includes(String(fixture.away.id)) || data.league.includes(String(fixture.league.id))
  };
})();
```

Sostituire `filteredFixtures` con:

```js
function filteredFixtures() {
  const query = elements.searchInput.value.trim().toLocaleLowerCase('it');
  const league = elements.leagueFilter.value;
  const date = elements.dateFilter.value;
  const list = state.fixtures.filter((fixture) => {
    const haystack = `${fixture.home.name} ${fixture.away.name} ${fixture.league.name} ${fixture.league.country}`.toLocaleLowerCase('it');
    return (!query || haystack.includes(query))
      && (!league || String(fixture.league.id) === league)
      && (!date || dateKey(fixture.kickoff) === date)
      && (state.listFilter !== 'favorites' || favorites.fixtureIsFavorite(fixture))
      && (state.listFilter !== 'value' || state.quick.get(String(fixture.id))?.recommendation?.hasValue);
  });
  const sort = elements.sortSelect?.value || 'time';
  const quick = (fixture) => state.quick.get(String(fixture.id));
  const byTime = (a, b) => a.kickoff.localeCompare(b.kickoff);
  if (sort === 'value') return list.sort((a, b) => (quick(b)?.recommendation?.edge ?? -9) - (quick(a)?.recommendation?.edge ?? -9) || byTime(a, b));
  if (sort === 'probability') return list.sort((a, b) => (quick(b)?.recommendation?.probability ?? -1) - (quick(a)?.recommendation?.probability ?? -1) || byTime(a, b));
  return list.sort((a, b) => Number(favorites.fixtureIsFavorite(b)) - Number(favorites.fixtureIsFavorite(a)) || byTime(a, b));
}
```

Sostituire `renderFixtures` con:

```js
function quickMarkup(fixtureId) {
  const quick = state.quick.get(String(fixtureId));
  if (!quick) return state.quickPending.has(String(fixtureId)) ? '<span class="skeleton-line"></span>' : '';
  if (quick.error) return '';
  const { home, draw, away } = quick.outcomes;
  return `<span class="mini-bar" aria-hidden="true"><span class="home" data-width="${home * 100}"></span><span class="draw" data-width="${draw * 100}"></span><span class="away" data-width="${away * 100}"></span></span>
    <span class="quick-label">${escapeHtml(quick.recommendation.label)} ${percent(quick.recommendation.probability, 0)}</span>
    ${quick.recommendation.hasValue ? '<span class="value-badge">Valore</span>' : ''}`;
}

function renderFixtures() {
  const fixtures = filteredFixtures();
  elements.filteredCount.textContent = fixtures.length;
  if (!fixtures.length) {
    const message = state.listFilter === 'favorites' ? 'Nessuna partita delle squadre o competizioni preferite. Tocca ☆ accanto a una partita per aggiungerla.'
      : state.listFilter === 'value' ? 'Nessuna partita con valore tra quelle già analizzate.'
        : state.fixtures.length ? 'Nessuna partita corrisponde alla ricerca.' : 'Nessuna partita in calendario nei prossimi giorni.';
    elements.fixtureList.innerHTML = `<div class="loading-card"><p>${escapeHtml(message)}</p></div>`;
    return;
  }
  let previousDate = '';
  const sortedByTime = (elements.sortSelect?.value || 'time') === 'time';
  elements.fixtureList.innerHTML = fixtures.map((fixture) => {
    const date = dateKey(fixture.kickoff);
    const label = relativeDay(date) ? `${relativeDay(date)} · ${shortDateLabel(fixture.kickoff)}` : dateLabel(fixture.kickoff);
    const divider = sortedByTime && date !== previousDate ? `<div class="date-divider">${escapeHtml(label)}</div>` : '';
    previousDate = date;
    const active = String(state.selected?.id) === String(fixture.id);
    const starred = favorites.fixtureIsFavorite(fixture);
    return `${divider}<div class="fixture-row">
      <button class="fixture-card ${active ? 'active' : ''}" type="button" aria-pressed="${active}" data-fixture-id="${escapeHtml(fixture.id)}">
        <span class="fixture-time">${formatTime(fixture.kickoff)}</span>
        <span class="fixture-main">
          <span class="fixture-teams"><strong>${escapeHtml(fixture.home.name)}</strong><strong>${escapeHtml(fixture.away.name)}</strong></span>
          <span class="fixture-league">${escapeHtml(fixture.league.name)}${fixture.league.round ? ` · ${escapeHtml(fixture.league.round)}` : ''}${sortedByTime ? '' : ` · ${escapeHtml(shortDateLabel(fixture.kickoff))}`}</span>
          <span class="fixture-quick">${quickMarkup(fixture.id)}</span>
        </span>
        ${chevron}
      </button>
      <button class="star-button" type="button" data-star-league="${escapeHtml(fixture.league.id)}" data-star-home="${escapeHtml(fixture.home.id)}" aria-pressed="${starred}" aria-label="${starred ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'} ${escapeHtml(fixture.home.name)}">${starred ? '★' : '☆'}</button>
    </div>`;
  }).join('');
  elements.fixtureList.querySelectorAll('[data-width]').forEach((node) => { node.style.width = `${Number(node.dataset.width)}%`; });
  elements.fixtureList.querySelectorAll('[data-fixture-id]').forEach((button) => button.addEventListener('click', () => selectFixture(button.dataset.fixtureId)));
  elements.fixtureList.querySelectorAll('[data-star-home]').forEach((button) => button.addEventListener('click', () => {
    favorites.toggle('team', button.dataset.starHome);
    renderFixtures();
  }));
  requestQuickPredictions(fixtures);
}

let quickTimer = null;
function requestQuickPredictions(fixtures) {
  clearTimeout(quickTimer);
  quickTimer = setTimeout(async () => {
    const missing = fixtures.map((fixture) => String(fixture.id)).filter((id) => !state.quick.has(id) && !state.quickPending.has(id)).slice(0, 36);
    if (!missing.length) return;
    missing.forEach((id) => state.quickPending.add(id));
    const batches = [];
    for (let index = 0; index < missing.length; index += 12) batches.push(missing.slice(index, index + 12));
    let cursor = 0;
    await Promise.all(Array.from({ length: Math.min(2, batches.length) }, async () => {
      while (cursor < batches.length) {
        const batch = batches[cursor];
        cursor += 1;
        try {
          const payload = await request('/api/quick-predictions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fixtureIds: batch }), timeout: 90000 });
          for (const item of payload.predictions || []) state.quick.set(String(item.fixtureId), item);
        } catch {
          batch.forEach((id) => state.quick.set(id, { fixtureId: id, error: 'Previsione non disponibile.' }));
        } finally {
          batch.forEach((id) => state.quickPending.delete(id));
        }
      }
    }));
    renderFixtures();
  }, 250);
}
```

Nella sezione "Navigazione" aggiungere:

```js
elements.sortSelect.addEventListener('change', renderFixtures);
document.querySelectorAll('[data-list-filter]').forEach((chip) => chip.addEventListener('click', () => {
  state.listFilter = chip.dataset.listFilter;
  document.querySelectorAll('[data-list-filter]').forEach((item) => item.setAttribute('aria-pressed', String(item === chip)));
  renderFixtures();
}));
```

Nota: la stella dell'elenco aggiunge la squadra di casa; nel dettaglio partita (Task 7) si scelgono singolarmente le due squadre e la competizione.

- [ ] **Step 4: Verifica**

Run: `node --check public/app.js && node scripts/build-pwa.mjs`. Avviare il server statico su `dist/pwa`, aprire a 390×844 e verificare: barre e badge compaiono entro pochi secondi; "Per valore" ordina; "★ Preferiti" filtra dopo aver toccato una stella; nessun errore in console; nessun overflow orizzontale (`document.documentElement.scrollWidth - innerWidth === 0`). Caso del Review Focus "archiviazione bloccata": nella console eseguire `Storage.prototype.setItem = () => { throw new DOMException('blocked', 'QuotaExceededError'); }`, toccare una stella e verificare che l'elenco resti funzionante, senza eccezioni in console (la stella vale per la sessione).

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add public
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: elenco con previsioni rapide, valore, ordinamento, filtri e preferiti"
```

---

### Task 7: Dettaglio partita: forma, classifica, meteo, griglia risultati, movimento quote, stati del workflow, calendario, condivisione

**Files:**
- Modify: `public/app.js` (`renderAnalysis` e nuovi helper)
- Modify: `public/styles.css`

**Interfaces:**
- Consumes: `analysis.context.form/standings/weather`, `analysis.scoreGrid`, `analysis.governance.oddsMovement`, `analysis.workflow[].status` (Task 4); `favorites` (Task 6); `downloadFile(name, content, type)` (esistente).
- Produces: `icsForFixture(fixture): string`, `shareText(analysis): string`.

- [ ] **Step 1: Stili** — in `public/styles.css` prima di `@keyframes spin`:

```css
/* Dettaglio arricchito */
.team-line { display: grid; gap: 4px; min-width: 0; }
.team-line:last-child { justify-items: end; text-align: right; }
.form-dots { display: flex; gap: 4px; }
.form-dot { display: grid; place-items: center; width: 18px; height: 18px; border-radius: 50%; color: var(--accent-ink); font: 700 10px var(--font-data); }
.form-dot.W { background: var(--good); }
.form-dot.D { background: var(--draw); }
.form-dot.L { background: var(--bad); color: #fff; }
.team-meta { color: var(--dim); font-size: 11.5px; }
.team-star { padding: 0 2px; border: 0; color: var(--dim); background: transparent; font-size: 18px; line-height: 1; min-height: 32px; }
.team-star[aria-pressed="true"] { color: var(--warn); }
.weather-line { color: var(--muted); font-size: 13px; }
.score-grid { display: grid; grid-template-columns: 26px repeat(6, minmax(0, 1fr)); gap: 3px; font: 600 11px var(--font-data); }
.score-grid .axis { display: grid; place-items: center; color: var(--dim); }
.score-cell { display: grid; place-items: center; aspect-ratio: 1; max-width: 100%; border-radius: 6px; color: var(--text); background: var(--accent); font-variant-numeric: tabular-nums; }
.score-cell.top { outline: 2px solid var(--text); }
.movement-list { display: grid; gap: 8px; }
.movement-row { display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: 10px; font-size: 13.5px; }
.movement-row b { font-family: var(--font-data); }
.workflow-agent.unavailable_source span { color: var(--warn); }
.share-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
```

- [ ] **Step 2: Helper** — in `public/app.js`, prima di `function renderAnalysis(`:

```js
const formLabel = { W: 'V', D: 'P', L: 'S' };
function formDots(letters) {
  if (!letters?.length) return '<span class="team-meta">Forma non disponibile</span>';
  return `<span class="form-dots" aria-label="Ultime partite: ${letters.map((letter) => formLabel[letter]).join(' ')}">${letters.map((letter) => `<span class="form-dot ${letter}">${formLabel[letter]}</span>`).join('')}</span>`;
}

function standingText(standing) {
  return standing?.rank ? `${standing.rank}° · ${standing.points} pt in ${standing.played} gare` : '';
}

function renderScoreGrid(grid, topScore) {
  if (!grid?.cells) return '';
  const max = Math.max(...grid.cells.flat());
  const header = `<span class="axis"></span>${grid.cells[0].map((_, away) => `<span class="axis">${away}</span>`).join('')}`;
  const rows = grid.cells.map((row, home) => `<span class="axis">${home}</span>${row.map((value, away) => `<span class="score-cell${`${home}-${away}` === topScore ? ' top' : ''}" data-alpha="${max ? (0.08 + 0.92 * value / max).toFixed(3) : 0}" title="${home}-${away}: ${percent(value)}">${value >= 0.01 ? Math.round(value * 100) : ''}</span>`).join('')}`).join('');
  return `<p class="muted small">Righe: gol della squadra di casa · colonne: gol della squadra in trasferta · valori in %. Altri risultati: ${percent(grid.other)}.</p><div class="score-grid" role="img" aria-label="Probabilità dei risultati esatti">${header}${rows}</div>`;
}

function renderOddsMovement(movement) {
  if (!movement?.items?.length) return '<p class="muted">La fonte non fornisce le quote di apertura per questa partita.</p>';
  return `<div class="movement-list">${movement.items.map((item) => {
    const arrow = item.current > item.open ? '↑' : item.current < item.open ? '↓' : '→';
    const tone = item.impliedChangePp > 0.25 ? 'signal-positive' : item.impliedChangePp < -0.25 ? 'signal-negative' : 'muted';
    return `<div class="movement-row"><span>${escapeHtml(item.label)}</span><b>${decimal(item.open)} ${arrow} ${decimal(item.current)}</b><span class="${tone}">${item.impliedChangePp >= 0 ? '+' : ''}${decimal(item.impliedChangePp, 1)} pp</span></div>`;
  }).join('')}</div><p class="muted small">pp = variazione della probabilità implicita. Solo informativo: non entra nel modello.</p>`;
}

function icsForFixture(fixture) {
  const stamp = (date) => new Date(date).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const start = new Date(fixture.kickoff);
  const end = new Date(start.getTime() + 2 * 3600000);
  const text = (value) => String(value).replace(/[,;\\]/g, (char) => `\\${char}`);
  return ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Leone Francesco//Football Engine//IT', 'BEGIN:VEVENT',
    `UID:${text(fixture.id)}@football-engine`, `DTSTAMP:${stamp(Date.now())}`, `DTSTART:${stamp(start)}`, `DTEND:${stamp(end)}`,
    `SUMMARY:${text(`${fixture.home.name} - ${fixture.away.name}`)}`, `LOCATION:${text(fixture.venue || '')}`, `DESCRIPTION:${text(fixture.league.name)}`,
    'BEGIN:VALARM', 'TRIGGER:-PT30M', 'ACTION:DISPLAY', 'DESCRIPTION:Calcio d\'inizio tra 30 minuti', 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
}

function shareText(analysis) {
  const { fixture, summary } = analysis;
  const odd = analysis.markets.find((market) => market.key === summary.recommendation.key)?.odd;
  return `${fixture.home.name} - ${fixture.away.name} (${fixture.league.name}, ${formatDateTime(fixture.kickoff)})\n1 ${percent(summary.outcomes.home, 0)} · X ${percent(summary.outcomes.draw, 0)} · 2 ${percent(summary.outcomes.away, 0)}\nIndicazione: ${summary.recommendation.label} ${percent(summary.recommendation.probability, 0)}${odd ? ` a quota ${decimal(odd)}` : ''}\nPrevisione probabilistica, non una certezza. Football Engine di Leone Francesco: https://flleone93.github.io/football-engine/`;
}
```

- [ ] **Step 3: Render** — in `renderAnalysis`:

Sostituire `<div class="match-teams">…</div>` con:

```js
      <div class="match-teams">
        <div class="team-line"><strong>${escapeHtml(fixture.home.name)}</strong>${formDots(analysis.context.form?.home)}<span class="team-meta">${escapeHtml(standingText(analysis.context.standings?.home))}</span><button class="team-star" type="button" data-team-star="${escapeHtml(fixture.home.id)}" aria-pressed="${favorites.has('team', fixture.home.id)}" aria-label="Preferita: ${escapeHtml(fixture.home.name)}">${favorites.has('team', fixture.home.id) ? '★' : '☆'}</button></div>
        <span class="vs">vs</span>
        <div class="team-line"><strong>${escapeHtml(fixture.away.name)}</strong>${formDots(analysis.context.form?.away)}<span class="team-meta">${escapeHtml(standingText(analysis.context.standings?.away))}</span><button class="team-star" type="button" data-team-star="${escapeHtml(fixture.away.id)}" aria-pressed="${favorites.has('team', fixture.away.id)}" aria-label="Preferita: ${escapeHtml(fixture.away.name)}">${favorites.has('team', fixture.away.id) ? '★' : '☆'}</button></div>
      </div>
      <p class="match-meta"><button class="team-star" type="button" data-league-star="${escapeHtml(fixture.league.id)}" aria-pressed="${favorites.has('league', fixture.league.id)}">${favorites.has('league', fixture.league.id) ? '★' : '☆'} Competizione preferita: ${escapeHtml(fixture.league.name)}</button></p>
      ${analysis.context.weather ? `<p class="weather-line">Meteo al calcio d'inizio (${escapeHtml(analysis.context.weather.city)}): ${escapeHtml(weatherText(analysis.context.weather))}</p>` : ''}
```

con, accanto agli helper:

```js
function weatherText(weather) {
  const parts = [];
  if (Number.isFinite(weather.temperatureC)) parts.push(`${Math.round(weather.temperatureC)}°C`);
  if (Number.isFinite(weather.precipitationProbability)) parts.push(`pioggia ${weather.precipitationProbability}%`);
  if (Number.isFinite(weather.windKmh)) parts.push(`vento ${Math.round(weather.windKmh)} km/h`);
  return parts.join(' · ');
}
```

Sostituire la sezione `section('Risultati esatti', …)` con:

```js
    ${section('Risultati esatti', 'Mappa delle probabilità dei punteggi', `${renderScoreGrid(analysis.scoreGrid, summary.exactScore.score)}<details class="nested"><summary>Elenco dei 10 più probabili</summary><div class="table-scroll"><table class="data-table"><thead><tr><th>#</th><th>Risultato</th><th>Esito</th><th class="numeric">Prob.</th><th class="numeric">Peso sull’esito</th></tr></thead><tbody>${analysis.exactScores.map((item) => `<tr><td>${item.rank}</td><td><strong>${item.score}</strong></td><td>${item.outcome}</td><td class="numeric">${percent(item.probability)}</td><td class="numeric">${percent(item.contributionToOutcome)}</td></tr>`).join('')}</tbody></table></div></details>`)}
    ${section('Movimento quote', 'Apertura contro quota attuale', renderOddsMovement(analysis.governance.oddsMovement))}
```

Nella sezione "Modelli e pesi" sostituire la parte dei modelli esclusi con:

```js
${missingModels.map((agent) => `<li><strong>${escapeHtml(agent.name)}</strong><span class="signal-muted">${agent.unavailableReason ? 'Non disponibile' : 'Escluso'}</span><small>${escapeHtml(agent.unavailableReason || 'Dati insufficienti.')}</small></li>`).join('')}
```

Nel processo multi-agente sostituire la riga degli articoli con:

```js
`<div class="workflow-grid">${analysis.workflow.map((agent) => { const status = agent.status || (agent.active ? 'active' : 'inactive'); return `<article class="workflow-agent ${status}"><span>${status === 'active' ? 'Attivo' : status === 'unavailable_source' ? 'Non disponibile' : 'Escluso'}</span><strong>${escapeHtml(agent.name)}</strong><p>${escapeHtml(agent.note)}</p></article>`; }).join('')}</div>`
```

Prima di `<div class="result-actions">` aggiungere:

```js
    <div class="share-actions"><button class="secondary-button" type="button" data-result-action="calendar">Aggiungi al Calendario</button><button class="secondary-button" type="button" data-result-action="share">Condividi</button></div>
```

Dopo l'impostazione delle larghezze `[data-width]`, aggiungere:

```js
  elements.analysisResult.querySelectorAll('[data-alpha]').forEach((node) => { node.style.backgroundColor = `color-mix(in srgb, var(--accent) ${Math.round(Number(node.dataset.alpha) * 100)}%, var(--surface-2))`; node.style.color = Number(node.dataset.alpha) > 0.55 ? 'var(--accent-ink)' : 'var(--text)'; });
  elements.analysisResult.querySelectorAll('[data-team-star]').forEach((button) => button.addEventListener('click', () => {
    const on = favorites.toggle('team', button.dataset.teamStar);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = on ? '★' : '☆';
    renderFixtures();
  }));
  elements.analysisResult.querySelectorAll('[data-league-star]').forEach((button) => button.addEventListener('click', () => {
    const on = favorites.toggle('league', button.dataset.leagueStar);
    button.setAttribute('aria-pressed', String(on));
    button.textContent = `${on ? '★' : '☆'} Competizione preferita: ${fixture.league.name}`;
    renderFixtures();
  }));
  elements.analysisResult.querySelector('[data-result-action="calendar"]')?.addEventListener('click', () => {
    downloadFile(`partita-${slug(`${fixture.home.name}-${fixture.away.name}`)}.ics`, icsForFixture(fixture), 'text/calendar').catch((error) => { elements.appStatus.textContent = error.message; });
  });
  elements.analysisResult.querySelector('[data-result-action="share"]')?.addEventListener('click', async () => {
    const text = shareText(analysis);
    try {
      if (navigator.share) await navigator.share({ title: `${fixture.home.name} - ${fixture.away.name}`, text });
      else { await navigator.clipboard.writeText(text); elements.appStatus.textContent = 'Analisi copiata negli appunti.'; }
    } catch (error) {
      if (error?.name !== 'AbortError') elements.appStatus.textContent = 'Condivisione non disponibile.';
    }
  });
```

In `styles.css` aggiungere anche: `details.nested { margin-top: 10px; } details.nested > summary { cursor: pointer; color: var(--accent); font-size: 13px; }`.

- [ ] **Step 4: Verifica**

Run: `node --check public/app.js && npm test && node scripts/build-pwa.mjs`. Nel browser a 390×844 aprire una partita reale e verificare: pallini forma, posizione, meteo (se la città è riconosciuta), griglia 6×6 con il risultato più probabile evidenziato, movimento quote, stati "Non disponibile" per arbitro, pulsanti Calendario/Condividi. Nessun overflow orizzontale.

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add public
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: dettaglio con forma, classifica, meteo, griglia risultati, movimento quote, calendario e condivisione"
```

---

### Task 8: Tema chiaro/scuro, anteprime di caricamento e guida al primo avvio

**Files:**
- Modify: `public/styles.css` (token tema chiaro, skeleton analisi, foglio guida)
- Modify: `public/index.html` (selettore tema nelle Impostazioni, contenitore guida)
- Modify: `public/app.js` (tema, guida)
- Modify: `scripts/build-pwa.mjs` (meta `theme-color` per entrambi i temi)

**Interfaces:**
- Produces: `applyTheme(choice: 'auto'|'light'|'dark')`; chiave browser `football-engine-theme`; chiave `football-engine-onboarded-v1`.

- [ ] **Step 1: Token tema chiaro** — in `public/styles.css`, subito dopo il blocco `:root { … }`:

```css
@media (prefers-color-scheme: light) {
  :root:not([data-theme="dark"]) {
    color-scheme: light;
    --bg: #f3f6f2; --bg-raised: #ffffff; --surface: #ffffff; --surface-2: #eef3ec; --surface-3: #dfe7dc;
    --line: rgba(20, 40, 28, .10); --line-strong: rgba(20, 40, 28, .20);
    --text: #14211a; --muted: #4f6357; --dim: #6f8276;
    --accent: #3f8f1f; --accent-soft: rgba(63, 143, 31, .12); --accent-ink: #ffffff;
    --home: #3f8f1f; --draw: #8b9b91; --away: #c07a12; --good: #23894a; --warn: #b26b00; --bad: #c63d2b;
  }
}
:root[data-theme="light"] {
  color-scheme: light;
  --bg: #f3f6f2; --bg-raised: #ffffff; --surface: #ffffff; --surface-2: #eef3ec; --surface-3: #dfe7dc;
  --line: rgba(20, 40, 28, .10); --line-strong: rgba(20, 40, 28, .20);
  --text: #14211a; --muted: #4f6357; --dim: #6f8276;
  --accent: #3f8f1f; --accent-soft: rgba(63, 143, 31, .12); --accent-ink: #ffffff;
  --home: #3f8f1f; --draw: #8b9b91; --away: #c07a12; --good: #23894a; --warn: #b26b00; --bad: #c63d2b;
}
```

e sostituire i due sfondi fissi della barra superiore (`background: rgba(13, 20, 17, .86)` e, nella media query telefono, la barra schede `rgba(13, 20, 17, .92)`) con `background: color-mix(in srgb, var(--bg) 88%, transparent);`. Aggiungere:

```css
.onboarding { position: fixed; inset: 0; z-index: 100; display: grid; align-items: end; padding: 16px; padding-bottom: calc(16px + env(safe-area-inset-bottom, 0px)); background: rgba(0, 0, 0, .55); }
.onboarding-sheet { display: grid; gap: 14px; width: min(520px, 100%); margin: 0 auto; padding: 22px; border-radius: 22px; background: var(--surface); }
.onboarding-sheet h2 { font-size: 22px; }
.onboarding-steps { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
.onboarding-steps li { display: grid; grid-template-columns: 30px minmax(0, 1fr); gap: 10px; color: var(--muted); font-size: 14px; }
.onboarding-steps b { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 50%; color: var(--accent-ink); background: var(--accent); }
.skeleton-card { display: grid; gap: 10px; padding: 18px; border: 1px solid var(--line); border-radius: var(--radius); background: var(--surface); }
.skeleton-card .skeleton-line { height: 14px; }
.skeleton-card .skeleton-line.wide { height: 28px; width: 70%; }
```

- [ ] **Step 2: Markup** — in `public/index.html`:
  - nella `fieldset` "Dati" delle Impostazioni, prima del `div#settingsLeagues`:

```html
          <label for="settingsTheme">Aspetto
            <select id="settingsTheme"><option value="auto">Automatico (come l'iPhone)</option><option value="light">Chiaro</option><option value="dark">Scuro</option></select>
          </label>
```

  - prima di `</main>`: `<div id="onboarding" class="onboarding" hidden></div>`;
  - nel `<head>` sostituire `<meta name="theme-color" content="#0d1411">` con:

```html
  <meta name="theme-color" content="#0d1411" media="(prefers-color-scheme: dark)">
  <meta name="theme-color" content="#f3f6f2" media="(prefers-color-scheme: light)">
```

- [ ] **Step 3: Logica** — in `public/app.js` aggiungere `'settingsTheme', 'onboarding'` agli `elements`, e prima di `async function boot()`:

```js
// ---------- Tema e guida al primo avvio ----------

function applyTheme(choice) {
  if (choice === 'light' || choice === 'dark') document.documentElement.dataset.theme = choice;
  else delete document.documentElement.dataset.theme;
}
const storedTheme = (() => { try { return localStorage.getItem('football-engine-theme') || 'auto'; } catch { return 'auto'; } })();
applyTheme(storedTheme);
if (elements.settingsTheme) {
  elements.settingsTheme.value = storedTheme;
  elements.settingsTheme.addEventListener('change', () => {
    applyTheme(elements.settingsTheme.value);
    try { localStorage.setItem('football-engine-theme', elements.settingsTheme.value); } catch { /* sessione */ }
  });
}

function showOnboarding() {
  let seen = false;
  try { seen = localStorage.getItem('football-engine-onboarded-v1') === '1'; } catch { /* sessione */ }
  if (seen || !deviceApp?.settings || !elements.onboarding) return;
  const install = standaloneDisplay ? '' : '<li><b>3</b><span><strong>Installa l\'app:</strong> in Safari tocca Condividi → "Aggiungi alla schermata Home".</span></li>';
  elements.onboarding.innerHTML = `<div class="onboarding-sheet" role="dialog" aria-modal="true" aria-labelledby="onboardingTitle">
    <h2 id="onboardingTitle">Benvenuto in Football Engine</h2>
    <ol class="onboarding-steps">
      <li><b>1</b><span><strong>Partite reali, probabilità oneste:</strong> tocca una partita per vedere 1X2, risultati, quote e valore. Sono probabilità, non certezze.</span></li>
      <li><b>2</b><span><strong>Attiva Claude (consigliato):</strong> Impostazioni → incolla la chiave creata su console.anthropic.com. Senza chiave funziona il motore statistico.</span></li>
      ${install}
    </ol>
    <button class="primary-button" type="button" data-onboarding-close>Inizia</button>
    <p class="muted small">Creata da Leone Francesco · solo maggiorenni · gioca responsabilmente.</p>
  </div>`;
  elements.onboarding.hidden = false;
  elements.onboarding.querySelector('[data-onboarding-close]').addEventListener('click', () => {
    elements.onboarding.hidden = true;
    try { localStorage.setItem('football-engine-onboarded-v1', '1'); } catch { /* sessione */ }
  });
}
```

In `boot()`, dopo `await loadMeta();`, aggiungere `showOnboarding();`.

In `public/index.html`, dentro `#analysisLoading` dopo il paragrafo finale, aggiungere le anteprime dell'analisi:

```html
            <div class="skeleton-card"><span class="skeleton-line wide"></span><span class="skeleton-line"></span><span class="skeleton-line"></span></div>
            <div class="skeleton-card"><span class="skeleton-line wide"></span><span class="skeleton-line"></span></div>
```

e in `styles.css` aggiungere `.analysis-loading .skeleton-card { width: 100%; text-align: left; }`. Poi, in `loadFixtures`, sostituire il contenuto di `#fixturesLoading` con anteprime: in `public/index.html` cambiare `<div id="fixturesLoading" class="loading-card" role="status">…</div>` in:

```html
          <div id="fixturesLoading" role="status" aria-label="Caricamento del calendario"><div class="skeleton-card"><span class="skeleton-line wide"></span><span class="skeleton-line"></span></div><div class="skeleton-card"><span class="skeleton-line wide"></span><span class="skeleton-line"></span></div><div class="skeleton-card"><span class="skeleton-line wide"></span><span class="skeleton-line"></span></div></div>
```

- [ ] **Step 4: Verifica**

Run: `node --check public/app.js && npm test && node scripts/build-pwa.mjs`. Nel browser: prima apertura con la guida (si chiude e non riappare); tema chiaro con `colorScheme: light` (contrasto leggibile, barra 1X2 visibile); "Aspetto" forza chiaro/scuro; anteprime grigie durante il caricamento.

- [ ] **Step 5: Commit**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add public scripts
/Library/Developer/CommandLineTools/usr/bin/git commit -m "feat: tema chiaro e scuro, anteprime di caricamento, guida al primo avvio"
```

---

### Task 9: Versione 1.10.0, documentazione, build, verifica e pubblicazione

**Files:**
- Modify: `src/api.js` (`APP_VERSION = '1.10.0'`), `package.json`, `package-lock.json`
- Modify: `README.md`, `AUDIT_PROGETTO.md`, `GUIDA_AI_PROVIDER.md`, `CLAUDE_PROJECT_HANDOFF.md`, `ARCHITETTURA_AI.md` (5 agenti, meteo, previsioni rapide)
- Rebuild: `dist/football-engine-demo.html`, `dist/pwa`, copia dei file offline nella cartella principale con nome `v1.10.0`

- [ ] **Step 1: Versione** — sostituire `'1.9.0'` con `'1.10.0'` in `src/api.js`; `"version": "1.9.0"` → `"1.10.0"` in `package.json` e `package-lock.json`.

- [ ] **Step 2: Documentazione** — README: sezione "Novità 1.10.0" (elenco del piano); in ogni documento sostituire "sei agenti" con "cinque agenti" e la riga dell'agente Player Availability con "Lineups & Tactical Context (formazioni, indisponibili, tattica, meteo informativo)"; in AUDIT aggiungere la tabella della Fase 0 con i numeri misurati (meteo 0%→attivo dove la città è riconosciuta; ML ed Aggiornamento bayesiano rimossi; agente giocatori 1% → unito; notizie con fonte di squadra). Copiare i `.md` nella cartella principale.

- [ ] **Step 3: Test e build**

Run: `npm test && node scripts/build-standalone.mjs && node scripts/build-pwa.mjs`
Expected: tutti i test PASS; build completate.

- [ ] **Step 4: Verifica nel browser** (skill `verification-before-completion`) a 390×844 e 1024 px, tema chiaro e scuro: elenco con previsioni, filtri, preferiti, dettaglio completo, workflow senza moduli finti, guida, nessun overflow, nessun errore in console. Misurare di nuovo la copertura del meteo e delle notizie sullo snapshot reale con lo script di misura della Fase 0 e riportare i numeri.

- [ ] **Step 5: Commit, pubblicazione e verifica online**

```bash
/Library/Developer/CommandLineTools/usr/bin/git add -A
/Library/Developer/CommandLineTools/usr/bin/git commit -m "Versione 1.10.0: pulizia agenti, meteo, elenco arricchito, preferiti, tema, guida"
```

Push con l'accesso GitHub attivo, attesa del workflow Pages verde, poi verificare che `https://flleone93.github.io/football-engine/sw.js` riporti `1.10.0` e che `engine.js` online coincida con `dist/pwa/engine.js`.
