# Ottimizzazione completa dell'app — specifica di design

Data: 2026-10-10 · Autore app: Leone Francesco · Stato: in revisione

## 1. Obiettivo condiviso

**Richiesta (parole dell'utente):** ottimizzare al massimo grafica e funzioni dell'app iPhone, prendendo spunti da progetti simili; riparare i sotto-agenti inutilizzati o non funzionanti, oppure eliminarli se non hanno senso. Ordine scelto: **tutto, in fasi** (D), con l'**approccio 1** (fasi incrementali sul codice esistente, ognuna testata, verificata e pubblicata).

**Vincoli confermati:**
- App personale, gratuita, senza server: tutto gira sul telefono (PWA su GitHub Pages).
- Dati gratuiti ESPN; fonti aggiuntive solo gratuite, senza chiave e utilizzabili dal browser (CORS aperto).
- La firma "Creata da Leone Francesco" resta in alto a destra.
- Previsioni oneste: probabilità, mai certezze; nessuna funzione che prometta profitto.
- Le stesse modifiche valgono per server Node, file offline e Artifact, perché condividono `public/` e `src/`.

**Criteri di successo:**
- Ogni componente mostrato nell'app lavora davvero oppure dichiara perché non può, senza moduli decorativi.
- Su iPhone (390×844) ogni schermata si usa con una mano: nessuno scorrimento orizzontale, tocchi da almeno 44 px.
- Ogni fase si chiude con: test automatici verdi, prova nel browser a misura di iPhone e su desktop, pubblicazione, verifica dell'app online.

**Fuori ambito (limiti della piattaforma):** notifiche push, aggiornamento in background, widget, Live Activities.

## 2. Spunti dai progetti simili

| Fonte | Spunto adottato | Fase |
|---|---|---|
| Forebet | Probabilità e valore visibili nell'elenco, ordinamento per valore | 1 |
| FotMob / Sofascore | Preferiti, forma a pallini, dettaglio partita visivo | 1 |
| FiveThirtyEight | Barra 1X2 leggibile, grafici chiari | 1 |
| Sharp (Dixon-Coles open source) | Puntata con Kelly frazionario | 2 |
| Bet Journal / Bankroll OS | Diario giocate con CLV e limiti di perdita | 2 |
| penaltyblog | Metodo di Shin per togliere il margine; rating Elo | 3 |

## 3. Architettura generale

Resta l'architettura attuale: provider → motore deterministico → agenti AI con limiti → API condivisa (`src/api.js`) → interfaccia (`public/`). Per ogni fase:
- logica pura e testabile in moduli `src/` dedicati (`staking.js`, `betJournal.js`, `weather.js`, `elo.js`);
- preferenze dell'utente salvate nel browser (`localStorage`) e dati storici in IndexedDB sull'iPhone, con lo stesso schema "storage iniettato" del registro previsioni;
- nuove fonti (Open-Meteo) dietro un'interfaccia provider con stato della fonte (`sourceStatus`), così un errore non blocca mai l'analisi;
- versioni: Fase 0+1 → **1.10.0**, Fase 2 → **1.11.0**, Fase 3 → **2.0.0**. Le cartelle e i file della cartella principale si rinominano solo a v2.0.0.

## 4. Fase 0 — Pulizia di agenti e moduli

Misurato sulle 155 partite reali dello snapshot del 10/10/2026.

| Componente | Oggi | Decisione | Dettaglio |
|---|---|---|---|
| Meteo e campo | 0%, nessuna fonte | **Riparare** | Nuovo `src/providers/weather.js` (Open-Meteo, gratuito, CORS aperto): dal campo `venue` si ricava la città (ultimo segmento dopo la virgola), poi geocoding con cache di 7 giorni e previsione oraria all'ora del calcio d'inizio se mancano al massimo 16 giorni. Restituisce `{temperatureC, precipitationMm, precipitationProbability, windKmh, retrievedAt, source: 'Open-Meteo'}` oppure `null` con `sourceStatus.weather`. Solo informativo: **non** modifica le probabilità, perché un effetto non validato produrrebbe falsa precisione. Mostrato nell'analisi e incluso nell'evidence pack dell'agente tattico. |
| Machine Learning | 0%, nessun modello | **Eliminare** | Rimosso dal workflow e dalla documentazione. |
| Aggiornamento bayesiano | dichiarato attivo, nessun codice | **Eliminare** | Rimosso: il lavoro reale lo svolge "Ensemble dei modelli". |
| Agente AI disponibilità giocatori | 1% (ESPN non fornisce infortuni; 3 indirizzi verificati vuoti) | **Unire all'agente tattico** | Nuovo agente unico `tactical_context` con etichetta "Formazioni e tattica". Riceve formazioni e indisponibili quando presenti, oltre a forma, statistiche e meteo. Il limite di aggiustamento xG passa a `AI_MAX_TACTICAL_XG_DELTA` predefinito **0,10**; `AI_MAX_PLAYER_XG_DELTA` viene ignorato e documentato come obsoleto. Agenti totali: **5**; `AI_MAX_CALLS_PER_ANALYSIS` va da 1 a 5, predefinito 5. |
| Agente AI notizie | 28% | **Potenziare** | Il provider ESPN aggiunge le notizie della singola squadra se l'endpoint risponde (da verificare all'inizio dell'implementazione), con fallback alle notizie di campionato filtrate. Obiettivo: più copertura, senza notizie non pertinenti. |
| Arbitro, Previsione esterna | 0% con ESPN, funzionanti con API-Football | **Tenere, etichettare** | Nel workflow lo stato diventa `unavailable_source` con testo "Non fornito dalla fonte gratuita" al posto di "Escluso". |

**Compatibilità:** le analisi salvate con l'agente `player_availability_impact` restano leggibili, perché l'interfaccia mostra qualsiasi `agentId`. I test che lo citano vengono aggiornati.

## 5. Fase 1 — Grafica e partite (v1.10.0)

1. **Previsioni rapide nell'elenco.**
   - Nuovo endpoint `POST /api/quick-predictions {fixtureIds: string[≤12]}` che restituisce per ogni partita `{outcomes, recommendation: {label, probability, hasValue, edge}, confidence}`. Usa `analyzeFixture(..., {useAi: false})`, già in cache, e registra la previsione nel registro come oggi.
   - L'interfaccia le chiede solo per le partite visibili, a lotti di 12 con al massimo 2 richieste in parallelo, e le conserva per la sessione.
   - Ogni scheda mostra una mini barra 1X2 e il badge "Valore" quando `hasValue`.
2. **Ordinamento e filtri.**
   - Selettore: Orario (predefinito) · Valore (edge decrescente) · Probabilità dell'indicazione.
   - Filtri rapidi: Tutte · Preferiti · Solo valore.
3. **Preferiti.**
   - Stella su squadre e campionati, nella scheda partita e nell'intestazione dell'analisi.
   - Salvati nel browser (`football-engine-favorites-v1`); le partite preferite compaiono in cima e si filtrano con un tocco.
4. **Forma e classifica.**
   - Il motore espone in `analysis.context` i campi `form: {home: string[], away: string[]}` (es. `['W','D','L']`) e `standings: {home: {rank, points, played}, away}` dai dati già presenti nel bundle.
   - L'interfaccia mostra pallini colorati (V verde, P grigio, S rosso) e la posizione in classifica.
5. **Mappa dei risultati esatti.**
   - Il motore espone `analysis.scoreGrid`: matrice 6×6 (0–5 gol) di probabilità calibrate più la quota residua "altro".
   - L'interfaccia mostra una griglia a colori, con intensità impostata via CSSOM e quindi compatibile con la CSP, e la percentuale nella cella.
   - La tabella dei 10 risultati resta disponibile come alternativa accessibile.
6. **Movimento quote.**
   - `analysis.governance.oddsMovement = {bookmaker, items: [{key, label, open, current, impliedChangePp}]}` quando la fonte fornisce le quote di apertura.
   - L'interfaccia mostra apertura → attuale con frecce e variazione in punti percentuali.
7. **Meteo** (dalla Fase 0): riga sintetica nella scheda partita (temperatura, pioggia, vento).
8. **Caricamento:** anteprime grigie (skeleton) per elenco e analisi al posto dello spinner.
9. **Tema.**
   - Token per tema scuro e chiaro; segue `prefers-color-scheme`.
   - Nelle Impostazioni la scelta Automatico / Chiaro / Scuro, salvata nel browser e applicata con `data-theme`.
10. **Primo avvio** (solo app iPhone):
    - foglio con 3 schede: cosa fa l'app, come attivare Claude, come installarla;
    - se non è in modalità app, istruzioni per "Aggiungi alla schermata Home".
    - Non riappare una volta chiuso.
11. **Promemoria:** "Aggiungi al Calendario" genera un file `.ics` (inizio al calcio d'inizio, durata 2 ore, avviso 30 minuti prima) tramite il foglio di condivisione o il download.
12. **Condivisione:** "Condividi" invia un testo sintetico (partita, indicazione, probabilità, quota, link all'app) con `navigator.share`, oppure copia negli appunti.

## 6. Fase 2 — Valore e giocate (v1.11.0)

1. **Puntata consigliata.**
   - `src/prediction/staking.js` con la funzione pura `kellyFraction(probability, odd)`, uguale a `max(0, (p·o − 1)/(o − 1))`.
   - L'API aggiunge `kellyFraction` a ogni mercato con quota.
   - Nell'interfaccia: puntata = bankroll × frazione di Kelly (predefinita 1/4) × Kelly, con un tetto (predefinito 2% del bankroll), arrotondata a 0,50 €.
   - Senza valore atteso positivo mostra "Nessuna puntata consigliata".
   - Impostazioni: bankroll (predefinito vuoto: in quel caso la puntata è mostrata in % del bankroll), frazione 1/8 · 1/4 · 1/2, tetto massimo.
2. **Diario delle giocate.**
   - `src/tracking/betJournal.js`, logica pura con storage iniettato (IndexedDB su iPhone, memoria negli altri casi, JSONL sul server). Giocata: `{id, fixtureId, match, marketKey, label, oddTaken, stake, placedAt, closingOdd?, result?, profit?}`.
   - Endpoint: `GET /api/journal`, `POST /api/journal` (aggiungi), `POST /api/journal/delete`.
   - Regolazione automatica con il risultato al 90' già usato dal registro (`settleMarket`).
3. **CLV (Closing Line Value).**
   - Il registro previsioni salva da ora tutte le quote del mercato in ogni previsione (`prediction.odds`).
   - La quota di chiusura di una giocata è la quota di quel mercato nell'ultima previsione registrata prima del calcio d'inizio. Il tracciamento automatico ogni 6 ore e le analisi aperte aggiornano questo dato.
   - CLV = quota presa / quota di chiusura − 1. Senza quota di chiusura il CLV resta vuoto, mai stimato.
4. **Limiti di spesa:**
   - limite di perdita giornaliero e settimanale nelle Impostazioni;
   - un avviso evidente nell'app al superamento;
   - nessun blocco: decide l'utente.
5. **Interfaccia.**
   - Sulla scheda Indicazione: "Aggiungi al diario", con quota e puntata precompilate e modificabili.
   - Nel tab Storico una nuova sezione "Le mie giocate" con profitto, ROI, CLV medio, percentuale vinte ed elenco giocate.
   - L'export CSV include il diario.

## 7. Fase 3 — Precisione (v2.0.0)

1. **Metodo di Shin.**
   - In `probability.js` la funzione `devigShin(odds)`: risolve il parametro z con bisezione, tolleranza 1e-10, massimo 100 iterazioni.
   - Configurazione `DEVIG_METHOD=shin|proportional`, predefinito `shin`. Si usa per il benchmark di mercato nell'ensemble, per l'edge e per il registro.
   - Se l'algoritmo non converge si torna al metodo proporzionale, e la scelta viene tracciata nella governance.
2. **Grafici dello Storico.**
   - `metrics.js` aggiunge `timeline(records, window = 50)`: Brier mobile e ROI cumulato a puntata unitaria, in ordine di calcio d'inizio.
   - L'interfaccia li mostra come due grafici SVG con assi in scala e un riferimento per il mercato.
3. **Rating Elo.**
   - All'inizio della fase un test di fattibilità verifica che l'endpoint ESPN del calendario di squadra fornisca i risultati della stagione: circa 20 richieste per campionato, in cache 12 ore.
   - Se sì: `src/prediction/elo.js` con Elo calcolato su tutte le partite della stagione (K=20, vantaggio casa 60 punti, rating iniziale 1500), mostrato nell'analisi e tra i fattori.
   - L'Elo **non** entra nell'ensemble finché lo Storico non dimostra che migliora il Brier.
   - Se l'endpoint non fornisce i dati, l'Elo viene escluso e lo dichiaro nel resoconto della fase.

## 8. Gestione degli errori

- Ogni nuova fonte (Open-Meteo, notizie di squadra, calendari Elo) fallisce in modo isolato: `sourceStatus` riporta l'errore, l'analisi prosegue e l'interfaccia mostra "non disponibile".
- Le previsioni rapide fallite lasciano la scheda senza barra: nessun errore bloccante e nessun nuovo tentativo in loop.
- Archiviazione del browser non disponibile (navigazione privata): preferiti, diario e impostazioni restano solo per la sessione, con un avviso nelle Impostazioni.
- Kelly e CLV non producono mai numeri con dati mancanti: mostrano "—".

## 9. Test e verifica (per ogni fase)

- **Test unitari:** meteo con fetch simulato (città, ora, assenza dati); unione degli agenti con schema e limite; previsioni rapide; formattazione di `scoreGrid`, `form` e `oddsMovement`; Kelly con valori di riferimento; diario e CLV; Shin con proprietà verificabili (somma 1, quota più alta → probabilità più bassa, margine zero → uguale al proporzionale); timeline; Elo con risultati noti.
- **Prova rosso-verde** su ogni nuova funzione chiave.
- **Browser:** 390×844 e 1024 px, temi chiaro e scuro, assenza di scorrimento orizzontale, nessun errore in console.
- **Pubblicazione** su GitHub Pages e verifica dei file online (versione, presenza del codice) con la skill `verification-before-completion`.
- La documentazione (README, guide, audit) viene aggiornata a ogni fase.

## 10. Operatività

- Ogni pubblicazione richiede l'accesso GitHub: propongo di **tenerlo attivo per tutta l'esecuzione** e di chiuderlo alla fine di Fase 3, invece di ripetere il login a ogni fase.
- Esecuzione con `superpowers:writing-plans` (piano dettagliato), poi esecuzione fase per fase con TDD e `verification-before-completion`; revisione del codice a fine fase con `superpowers:requesting-code-review`.
