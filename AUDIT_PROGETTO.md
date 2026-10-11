# Audit Generale del Progetto

## Esito

Release verificata: `1.11.0`.

Il progetto è una base eseguibile e pubblicabile per un motore ibrido di previsione calcistica. Il percorso demo funziona senza credenziali; il percorso live mantiene le chiavi nel backend; i calcoli restano deterministici e gli agenti AI possono solo proporre correzioni limitate e tracciate.

"Perfetto" non viene usato come sinonimo di infallibile: un sistema predittivo dipende dalla qualità e tempestività delle fonti e deve essere validato nel tempo. Questa release è una production candidate trasparente, non una promessa di accuratezza o rendimento.

## Rilievi Chiusi

| Priorità | Rilievo | Correzione |
|---|---|---|
| Alta | Un fallback vuoto di infortuni, formazioni o quote poteva apparire come dato osservato | La snapshot pubblica rispetta `sourceStatus` e verifica il contenuto effettivo |
| Alta | Il refresh forzato del calendario live non arrivava alle richieste per singola data | L'opzione `force` viene propagata fino alla cache del provider |
| Alta | Il ledger bloccava il costo solo dopo il completamento delle chiamate | Il costo stimato viene ora riservato prima delle chiamate concorrenti |
| Alta | L'audit AI mostrava il cap locale ma non sempre la variazione finale dopo la scala globale | La decision trace distingue richiesta, cap locale, scala e valore finale applicato |
| Media | 1X2 e qualificazione non erano separati esplicitamente | Il frontend etichetta il 90' e usa `progression` solo con regole confermate |
| Media | Mancavano supplementari e rigori nel contratto operativo | Aggiunto modello deterministico per gara secca; stima sospesa per regole incerte o doppi confronti |
| Media | Il risultato esatto non indicava quanto contribuisse al relativo esito | Aggiunti `outcome` e `contributionToOutcome` |
| Media | Mancava una misura compatta dell'incertezza | Aggiunti entropia normalizzata e rischio di non-vittoria della favorita |
| Media | L'interfaccia non esponeva andamento temporale e decisione valore/no-valore | Aggiunte sezioni responsive, caveat e stato operativo della raccomandazione |
| Alta | Gli agenti qualitativi ricevevano un payload più ampio del necessario | Evidence pack separato per dominio e filtrato con `sourceStatus` |
| Media | La stessa evidenza poteva sostenere integralmente più aggiustamenti AI | Riduzione configurabile e tracciata degli effetti successivi duplicati |
| Alta | Il runtime AI era vincolato a OpenAI | Introdotto adapter Gemini/OpenAI con selezione server-side e chiavi separate |
| Alta | I nomi modello e il provider non entravano integralmente nella cache/audit | Provider e modelli effettivi sono inclusi in cache key, meta e trace |
| Alta | Lo schema condiviso contiene vincoli non supportati dal subset JSON Schema Gemini | Aggiunta conversione deterministica dello schema e validazione applicativa post-risposta |
| Alta | Interactions API conserva lo stato per impostazione predefinita | Ogni richiesta Gemini imposta esplicitamente `store=false` |

## Rilievi Chiusi nella 1.11.0 (Fase 2: valore e giocate)

- Puntata con Kelly frazionario (`src/prediction/staking.js`): funzione pura con valori di riferimento testati; ogni mercato con quota espone `kellyFraction`.
- Diario delle giocate (`src/tracking/betJournal.js`) append-only con storage iniettato; quota di chiusura e risultato non vengono copiati ma ricavati a ogni lettura dal registro previsioni, che ora salva tutte le quote (`prediction.odds`).
- CLV mai stimato: senza quota di chiusura resta vuoto; prima del calcio d'inizio è marcato provvisorio ed escluso dalla media.
- Giocate solo pre-partita su partite già registrate: evita giocate impossibili da regolare e CLV falsati.
- Limiti di perdita con avviso e nessun blocco; input con virgola decimale accettati, valori negativi rifiutati con messaggio chiaro.
- Verifica: 90 test automatici; prova nel browser a 390×844 (scuro) e 1024 px (chiaro) senza scorrimento orizzontale.

