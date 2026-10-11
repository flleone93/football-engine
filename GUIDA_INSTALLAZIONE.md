# Guida Installazione e Messa in Produzione

Questa guida spiega come avviare, configurare, verificare e pubblicare l'Enterprise Football Prediction Engine.

## 1. Requisiti

- Node.js 20 o superiore.
- npm incluso con Node.
- Per dati live: chiave API-Football.
- Per agenti AI: una chiave Google Gemini API oppure OpenAI API.
- Per deploy: account Render.

Il progetto non richiede database esterno: cache, rate limit e ledger dei costi AI sono in memoria; il registro previsioni live è un file JSONL in `data/`.

## 1b. Avvio con Doppio Clic (macOS)

Nella cartella principale:

- `Avvia Football Engine - Live.command`: server locale con dati reali ESPN, nessuna chiave;
- `Avvia Football Engine - Demo.command`: server locale con dati dimostrativi;
- `Aggiorna snapshot live.command`: scarica dati reali aggiornati, regola le previsioni passate e rigenera `Football Engine v1.9.0 - Live offline.html` e il file dell'Artifact;
- `Football Engine v1.9.0 - Live offline.html` e `- Demo offline.html`: si aprono nel browser senza Node.

Al primo avvio macOS può chiedere conferma: tasto destro sul file, `Apri`.

## 1c. Dati Reali senza Chiave (ESPN)

```env
DEMO_MODE=false
DATA_PROVIDER=espn
```

Fonti incluse: calendario di 15 competizioni (Serie A e B, Premier League, Championship, LaLiga, Bundesliga, Ligue 1, Primeira Liga, Eredivisie, Champions, Europa e Conference League, MLS, Brasileirão, Liga Profesional), classifiche, ultime cinque partite, scontri diretti, notizie filtrate per squadra, quote DraftKings 1X2 e Over/Under 2.5 con valore di apertura. Non incluse: infortuni, previsioni esterne; formazioni solo a ridosso della gara. Il registro previsioni live acquisisce i risultati al 90' dalla stessa fonte.

Con `API_FOOTBALL_KEY` valorizzata e `DATA_PROVIDER` non impostato il server usa automaticamente API-Football.

## 1d. Artifact su claude.ai

```bash
npm run build:live
```

genera `dist/artifact/football-engine-live.html`: è il contenuto da pubblicare come Artifact con le capability `sample` (agenti AI eseguiti da Claude) e `downloads` (export JSON/CSV). Per aggiornarlo: rigenerare lo snapshot e chiedere a Claude di ripubblicare lo stesso file sullo stesso link.

## 1e. App iPhone

Indirizzo: https://flleone93.github.io/football-engine/ (Safari → Condividi → Aggiungi alla schermata Home). Impostazioni dell'app: provider AI e chiave, modalità active/shadow, giorni e competizioni, tracciamento automatico.

Aggiornare l'app dopo una modifica al codice:

```bash
npm test
git add -A
git commit -m "Descrizione della modifica"
git push
```

GitHub Actions esegue i test e ripubblica; sul telefono la nuova versione arriva alla successiva apertura. Per provarla in locale: `npm run build:pwa` e servire `dist/pwa` con un server statico.

Per aggiornare lo storico iniziale incluso nell'app, eseguire `npm run build:live` (aggiorna `data/live-predictions.jsonl`) e poi committare e pushare il file.

## 2. Installazione Locale in Demo

```bash
npm install
cp .env.example .env
npm start
```

Apri:

```text
http://localhost:8080
```

Configurazione demo consigliata:

```env
DEMO_MODE=true
AI_MODE=off
PORT=8080
TIMEZONE=Europe/Rome
```

In demo puoi provare:

- elenco partite;
- analisi singola;
- mercati 1X2, doppia chance, Goal/No Goal, Over/Under 1.5 e 2.5;
- Top 5/6/7 del giorno;
- simulazione multipla e singole;
- audit e cinque layer di output.
- separazione tra 1X2 al 90' e qualificazione nelle gare a eliminazione diretta confermate;
- andamento temporale di baseline e livello di incertezza;
- tab Performance con storico dimostrativo simulato (squadre fittizie), metriche e calibrazione;
- export JSON, stampa/PDF ed export CSV.

## 3. Collegare Dati Live

Modifica `.env`:

