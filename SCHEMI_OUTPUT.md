# Schemi Output

## `/api/analyze`

Campi principali:

| Campo | Tipo | Descrizione |
|---|---|---|
| `generatedAt` | string | Timestamp analisi |
| `fixture` | object | Partita selezionata |
| `summary` | object | Favorita, 1X2, xG, confidenza, raccomandazione |
| `markets` | array | 1X2, doppia chance, Goal/No Goal, Over/Under |
| `exactScores` | array | Top risultati esatti |
| `simulation` | object | Monte Carlo |
| `progression` | object | Supplementari, rigori e qualificazione, se applicabili |
| `timeline` | object | Baseline temporale esplicitamente semplificata |
| `scenarios` | array | Base, pro casa, pro trasferta |
| `factors` | array | Fattori decisivi |
| `agents` | array | Modelli deterministici nell'ensemble |
| `workflow` | array | Stato moduli e agenti |
| `governance` | object | Qualità, consensus, rischi, audit |
| `context` | object | Indisponibili, formazioni, arbitro, fonti |
| `layers` | object | Separazione dati/modelli/AI/inferenze/finale |

`layers.qualitativeAssessments` include inoltre `provider` e `models`, così ogni output è riconducibile all'adapter e agli identificativi realmente usati.

`summary.outcomes` descrive esclusivamente l'esito al 90'. `progression.qualification` non viene prodotto come stima utilizzabile se il formato non è confermato o richiede il punteggio aggregato di un'altra gara.

Ogni elemento di `exactScores` contiene:

```json
{
  "rank": 1,
  "score": "1-1",
  "outcome": "X",
  "probability": 0.123,
  "contributionToOutcome": 0.446
}
```

`contributionToOutcome` indica quale quota della probabilità complessiva dell'esito 1/X/2 è rappresentata da quel punteggio.

## Layer Obbligatori

```json
{
  "layers": {
    "realData": {},
    "statisticalBaseline": {},
    "qualitativeAssessments": {},
    "unconfirmedInferences": [],
    "finalRecommendation": {}
  }
}
```

## Output Agente AI Qualitativo

```json
{
  "agentId": "player_availability_impact",
  "status": "completed",
  "summary": "Testo sintetico basato solo sui dati ricevuti.",
  "confidence": 0.72,
  "evidence": [
    {
      "source": "injury.home.0",
      "claim": "Un titolare risulta in verifica.",
      "reliability": "medium"
    }
  ],
  "effects": [
    {
      "target": "home_xg",
      "suggestedAdjustment": -0.04,
      "confidence": 0.69,
      "rationale": "Assenza potenzialmente centrale.",
      "evidenceIndex": [0]
    }
  ],
  "unsupportedClaims": [],
  "riskFlags": [],
  "needsRefresh": false
}
```

Valori `target` ammessi:

- `home_xg`;
- `away_xg`;
- `confidence`.

Solo `challenge_bias` può produrre effetti su `confidence`.

`source` deve essere un `evidenceId` presente in `evidenceCatalog`. Un output `insufficient_data` non puo contenere effetti. Gli indici fuori intervallo, le fonti sconosciute e i target non ammessi causano fallback deterministico.

## Output Final Explanation Agent

```json
{
  "agentId": "final_explanation",
  "status": "completed",
  "headline": "Indicazione principale probabilistica.",
  "executiveSummary": "Sintesi leggibile.",
  "modelExplanation": "Come la baseline e gli eventuali aggiustamenti sono stati combinati.",
  "riskSummary": "Principali rischi.",
  "finalRecommendation": "Raccomandazione finale non deterministica.",
  "unsupportedClaims": []
}
```

## `/api/top-picks`

Input:

```json
{
  "date": "2026-07-18",
  "limit": 5,
  "stake": 10
}
```

Output principale:

| Campo | Descrizione |
|---|---|
| `picks` | Top selezioni ordinate |
| `simulation.accumulator` | Simulazione multipla |
| `simulation.singles` | Simulazione singole |
| `coverage` | Partite disponibili, scansionate, escluse |
| `audit` | Criteri ranking e fallimenti |
| `ai` | Stato shortlist AI |

