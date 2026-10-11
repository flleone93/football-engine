# Pesi del modello decisi dai dati, banco di prova storico e chiusura dei rilievi minori — specifica di design

Data: 2026-10-11 · Autore app: Leone Francesco · Versione di destinazione: **2.2.0**

## 1. Obiettivo (parole e scelte dell'utente)

- **Problema principale:** "Segnale 'Valore' troppo frequente: si risolve correggendo il modello e misurando che il segnale diventa più selettivo."
  - Il modello sopravvaluta le sfavorite rispetto al mercato. Esempio: Sassuolo–Milan 34% contro il 23% del mercato.
  - Da quando c'è la 2.1.0 il "Valore" compare solo sul segno più probabile (10% delle partite), ma gli edge esagerati restano.
- **Problemi minori rimandati da chiudere:**
  - la linea del mercato nel grafico del Brier usa un campione diverso da quella del motore;
  - l'Elo ignora il campo neutro impostato a mano;
  - l'app non dice "Elo non disponibile".
- **Elo nelle probabilità** solo se le prove dimostrano che migliora le previsioni.
- **Scelte confermate:**
  - prova con un **banco di prova sullo storico ESPN** (risposta "A");
  - correzione con **pesi decisi dai dati** (approccio "1");
  - progetto in cinque parti approvato.

**Fatto verificato:** il riepilogo ESPN delle partite giocate conserva le quote DraftKings 1X2 (`pickcenter`). Per esempio la partita 401874776: casa +265, pareggio +205, trasferta +110.

## 2. Criteri di successo
- Sulla stagione di verifica il log loss 1X2 del motore con i nuovi pesi è **inferiore** a quello con i pesi attuali (25/15/25/18/10/7).
- Lo scostamento medio motore − mercato sulle sfavorite (esito con quota ≥ 3) si **riduce**.
- Il "Valore" diventa più raro oppure il suo rendimento a quota di chiusura migliora. In ogni caso i numeri vengono dichiarati, anche se sfavorevoli.
- I tre rilievi minori sono chiusi, con test.
- Il segno indicato resta sempre il più probabile: la regola della 2.1.0 non cambia.

## 3. Componenti

