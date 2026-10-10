# Enterprise Football Prediction Engine

Creata da **Leone Francesco**.

Versione 1.9.0. Motore ibrido per l'analisi probabilistica delle partite di calcio con dati reali: baseline statistica deterministica, sei agenti AI con guardrail, Top Picks giornaliere, simulazione quote e validazione post-partita delle previsioni.

## Quattro modi di usarlo

| Modo | Dati | Agenti AI | Come si apre |
|---|---|---|---|
| **Artifact claude.ai** | Snapshot reale ESPN (155 partite in 15 competizioni al 10/10/2026) | Eseguiti da **Claude** nel runtime Artifact, senza chiavi | [claude.ai/artifact/TEoB1n8Mkv8aDVSH4GHnEU](https://claude.ai/artifact/TEoB1n8Mkv8aDVSH4GHnEU) (privato finché non lo condividi) |
| **App iPhone** | **Live** ESPN scaricato dal telefono | Gemini o OpenAI con la chiave salvata sul telefono | [flleone93.github.io/football-engine](https://flleone93.github.io/football-engine/) → Safari → Condividi → Aggiungi alla schermata Home |
| **Server locale / Render** | **Live** ESPN senza chiave, oppure API-Football con chiave | Gemini o OpenAI con chiave lato server | `Avvia Football Engine - Live.command` oppure `npm start` |
| **File offline** | Snapshot reale ESPN o dati demo | Spenti (sola baseline statistica) | `Football Engine v1.9.0 - Live offline.html` / `- Demo offline.html` |

## Novità 1.9.0: interfaccia per iPhone

- Barra superiore compatta con stato (Live, AI, 18+) e firma **"Creata da Leone Francesco"** in alto a destra.
- Su telefono le sezioni (Partite, Top, Storico, Impostazioni) sono in una barra in basso, come nelle app iOS; su desktop restano in alto.
- Elenco partite → dettaglio con tasto indietro; senza AI l'analisi parte al tocco, con AI si sceglie tra analisi con agenti o rapida.
- Risultato riorganizzato: scheda partita con barra 1X2 a colori, scheda "Indicazione" con probabilità, quota, edge e confidenza, sei metriche chiave, poi sezioni richiudibili (mercati, spiegazione AI, risultati esatti, andamento, fattori, scenari, modelli, rischi, dati, processo multi-agente, audit).
- Top del giorno come schede da toccare; Storico con elenchi leggibili su schermo stretto; Impostazioni in stile iOS con scheda "Informazioni".
- Pulsanti e campi da almeno 44 px, testo 16 px nei campi (niente zoom automatico di Safari), margini per notch e barra home, export tramite il foglio di condivisione di iPhone.

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

## App iPhone (PWA)

Tutto gira sul telefono, senza server: dati ESPN in diretta, motore completo, agenti AI con la propria chiave, registro previsioni nell'IndexedDB del dispositivo.

1. Apri https://flleone93.github.io/football-engine/ in **Safari** su iPhone.
2. Condividi → **Aggiungi alla schermata Home**.
3. Apri l'app dall'icona → **Impostazioni**: scegli Gemini o OpenAI e incolla la chiave (resta solo sul telefono). Senza chiave funziona il motore statistico.

Funzioni specifiche dell'app:

- competizioni e giorni da scansionare configurabili;
- tracciamento automatico ogni 6 ore all'apertura: acquisisce i risultati e registra le previsioni pre-partita delle 48 ore successive (solo motore deterministico, nessun costo AI);
- storico iniziale importato dal registro del Mac (`data/live-predictions.jsonl`);
- funzionamento offline con gli ultimi dati scaricati; aggiornamento automatico dell'app a ogni pubblicazione.

Limiti: iOS non esegue web app in background, quindi dati e risultati si aggiornano quando l'app viene aperta. Lo storico vive sul telefono: eliminare l'app dalla Home o i dati del sito lo cancella (usare `Esporta CSV` per conservarlo).

Pubblicazione: repository pubblico https://github.com/flleone93/football-engine. Ogni push su `main` esegue i test, genera `dist/pwa` (`npm run build:pwa`) e lo pubblica su GitHub Pages (`.github/workflows/pages.yml`).

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

48 test (incluso il controllo della build iPhone: CSP, manifest, icone, nessuna chiave nei file pubblicati): probabilità, mercati, H2H, Top Picks, quality gate, provenienza, isolamento dei payload AI, adapter Gemini/OpenAI/Claude (sei agenti end-to-end con sampler simulato e fallback su rifiuto), deduplicazione, knockout, guardrail, costi, metriche Brier/log loss/RPS, registro persistente, risultato al 90', quote ESPN e snapshot.

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