```env
DEMO_MODE=false
API_FOOTBALL_KEY=la_tua_chiave
API_FOOTBALL_BASE_URL=https://v3.football.api-sports.io
BOOKMAKER_NAME=Bet365
TIMEZONE=Europe/Rome
```

Riavvia:

```bash
npm start
```

Il backend mantiene la chiave API solo lato server. Il frontend non riceve mai segreti.

## 4. Collegare Google Gemini o OpenAI

Profilo consigliato economico con Google Gemini:

```env
AI_MODE=active
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL_DEFAULT=gemini-2.5-flash-lite
GEMINI_MODEL_CHALLENGE=gemini-2.5-flash
GEMINI_MODEL_EXPLANATION=gemini-2.5-flash-lite
AI_REASONING_EFFORT=low
```

Profilo alternativo OpenAI:

```env
AI_MODE=active
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL_DEFAULT=gpt-5.6-luna
OPENAI_MODEL_CHALLENGE=gpt-5.6-terra
OPENAI_MODEL_EXPLANATION=gpt-5.6-luna
AI_REASONING_EFFORT=low
```

`AI_MODE=shadow` resta disponibile per eseguire gli agenti senza modificare i numeri finali. Il provider selezionato e i modelli effettivi sono visibili in `/api/meta`, senza esporre le chiavi.

Verifica dal browser o via API:

```bash
curl http://localhost:8080/api/meta
curl http://localhost:8080/api/usage
```

## 5. Attivare AI sui Numeri

Il pacchetto 1.9.0 è predisposto per `active`; tutti gli aggiustamenti restano comunque soggetti ai seguenti limiti deterministici:

```env
AI_MODE=active
AI_MAX_PLAYER_XG_DELTA=0.12
AI_MAX_TACTICAL_XG_DELTA=0.08
AI_MAX_NEWS_XG_DELTA=0.04
AI_MAX_COMPETITION_XG_DELTA=0.06
AI_MAX_TOTAL_XG_DELTA=0.20
AI_MAX_PROBABILITY_SHIFT_PP=5
AI_MIN_EFFECT_CONFIDENCE=0.55
AI_DUPLICATE_EVIDENCE_SCALE=0.50
```

Regole applicate:

- gli agenti propongono effetti, non decidono probabilità;
- il backend limita ogni effetto per agente;
- il backend limita lo spostamento totale degli xG;
- il backend limita lo shift massimo delle probabilità 1X2;
- l'audit conserva richiesta, cap locale, scala globale e variazione finale applicata;
- il backend riduce gli effetti successivi fondati sulla stessa evidenza;
- se l'AI fallisce, resta valida la baseline deterministica.

## 6. Top Picks AI

La scansione di tutte le partite resta deterministica. Nel profilo 1.6 l'AI è attiva soltanto sulla shortlist finale, evitando chiamate su ogni fixture.

Per abilitare AI solo su shortlist:

```env
TOP_PICKS_AI_ENABLED=true
TOP_PICKS_AI_SHORTLIST_MULTIPLIER=1
```

Esempio: Top 5 richiede baseline su tutte le partite, poi AI solo sulle prime 5 candidate. Portare il moltiplicatore a `2` solo se il budget lo consente.

## 7. Limiti di Costo e Uso

```env
AI_DAILY_CALL_LIMIT=500
AI_DAILY_TOKEN_LIMIT=1000000
AI_DAILY_COST_LIMIT_USD=25
AI_MAX_CALLS_PER_ANALYSIS=6
AI_MAX_CONCURRENCY=2
AI_REQUEST_TIMEOUT_MS=20000
AI_AGENT_CACHE_TTL_SECONDS=3600
```

Se vuoi stimare costi nel ledger:

```env
AI_INPUT_COST_PER_MILLION=0.30
AI_CACHED_INPUT_COST_PER_MILLION=0.03
AI_OUTPUT_COST_PER_MILLION=2.50
```

Inserisci i valori correnti del modello scelto. Il sistema registra token, chiamate, errori e stima costo aggregata. Chiamate, token e costo stimato vengono prenotati prima dell'invio, così richieste concorrenti non possono superare silenziosamente il budget configurato.

Per vedere i dettagli degli errori del ledger imposta un token amministrativo:

```env
ADMIN_API_TOKEN=una_stringa_lunga_e_casuale
```

