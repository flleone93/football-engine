# Enterprise Football Prediction Engine

Versione 1.8.0. Motore ibrido per l'analisi probabilistica delle partite di calcio con dati reali: baseline statistica deterministica, sei agenti AI con guardrail, Top Picks giornaliere, simulazione quote e validazione post-partita delle previsioni.

## Tre modi di usarlo

| Modo | Dati | Agenti AI | Come si apre |
|---|---|---|---|
| **Artifact claude.ai** | Snapshot reale ESPN (155 partite in 15 competizioni al 10/10/2026) | Eseguiti da **Claude** nel runtime Artifact, senza chiavi | [claude.ai/artifact/TEoB1n8Mkv8aDVSH4GHnEU](https://claude.ai/artifact/TEoB1n8Mkv8aDVSH4GHnEU) (privato finché non lo condividi) |
| **Server locale / Render** | **Live** ESPN senza chiave, oppure API-Football con chiave | Gemini o OpenAI con chiave lato server | `Avvia Football Engine - Live.command` oppure `npm start` |
| **File offline** | Snapshot reale ESPN o dati demo | Spenti (sola baseline statistica) | `Football Engine v1.8.0 - Live offline.html` / `- Demo offline.html` |

## Architettura

1. **Provider dati**: `espn` (pubblico, senza chiave: calendario, classifiche, forma ultime 5, scontri diretti, notizie, quote DraftKings 1X2 e Over/Under 2.5 con apertura e attuale), `api-football` (con chiave: anche infortuni, formazioni, previsione esterna), `demo`, `snapshot`.
2. **Motore deterministico**: data quality, feature engineering, Poisson/Dixon-Coles, Monte Carlo (50.000 simulazioni), quote de-vig, ensemble pesato, calibrazione strutturale, scenari, mercati, risultati esatti, progressione knockout, timeline, incertezza, movimento quote, Top Picks risk-adjusted.
3. **Agenti AI** (Player Availability & Impact, Tactical Context, News Intelligence, Competition Context, Challenge & Bias Detection, Final Explanation): ricevono un evidence pack minimizzato per dominio, rispondono in JSON validato e possono solo proporre piccoli aggiustamenti xG o penalità di confidenza entro limiti rigidi.
4. **Orchestratore e governance**: cap per agente e globali, deduplicazione delle evidenze, guardrail sullo spostamento delle probabilità, cinque layer separati (dati reali, baseline, valutazioni AI, inferenze non confermate, raccomandazione), audit.
5. **Registro previsioni e Performance**: ogni previsione pre-partita viene registrata e confrontata con il risultato al 90' (Brier, log loss, RPS, calibrazione, ROI, confronto con il mercato).

Il workflow dell'analisi elenca 27 moduli e dichiara per ciascuno se è attivo o escluso per mancanza di dati (es. infortuni e formazioni non forniti dalla fonte pubblica ESPN).

## Avvio Rapido

```bash
npm install
cp .env.example .env
npm start
```

Apri `http://localhost:8080`. Il profilo predefinito usa dati reali ESPN (`DEMO_MODE=false`, `DATA_PROVIDER=espn`) e non richiede chiavi. Senza chiave AI il motore deterministico funziona da solo.

Dati dimostrativi: `DEMO_MODE=true`. API-Football: `DATA_PROVIDER=api-football` e `API_FOOTBALL_KEY=...`.

## Snapshot Live e Artifact

```bash
npm run build:live
```

Lo script:

1. scarica da ESPN le partite dei prossimi 7 giorni (`SNAPSHOT_DAYS`) con tutti i dati disponibili;
2. cerca il risultato al 90' delle previsioni registrate negli snapshot precedenti (`data/live-predictions.jsonl`);
3. registra la previsione deterministica pre-partita di ogni nuova gara;
4. genera `dist/live-snapshot.json`, `dist/football-engine-live.html` (file offline) e `dist/artifact/football-engine-live.html` (contenuto per l'Artifact claude.ai).

Eseguito regolarmente (ad esempio ogni giorno con `Aggiorna snapshot live.command`), costruisce uno storico reale e senza look-ahead: il tab Performance mostra le metriche man mano che le partite si concludono.

Nell'Artifact gli agenti AI usano la capability `sample`: a ogni analisi Claude riceve gli stessi prompt, evidence pack e JSON Schema dei provider Gemini/OpenAI, e il backend applica la stessa validazione e gli stessi limiti. Al primo uso Claude chiede il consenso e l'utilizzo è a carico di chi visualizza. Se Claude non è disponibile resta la baseline statistica.

## AI su Server: Gemini o OpenAI

```env
AI_MODE=active
AI_PROVIDER=gemini
GEMINI_API_KEY=...
```

oppure `AI_PROVIDER=openai` con `OPENAI_API_KEY`. `AI_MODE=shadow` esegue gli agenti senza applicarne gli effetti. Dettagli in `GUIDA_AI_PROVIDER.md`.

## Endpoint

| Endpoint | Metodo | Scopo |
|---|---:|---|
| `/api/health` | GET | Health check leggero |
| `/api/ready` | GET | Stato provider + AI |
| `/api/meta` | GET | Configurazione pubblica, provider dati, snapshot |
| `/api/fixtures` | GET | Calendario autoaggiornato |
| `/api/analyze` | POST | Analisi singola partita |
| `/api/top-picks` | POST | Top 5/6/7 del giorno con quote e simulazione |
| `/api/usage` | GET | Ledger costi AI; dettagli errori solo con `ADMIN_API_TOKEN` |
| `/api/performance` | GET | Metriche post-partita, calibrazione, benchmark mercato |
| `/api/performance/records` | GET | Registro previsioni ufficiali (export CSV) |
| `/api/performance/settle` | POST | Forza l'acquisizione dei risultati; solo admin |

## File Principali

| File | Ruolo |
|---|---|
| `src/server.js` | API HTTP, sicurezza, rate limit, static con ETag |
| `src/api.js` | Logica API condivisa tra server, file offline e Artifact |
| `src/hybridEngine.js` | Pipeline baseline statistica + AI bounded |
| `src/ai/*` | Agenti, schemi JSON, adapter Gemini/OpenAI/Claude, ledger costi |
| `src/prediction/*` | Motore deterministico e Top Picks |
| `src/providers/*` | ESPN, API-Football, snapshot, demo |
| `src/tracking/*` | Registro previsioni, risultati, metriche post-partita |
| `src/browser/*` | Entry point offline/Artifact, shim fetch, SHA-256 |
| `scripts/*` | Build demo, build snapshot live, bundler |
| `public/*` | Frontend responsive e accessibile |

## Verifica

```bash
npm test
```

47 test: probabilità, mercati, H2H, Top Picks, quality gate, provenienza, isolamento dei payload AI, adapter Gemini/OpenAI/Claude (sei agenti end-to-end con sampler simulato e fallback su rifiuto), deduplicazione, knockout, guardrail, costi, metriche Brier/log loss/RPS, registro persistente, risultato al 90', quote ESPN e snapshot.

## Limiti Dichiarati

- ESPN non espone infortuni né previsioni esterne e pubblica le formazioni solo vicino al calcio d'inizio: questi moduli risultano esclusi e la qualità dati lo riflette. Con API-Football sono disponibili.
- Inizio stagione: con poche partite giocate le statistiche stagionali vengono regredite verso la media; le quote pesano di più.
- Uno snapshot è fermo al momento della generazione: quote e notizie successive non sono incluse finché non viene rigenerato.
- Lo storico reale parte dal primo snapshot (10/10/2026): le metriche diventano significative dopo alcune centinaia di partite regolate.
- La calibrazione applicata ai numeri resta strutturale; quella empirica è misurata nel tab Performance ma non ricalibra automaticamente il modello.
- Previsioni probabilistiche, non garanzie né consigli finanziari. Solo maggiorenni.

## Documentazione

- `GUIDA_INSTALLAZIONE.md`: installazione locale, live, snapshot, Artifact, Docker e Render.
- `GUIDA_AI_PROVIDER.md`: Gemini, OpenAI e Claude (Artifact), modelli, budget e verifica.
- `ARCHITETTURA_AI.md`: architettura ibrida e policy di aggiustamento.
- `SCHEMI_OUTPUT.md`: schema operativo degli output API, agenti, registro e snapshot.
- `AUDIT_PROGETTO.md`: rilievi, correzioni, verifiche e limiti residui.
- `CLAUDE_PROJECT_HANDOFF.md`: handoff tecnico completo.
- `CONFRONTO_CLAUDE.md`: analisi storica della variante Claude v1.2.