## `/api/performance`

| Campo | Descrizione |
|---|---|
| `ledger` | Previsioni registrate, partite tracciate, regolate, annullate, in attesa |
| `settlement` | Ultimo controllo risultati: orario, richieste, risultati acquisiti, errori |
| `evaluation.model` | `n`, `brier`, `logLoss`, `rps`, `accuracy` sull'1X2 al 90' |
| `evaluation.benchmarks.market` | Stesse metriche per le quote de-vig, `modelOnSameSample`, `brierSkillVsMarket`, `rpsSkillVsMarket` |
| `evaluation.benchmarks.uniform` | Riferimento 1/3; `brierSkillVsUniform` |
| `evaluation.calibration` | 10 bin `{from, to, n, meanPredicted, observedRate}` ed `expectedCalibrationError` |
| `evaluation.recommendations` | `all` e `valueOnly`: hit rate, probabilità media, Brier binario, `flatStake` (puntate, ritorno, profitto, ROI) |
| `evaluation.goalMarkets` | `OVER_2_5` e `GOAL`: prevista media, frequenza osservata, Brier |
| `evaluation.byCompetition` | Metriche per competizione |
| `recent` / `upcoming` | Ultime previsioni regolate e in attesa |
| `methodology` | Regole di registrazione, orizzonte, metriche, benchmark; nota demo se applicabile |

Evento registrato nel file JSONL (una riga per evento):

```json
{ "schemaVersion": 1, "type": "prediction", "record": { "id": "…", "predictedAt": "…", "fixture": { "id": 123, "kickoff": "…" }, "prediction": { "outcomes": {}, "marketOutcomes": {}, "markets": {}, "recommendation": {} } } }
{ "schemaVersion": 1, "type": "settlement", "fixtureId": "123", "result": { "status": "FT", "finished": true, "goals": { "home": 1, "away": 0 }, "outcome": "home" } }
```

## Snapshot Live (`dist/live-snapshot.json`)

| Campo | Descrizione |
|---|---|
| `generatedAt` | Momento dell'acquisizione dei dati reali |
| `source` / `bookmaker` | `ESPN` / `DraftKings via ESPN` |
| `leagues` | Competizioni scansionate |
| `fixtures` | Partite non iniziate con bundle completo |
| `bundles` | Bundle di analisi per `fixtureId` (`espn:<campionato>:<evento>`), con `sourceStatus` per ogni fonte |
| `ledgerEvents` | Eventi del registro previsioni live al momento dello snapshot |
| `errors` | Partite non acquisite e motivo |

`odds.opening` contiene le quote di apertura usate dal modulo Market Movement.

## Garanzie

- Le probabilità 1X2 sommano a 1.
- I mercati complementari sono normalizzati.
- Il risultato esatto è distribuzione, non certezza.
- Quote bookmaker usate come benchmark.
- AI non può inventare dati.
- AI non può pubblicare direttamente probabilità finali.
- L'H2H non supera il 7% effettivo dell'ensemble.
- Il cap xG totale usa la somma assoluta delle variazioni casa e trasferta.
- `governance.calibration.empiricallyBacktested` dichiara se esiste una calibrazione storica reale.
- `summary.uncertainty` espone entropia normalizzata e rischio che la favorita non vinca.
- `sourceStatus` prevale sui fallback vuoti: una sorgente fallita non è marcata come osservata.
- la decision trace AI mostra l'aggiustamento finale dopo tutti i cap e il fattore di scala globale.
- `rawRequested` conserva la proposta originale e `requested` il valore dopo l'eventuale deduplicazione dell'evidenza.
- `evidenceOverlap` e `evidenceScale` rendono verificabile la riduzione applicata a fonti già conteggiate.
- Il registro accetta solo previsioni calcolate prima del calcio d'inizio e valuta una sola previsione per partita.
- Le metriche post-partita usano il risultato al 90' (`score.fulltime`), coerente con l'1X2 pubblicato.