## Rilievi Chiusi nella 1.10.0 (Fase 0 + Fase 1)

Copertura misurata su 155 partite reali (prima) e su 60 partite dei 5 giorni successivi (dopo).

| Componente | Prima | Dopo | Intervento |
|---|---|---|---|
| Meteo e campo | 0% (nessuna fonte) | 98% | Open-Meteo, solo informativo |
| Notizie pertinenti | 28% | 98% | Notizie per squadra ESPN + filtro di pertinenza |
| Agente disponibilità giocatori | 1% | — | Unito a Lineups & Tactical Context (5 agenti) |
| Machine Learning | 0%, nessun modello | — | Eliminato |
| Aggiornamento bayesiano | dichiarato attivo, nessun codice | — | Eliminato |
| Arbitro, previsione esterna | "Escluso" | "Non disponibile" con motivo | Stato `unavailable_source` |

Difetti trovati durante la verifica e corretti con test: chiavi numeriche che alteravano l'ordine 1-X-2 del movimento quote; un velo scuro sempre visibile perché `display: grid` vinceva sull'attributo `hidden`; la mini barra larga 0 px; i preferiti che rompevano l'ordine per giorno.

Osservazione per la Fase 3: il motore segnala "valore" in circa 2 partite su 3. È lo stesso eccesso visto nello storico demo; il metodo di Shin e la verifica sullo storico reale servono a correggerlo.

## Aggiornamento 1.9.0: provider Anthropic Claude

| Priorità | Rilievo | Correzione |
|---|---|---|
| Alta | Nell'app iPhone gli agenti AI potevano usare solo Gemini o OpenAI | Adapter `anthropic` (Messages API, Claude Opus 5.5, output strutturato `json_schema`, fallback lato server sui rifiuti) selezionabile e consigliato nelle Impostazioni |
| Media | Schemi agente con vincoli non accettati dagli output strutturati Anthropic | Conversione deterministica dello schema; i vincoli restano verificati dal validatore backend |

Verifiche: 53 test superati, compresa una prova rosso-verde (adapter disattivato → 4 test su 5 falliscono). Nell'app in browser a 390×844 con chiave di prova: 4 richieste reali a `api.anthropic.com/v1/messages` con modello, intestazioni e formato attesi, risposta 401 leggibile (CORS consentito) e fallback al motore statistico. Non verificabile senza una chiave valida: la risposta effettiva del modello.

## Rilievi Chiusi nella 1.9.0

| Priorità | Rilievo | Correzione |
|---|---|---|
| Alta | Su iPhone l'intestazione occupava mezzo schermo e le schede si sovrapponevano ("PERFORMANCEIMPOSTAZIONI") | Barra superiore compatta; schede in una barra inferiore fissa con icone e margine per la barra home |
| Alta | Elenco partite e analisi impilati: il calendario iniziava a metà della seconda schermata | Navigazione elenco → dettaglio con tasto indietro; il tocco sulla scheda "Partite" riporta all'elenco |
| Media | Risultato dell'analisi troppo lungo e con tabelle larghe | Scheda Indicazione in evidenza, mercati come elenco con barre, sezioni secondarie richiudibili, tabelle scorrevoli |
| Media | Firma dell'autore assente | "Creata da Leone Francesco" in alto a destra, nella scheda Informazioni, nel piè di pagina e nei metadati |
| Media | La barra inferiore finiva in alto su Safari | Su telefono la barra superiore non usa `backdrop-filter`, che rendeva la barra superiore il riferimento degli elementi fissi |
| Bassa | Stampa non disponibile nelle web app a schermo intero | Pulsante nascosto in modalità app; export tramite foglio di condivisione iOS |