```bash
curl -H "Authorization: Bearer $ADMIN_API_TOKEN" http://localhost:8080/api/usage
```

Senza token l'endpoint espone soltanto aggregati e numero degli errori.

## 8. Quality Gates Top Picks

```env
TOP_PICKS_MIN_PROBABILITY=0.55
TOP_PICKS_MIN_CONFIDENCE=45
TOP_PICKS_MIN_DATA_QUALITY=40
TOP_PICKS_REQUIRE_POSITIVE_EV=false
```

Imposta l'ultima variabile a `true` per pubblicare solo esiti con expected value positivo. Una classifica puo contenere meno di 5/6/7 risultati quando le soglie non sono raggiunte.

## 9. Test

```bash
npm test
node --check src/server.js
node --check public/app.js
```

Test inclusi:

- coerenza motore probabilistico;
- analizzabilità partite demo;
- normalizzazione risultati esatti;
- coerenza strutturale 1X2;
- mercati complementari;
- Top Picks;
- simulazione stake;
- guardrail AI, adapter Gemini/OpenAI, cap cumulativi e budget concorrenti;
- corretta contabilizzazione dei token cached;
- limite effettivo H2H al 7%;
- presenza dei cinque layer.
- provenienza corretta anche in caso di fallback vuoto del provider;
- distinzione 90 minuti/qualificazione e coerenza supplementari-rigori;
- incertezza ed esito associato ai risultati esatti;
- metriche Brier, log loss, RPS e calibrazione con valori di riferimento noti;
- registro previsioni: solo pre-partita, una previsione ufficiale per gara, persistenza JSONL e righe troncate;
- endpoint Performance ed export, protezione admin del settlement forzato;
- risultato API-Football al 90' anche dopo i supplementari;
- provider Claude: cinque agenti end-to-end con sampler simulato, fallback su consenso negato;
- quote ESPN americane→decimali, linee Over/Under diverse da 2.5 escluse, snapshot e selezione `DATA_PROVIDER`.

## 10. Docker

Build locale:

```bash
docker build -t enterprise-football-engine .
docker run --env-file .env -p 8080:8080 enterprise-football-engine
```

Compose:

```bash
docker compose up --build
```

Il registro previsioni è scritto in `/app/data`: `compose.yaml` lo monta su `./data`. Con `docker run` aggiungi `-v "$PWD/data:/app/data"`.

## 11. Deploy su Render

1. Crea un nuovo Web Service da repository.
2. Usa il file `render.yaml` incluso.
3. Imposta le variabili sensibili in Render, non nel codice:

```env
API_FOOTBALL_KEY=...
GEMINI_API_KEY=...
DEMO_MODE=false
AI_MODE=active
AI_PROVIDER=gemini
TRUST_PROXY=true
```

4. Avvia il deploy.
5. Controlla `/api/health` e `/api/ready`.
6. Controlla in `/api/meta` che `effectiveMode` sia `active` e il provider sia quello atteso.
7. `render.yaml` monta un disco persistente da 1 GB su `/app/data` per il registro previsioni (richiede un piano a pagamento). Senza disco lo storico Performance si azzera a ogni deploy.

## 12. Variabili Principali

| Variabile | Default | Scopo |
|---|---:|---|
| `DEMO_MODE` | `true` (`.env.example`: `false`) | Usa dati demo invece del provider live |
| `DATA_PROVIDER` | `espn` senza chiave, `api-football` con chiave | Provider live |
| `SNAPSHOT_DAYS` | `7` | Giorni coperti da `npm run build:live` |
| `LIVE_LEDGER_PATH` | `data/live-predictions.jsonl` | Registro dello snapshot live |
| `API_FOOTBALL_KEY` | vuoto | Chiave API-Football lato backend |
| `AI_PROVIDER` | `gemini` | `gemini`, `openai` oppure `claude` (solo Artifact) |
| `GEMINI_API_KEY` | vuoto | Chiave Google Gemini lato backend |
| `OPENAI_API_KEY` | vuoto | Chiave OpenAI lato backend |
| `AI_MODE` | `off` | `off`, `shadow`, `active` |
| `CACHE_TTL_SECONDS` | `900` | Cache dati e analisi |
| `REQUESTS_PER_MINUTE` | `90` | Rate limit generale |
| `EXPENSIVE_REQUESTS_PER_MINUTE` | `12` | Rate limit analisi/Top Picks |
| `TOP_PICKS_MAX_FIXTURES` | `400` | Massimo partite scansionate al giorno |
| `MONTE_CARLO_RUNS` | `50000` | Simulazioni per analisi |
| `PREDICTION_LEDGER_ENABLED` | `true` | Registro previsioni e tab Performance |
| `PREDICTION_LEDGER_PATH` | `data/predictions.jsonl` | File del registro (solo live) |
| `BET_JOURNAL_PATH` | `data/bet-journal.jsonl` | Diario personale delle giocate (solo live, escluso da git) |
| `RESULT_SETTLEMENT_DELAY_MINUTES` | `150` | Attesa dopo il calcio d'inizio prima di cercare il risultato |
| `RESULT_SETTLEMENT_INTERVAL_MINUTES` | `15` | Intervallo minimo tra due controlli risultati |
| `RESULT_SETTLEMENT_MAX_PER_RUN` | `40` | Richieste massime al provider per controllo |