### 3.1 Archivio storico — `scripts/build-backtest-dataset.mjs`
- **Campionati:** i 15 di `ESPN_LEAGUES`.
- **Elenco partite:** per ogni campionato, `scoreboard?dates=<anno>&limit=1000` per gli anni 2025 e 2026. Si tengono le partite concluse (`status.type.completed`).
- **Stagioni:** la stagione di una partita è `season.year`.
  - **Addestramento:** la stagione con `season.year` = 2025 (per i campionati europei 2025-26, per quelli sull'anno solare il 2025).
  - **Verifica:** `season.year` = 2026.
- **Quote:** per ogni partita `summary?event=<id>` → `pickcenter[0]` (DraftKings), conversione americana → decimale con `americanToDecimal` già esistente per 1, X e 2. Si salvano anche linea e quote over/under se presenti.
- **Dati salvati per partita:** `{ id, slug, seasonYear, date, homeId, awayId, homeName, awayName, homeGoals, awayGoals, neutral, odds: { '1', X, '2' } | null }`.
  - I gol sono quelli al 90': parziali dei due tempi se disponibili, altrimenti il punteggio finale solo per le partite chiuse al 90' (stessa logica di `regulationGoals`).
- **Richieste:** al massimo 4 in parallelo, 3 tentativi sugli errori temporanei; una partita che fallisce viene saltata e contata.
- **Uscita:** `data/backtest/<slug>.json` (escluso da git, rigenerabile) e un riepilogo a schermo con partite, partite con quote ed errori.

### 3.2 Ricostruzione pre-partita — `src/backtest/historicalBundles.js` (puro, testato)
- `buildHistoricalBundles(matches)`: per ogni partita, in ordine di data, costruisce un bundle con la **stessa forma** di quello ESPN dal vivo, usando solo le partite precedenti della stessa stagione e dello stesso campionato:
  - `homeStats` / `awayStats`: `played`, `goalsForTotal` e `goalsAgainstTotal` (medie). Come dal vivo, i campi casa/trasferta restano `null`. Se una squadra non ha partite precedenti → `null`.
  - `recentHome` / `recentAway`: ultime 5 partite, con `matches`, `wins`, `draws`, `losses`, `ppg`, `goalsForAverage`, `goalsAgainstAverage`, `goalDifferenceAverage`, `restDays`, `results`.
  - `h2h`: scontri precedenti nella stessa stagione, nella forma di `headToHead`.
  - `odds`: `{ values: { '1', X, '2' } }`, oppure `null`.
  - `elo`: `eloForFixture` sulle partite precedenti, con il campo neutro della partita.
  - `fixture`: `{ id, kickoff, status: 'NS', home, away, league }`, più `sourceStatus` minimo.
- **Regola anti-futuro:** nessun dato della partita stessa né di partite successive entra nel suo bundle. È verificato da un test che altera il risultato e controlla che il bundle non cambi.
- **Differenze note col dal vivo:** la forma dal vivo include anche le coppe, qui solo il campionato; le quote dal vivo sono quelle attuali, qui quelle di chiusura. Vengono dichiarate nel report.

### 3.3 Fonti, Elo in 1X2 e media pesata — `src/prediction/engine.js`
- **Fonte Elo:** l'Elo diventa una fonte con probabilità 1X2 `eloOutcomes(expectedHome, drawBase)`:
  - pareggio = `drawBase × (1 − |2·E − 1|)^1,5`, limitato tra 0,12 e 0,34;
  - casa = E − pareggio / 2 e trasferta = 1 − E − pareggio / 2, poi normalizzati.
  - `drawBase` viene stimato sul banco di prova; valore iniziale 0,30.
- **Pesi esterni:** i pesi delle fonti escono dal codice e vengono da `src/prediction/ensembleWeights.js`, sovrascrivibili in `options.weights` per il banco di prova. Fonti: `poisson`, `montecarlo`, `market`, `form`, `provider`, `h2h`, `elo`.
- Una fonte con peso 0 continua a essere mostrata in "Modelli e pesi", ma con la dicitura "peso 0 (escluso dai dati)".
- `enforceSourceWeightCaps` per gli scontri diretti resta com'è.
- Il motore espone le probabilità di ogni fonte in `analysis.agents`, già presenti, dove il banco di prova le legge.

### 3.4 Banco di prova e stima dei pesi — `src/backtest/evaluate.js` e `scripts/run-backtest.mjs`
- **Raccolta:** per ogni bundle ricostruito si esegue `analyzeMatch` una volta (Monte Carlo a 2.000 simulazioni per velocità, irrilevante per le probabilità 1X2 medie) e si salvano le probabilità 1X2 di ogni fonte, il risultato e le quote.
- **Stima dei pesi:**
  - si minimizza il log loss medio della miscela sulle partite di **addestramento**;
  - pesi ≥ 0 con somma 1, sulle fonti disponibili;
  - quando una fonte manca in una partita, il peso si ridistribuisce come in `blendOutcomes`;
  - metodo: discesa a coordinate sul simplesso, passo iniziale 0,05 dimezzato fino a 0,001, partenza dai pesi uniformi; deterministica.
  - Anche `drawBase` dell'Elo viene scelto sull'addestramento, in una griglia da 0,22 a 0,34 con passo 0,01.
- **Verifica:** sulle partite di **verifica** si calcolano Brier, log loss, RPS e accuratezza per quattro configurazioni:
  1. pesi attuali;
  2. nuovi pesi senza Elo;
  3. nuovi pesi con Elo;
  4. solo mercato.
- **Regola per l'Elo:** entra nei pesi di produzione solo se la configurazione 3 ha un log loss inferiore alla 2 di almeno **0,002** sulla verifica. Altrimenti peso Elo = 0.
- **Regola per il "Valore"** (fissata prima di vedere i numeri):
  - sulla verifica, con i pesi di produzione, si misurano numero di segnali e ROI a puntata unitaria a quota di chiusura con le soglie attuali (edge ≥ 0,025 ed EV ≥ 0,03);
  - se il ROI è negativo **e** i segnali sono almeno 50, si alza la soglia di edge a passi di 0,01 fino a 0,10, fermandosi alla prima con ROI ≥ 0 e almeno 30 segnali;
  - se nessuna soglia lo soddisfa, si usa 0,10 e lo si dichiara;
  - altrimenti le soglie restano quelle attuali.
- **Uscita:**
  - `src/prediction/ensembleWeights.js` (versionato) con `{ version, generatedAt, trainSeason, testSeason, matches, weights, eloDrawBase, valueThresholds, metrics: { current, fitted, fittedWithElo, market } }`;
  - un report Markdown in `docs/backtest/2026-10-11-report.md`.
- **Soglie del "Valore" configurabili:** `buildRecommendation` legge `valueThresholds` (edge, EV) da `ensembleWeights.js`. I valori predefiniti attuali restano finché il banco di prova non li cambia.

### 3.5 Rilievi minori
- **Brier mobile:** in `timeline` la linea del motore usata per il confronto è calcolata sulle **stesse partite** della linea del mercato (`modelOnMarketBrier`). Il grafico mostra queste due linee, con la didascalia "stesse partite con quote".
- **Elo e campo neutro:** in `analyzeMatch`, se `bundle.elo` esiste, `expectedHome` viene ricalcolato con `eloExpectation(home.rating, away.rating, { neutral: options.neutral })`. La riga Elo e il fattore usano il valore ricalcolato.
- **Elo non disponibile:** quando `sourceStatus.elo.available === false` e `error` è presente, il dettaglio mostra "Elo non disponibile: <motivo>".

### 3.6 Storico e versione
- Il registro salva `prediction.modelVersion` (`ensembleWeights.version`).
- `evaluatePredictions` aggiunge `byModelVersion` con le metriche di ciascuna versione. Lo Storico mostra la card "Versione modello" con le metriche della versione corrente rispetto alle precedenti.
- `APP_VERSION` passa a **2.2.0**, `mathVersion` a 2.4.0.

## 4. Gestione degli errori
- Archivio incompleto (campionato senza quote o richieste fallite): il banco di prova usa ciò che c'è e il report dichiara le esclusioni.
- `ensembleWeights.js` assente o malformato: il motore usa i pesi attuali come predefiniti, segnalato in `governance`.
- Banco di prova con meno di 300 partite di verifica: niente pesi nuovi; il report lo dichiara e si chiede all'utente.

## 5. Fuori ambito
- Stima dei gol attesi (approccio "3"), nuove fonti di dati, quote over/under nel banco di prova (salvate ma non usate).

## 6. Test
- **Ricostruzione:** forma, statistiche e scontri diretti calcolati solo dal passato; test anti-futuro; squadra al debutto → `null`.
- **`eloOutcomes`:** somma 1, simmetria, pareggio massimo a E = 0,5.
- **Stima dei pesi:** su dati sintetici con una fonte "perfetta" la stima le assegna il peso maggiore; somma 1; determinismo.
- **Regole Elo e soglia "Valore":** casi sintetici per ciascun ramo.
- **Motore:** pesi da `options.weights` e da file; fonte a peso 0 mostrata come esclusa; il segno indicato è sempre il più probabile (test di proprietà esistente).
- **Rilievi minori:** timeline sullo stesso campione; Elo ricalcolato con campo neutro forzato; riga "Elo non disponibile".
- **Storico:** `modelVersion` salvato; `byModelVersion` calcolato.
- **Verifica finale:**
  - archivio reale scaricato e banco di prova eseguito;
  - numeri prima/dopo nell'AUDIT;
  - simulatore iPhone;
  - revisione indipendente;
  - pubblicazione.