Verifiche: 48 test superati; interfaccia controllata a 390×844 (iPhone) e 1024 px senza scorrimento orizzontale; elenco, dettaglio, Top, Storico e Impostazioni provati con dati reali ESPN.

## Rilievi Chiusi nella 1.8.0

| Priorità | Rilievo | Correzione |
|---|---|---|
| Alta | Senza chiave API-Football l'app funzionava solo con dati fittizi | Provider `espn` pubblico senza chiave: calendario, classifiche, forma, scontri diretti, notizie, quote DraftKings con apertura/attuale e risultati al 90' |
| Alta | Nessun modo di usare il motore dentro claude.ai | Build `npm run build:live`: snapshot reale + motore completo in un Artifact; agenti AI eseguiti da Claude via capability `sample`, export via `downloads` |
| Alta | Agenti AI disponibili solo con chiavi Gemini/OpenAI | Terzo adapter `claude` con stessi schemi, validazione, cap e ledger; fallback deterministico su rifiuto o assenza del runtime |
| Media | Market Movement sempre escluso | Attivo quando la fonte fornisce le quote di apertura; solo informativo, non altera le probabilità |
| Media | Storico reale assente | Registro `data/live-predictions.jsonl` alimentato a ogni snapshot e regolato con i risultati ESPN |
| Media | Identificativi con punto rifiutati (`espn:uefa.europa.conf:…`) | Validatore `fixtureId` esteso al carattere `.` |
| Bassa | Nomi di file e cartelle non coerenti tra versioni | Cartella `Enterprise Football Prediction Engine v1.9.0`, file versionati, release precedenti in `archivio/` |

## Verifica sui Dati Reali (10/10/2026)

- 155 partite reali in 15 competizioni acquisite senza errori; analisi deterministica completa su tutte.
- Esempio Como–AS Roma (Serie A): qualità dati 74/100; esclusi correttamente indisponibili, formazioni, previsione esterna e arbitro; movimento quote reale (X 3,35→3,45).
- Top Picks di domenica 11/10: 50 partite analizzate, 4 idonee ai quality gate su 5 richieste, nessun riempimento artificiale.
- Lo storico reale parte da questo snapshot: nessuna metrica di accuratezza reale è ancora disponibile.

## Rilievi Chiusi nella 1.7.0

| Priorità | Rilievo | Correzione |
|---|---|---|
| Alta | Nessuno storico delle previsioni: impossibile misurare accuratezza e calibrazione reali | Registro append-only JSONL con una previsione ufficiale per partita (ultima pre-partita) e acquisizione automatica del risultato al 90' |
| Alta | Rischio di look-ahead nella valutazione | Registrate solo analisi calcolate prima del calcio d'inizio e con stato `NS`/`TBD`; risultato da `score.fulltime` (esclusi supplementari e rigori) |
| Alta | Dopo un aggiornamento il browser poteva combinare HTML nuovo con JS/CSS vecchi (cache 1 ora) | Asset statici serviti con `ETag` e `Cache-Control: no-cache` (risposta 304 se invariati) |
| Media | Mancava una dashboard Brier/log loss/RPS e un confronto con il mercato | Tab Performance con benchmark mercato de-vig e uniforme, diagramma di affidabilità, ECE, ROI indicazioni, metriche per competizione |
| Media | Report non esportabili | Export JSON dell'analisi, stampa/PDF con foglio di stile dedicato, export CSV del registro con protezione da formule |
| Media | Storico demo e storico live potevano mescolarsi | In demo il registro è sempre in memoria; il file JSONL è usato solo in modalità live |
| Bassa | File di anteprima obsoleto `app/enterprise-football-engine-demo.html` (luglio) | Rimosso: la demo aggiornata è generata in `dist/` e copiata nella cartella principale |

## Evidenza dello Storico Dimostrativo