## 13. Troubleshooting

Se il calendario è vuoto:

- controlla `DEMO_MODE`;
- controlla `API_FOOTBALL_KEY`;
- verifica quota/limiti del provider;
- usa `/api/meta` e `/api/health`.

Se l'AI non parte:

- controlla `AI_MODE`;
- controlla `AI_PROVIDER` e la relativa chiave `GEMINI_API_KEY` o `OPENAI_API_KEY`;
- controlla che i modelli configurati appartengano al provider selezionato;
- leggi `/api/usage`;
- verifica limiti giornalieri e timeout.

Se Render non espone l'app:

- controlla che `PORT` sia quello assegnato da Render;
- lascia `HOST=0.0.0.0`;
- imposta `TRUST_PROXY=true`;
- verifica i log build e runtime.

## 14. Sicurezza

- Nessuna chiave API nel frontend.
- CSP restrittiva.
- `Referrer-Policy: no-referrer`.
- `X-Content-Type-Options: nosniff`.
- Rate limit su endpoint costosi.
- Errori pubblici generici, dettagli solo in audit log server.
- Catalogo evidenze deterministico per impedire citazioni AI non riconducibili al payload.
- Budget AI riservato prima delle chiamate concorrenti.

## 15. Calibrazione e Storico

I numeri pubblicati usano una calibrazione strutturale: la distribuzione dei risultati esatti viene resa coerente con l'ensemble 1X2.

Dalla 1.7.0 ogni previsione pre-partita viene registrata e, a gara conclusa, confrontata con il risultato al 90'. Il tab **Performance** mostra Brier, log loss, RPS, accuratezza, diagramma di affidabilità ed ECE, confronto con le quote de-vig e con il modello uniforme, hit rate e ROI delle indicazioni, dettaglio per competizione. `Esporta CSV` scarica il registro completo per analisi esterne.

Il risultato viene cercato automaticamente all'apertura del tab (al massimo ogni 15 minuti). Per forzarlo:

```bash
curl -X POST -H "Authorization: Bearer $ADMIN_API_TOKEN" http://localhost:8080/api/performance/settle
```

Il motore non si ricalibra da solo: correggere pesi o curve richiede un campione ampio per competizione e una validazione fuori campione.

## 16. Uso Responsabile

Il sistema produce previsioni probabilistiche, non certezze. Quote, formazioni, infortuni e notizie possono cambiare rapidamente. La simulazione di scommessa serve a capire probabilità e valore atteso, non a promettere profitto.

## 17. Verifica Prima della Pubblicazione

Prima di passare in live:

1. esegui `npm test` e verifica 47 test superati;
2. controlla `/api/ready` con il provider configurato;
3. usa `AI_MODE=shadow` per validare output e costi senza modificare i numeri;
4. confronta fixture, orari, quote e formazioni con le fonti originali;
5. attiva `AI_MODE=active` soltanto dopo una revisione degli audit;
6. monta un volume persistente su `data/` per il registro previsioni;
7. per scalare su più istanze sostituisci cache, rate limit, ledger costi e registro JSONL con Redis/database condivisi;
8. non dichiarare accuratezza o calibrazione finché il tab Performance non ha uno storico live sufficiente (indicativamente alcune centinaia di partite).