Sulle 60 partite fittizie della demo il motore ottiene Brier 0,585 contro 0,569 del mercato de-vig e 0,667 del modello uniforme (ECE 4,2%). Le indicazioni marcate "con valore" sono 50 su 60, con ROI simulato negativo. Il dato non riguarda partite reali, ma mostra che lo strumento rende visibili anche i risultati sfavorevoli: la soglia del segnale "valore" (edge ≥ 2,5 punti ed EV ≥ 3%) va validata sullo storico live prima di essere usata come criterio operativo.

## Controlli Eseguiti

- 47 test automatici superati (7 nuovi nella 1.8.0 su provider Claude, quote ESPN, snapshot e `DATA_PROVIDER`);
- demo standalone rigenerata e verificata nel browser, desktop e mobile (375 px) senza overflow orizzontale;
- chiamate Gemini e OpenAI verificate con mock su endpoint, header e JSON Schema;
- probabilità 1X2 normalizzate;
- mercati complementari coerenti;
- matrice score coerente con l'ensemble;
- probabilità di qualificazione normalizzate;
- rigori non superiori alla probabilità di supplementari;
- una sola selezione per partita nelle Top Picks;
- quality gate senza riempimento artificiale;
- guardrail AI cumulativi e globali;
- budget AI concorrente per chiamate, token e costi;
- nessun segreto esposto dal frontend;
- sintassi JavaScript verificata su sorgenti, frontend e test.

## Architettura Verificata

1. Il provider acquisisce dati e conserva stato/errori delle fonti.
2. Il motore deterministico produce xG, score matrix, 1X2, mercati, Monte Carlo e ranking.
3. Gli agenti AI ricevono un evidence pack delimitato e restituiscono JSON strutturato.
4. Il backend valida evidenze, confidenza, target e cap.
5. Il challenge può ridurre la confidenza, non inventare numeri.
6. Il frontend mantiene separati dati, modello, AI, inferenze e raccomandazione.

## Limiti Residui Dichiarati

| Area | Stato attuale | Passo necessario per scala enterprise |
|---|---|---|
| Calibrazione | Strutturale sui numeri; misurata empiricamente nel tab Performance | Con almeno alcune centinaia di partite per lega: isotonic/Platt e monitoraggio drift |
| Cache e rate limit | Memoria del processo | Redis condiviso per deploy multiistanza |
| Audit persistente | Log runtime e risposta JSON | Database append-only con retention e controllo accessi |
| Regolamenti live | Dipendono dal payload/provider | Fonte dedicata e versionata per competizione/turno |
| News e meteo | Solo se realmente forniti | Provider dedicati con licenze, timestamp e affidabilità |
| Player markets | Non pubblicati senza dati granulari | Feed minuti, xG/xA giocatore, probabili formazioni e modello validato |
| Tornei completi | Non incluso nel runtime corrente | Motore bracket/gruppi e almeno 50.000 simulazioni con regole ufficiali |
| Post-match learning | Registro, risultati e metriche attivi; nessun aggiornamento automatico dei pesi | Aggiornamento pesi controllato e versionato solo dopo validazione fuori campione |
| Registro previsioni | File JSONL su singola istanza | Database append-only condiviso per deploy multiistanza |

## Criteri di Accettazione Live

La pubblicazione con dati reali è consigliata soltanto se:

- `/api/ready` conferma il provider;
- fixture, fuso orario e quote sono confrontati con la fonte originale;
- le fonti fallite restano visibilmente mancanti;
- l'AI viene prima validata in `shadow`;
- i prezzi token configurati corrispondono al modello scelto;
- i quality gate Top Picks sono coerenti con la politica del prodotto;
- disclaimer, limiti di età e requisiti normativi sono revisionati per il paese di pubblicazione.

## Comandi di Verifica

```bash
npm install
npm test
node --check src/server.js
node --check public/app.js
npm start
```

Poi controllare:

```text
GET  /api/health
GET  /api/ready
GET  /api/meta
POST /api/analyze
POST /api/top-picks
GET  /api/usage
GET  /api/performance
GET  /api/performance/records
```
