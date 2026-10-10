# Architettura AI Ibrida

## Principio

L'AI non calcola probabilità finali. Il motore statistico produce baseline e raccomandazione. Gli agenti AI leggono solo i dati ricevuti, producono JSON validato e propongono piccoli aggiustamenti motivati. Il backend decide se applicarli.

## Moduli Deterministici

| Modulo | Responsabilità |
|---|---|
| Data Acquisition | Provider live/demo, fixture, statistiche, quote |
| Entity Resolution | Identificativi fixture, squadre, leghe |
| Data Quality | Completezza, fonti mancanti, errori |
| Feature Engineering | Forma, xG proxy, home/away, riposo |
| Poisson/Dixon-Coles | Matrice risultati esatti |
| Monte Carlo | Simulazione stocastica riproducibile |
| Market Odds | De-vig quote e benchmark |
| Ensemble | Combinazione modelli disponibili |
| Calibration | Coerenza matrice/ensemble; calibrazione empirica dichiarata separatamente |
| Top Picks | Ranking e simulazione scommessa |
| Governance/Audit | Timestamp, pesi, rischi, fonti |

## Agenti AI

| Agent ID | Nome | Output ammesso |
|---|---|---|
| `player_availability_impact` | Player Availability & Impact Agent | Effetti xG limitati su assenze/formazioni |
| `tactical_context` | Tactical Context Agent | Effetti xG limitati da matchup e ritmo |
| `news_intelligence` | News Intelligence Agent | Effetti xG molto limitati da news verificate |
| `competition_context` | Competition Context Agent | Effetti xG limitati da formato/motivazioni |
| `challenge_bias` | Challenge & Bias Detection Agent | Penalità di confidenza, non xG |
| `final_explanation` | Final Explanation Agent | Testo strutturato, nessun numero inventato |

## Modalità AI

| Modalità | Comportamento |
|---|---|
| `off` | Solo motore deterministico |
| `shadow` | Agenti eseguiti, effetti non applicati |
| `active` | Effetti applicati entro cap backend |

## Policy di Aggiustamento

Limiti principali:

- `AI_MAX_PLAYER_XG_DELTA`
- `AI_MAX_TACTICAL_XG_DELTA`
- `AI_MAX_NEWS_XG_DELTA`
- `AI_MAX_COMPETITION_XG_DELTA`
- `AI_MAX_TOTAL_XG_DELTA`
- `AI_MAX_PROBABILITY_SHIFT_PP`
- `AI_MIN_EFFECT_CONFIDENCE`
- `AI_DUPLICATE_EVIDENCE_SCALE`

Processo:

1. Baseline deterministica.
2. Costruzione evidence pack.
3. Chiamata agenti qualitativi.
4. Validazione JSON e riferimenti al catalogo evidenze.
5. Scarto effetti sotto soglia confidenza.
6. Cap cumulativo per agente.
7. Cap sulla somma assoluta delle variazioni xG.
8. Riduzione degli effetti successivi che riutilizzano la stessa evidenza.
9. Ricalcolo probabilità.
10. Guardrail su shift 1X2.
11. Challenge Agent.
12. Penalità confidenza, se motivata.
13. Final Explanation.
14. Audit.

## Evidence Pack

Ogni agente riceve soltanto il sottoinsieme pertinente:

- Player: fixture, lineups, indisponibili, forma e statistiche di squadra;
- Tactical: fixture, forma e statistiche di squadra;
- News: fixture e sole notizie presenti;
- Competition: fixture, regolamento e recupero recente;
- Challenge/Explanation: vista completa necessaria alla revisione finale.

Il backend aggiunge un `evidenceCatalog`. `evidence.source` deve coincidere con un `evidenceId` del catalogo e ogni effetto deve puntare a un indice di evidenza valido. Testo di news e provider viene trattato come contenuto non attendibile, mai come istruzione.

Non riceve chiavi API, log sensibili o dati non necessari.

`sourceStatus` prevale anche nella costruzione dell'evidence pack: un oggetto fallback non entra nel prompt se la richiesta upstream è fallita.

## Cache

La cache analisi usa:

```text
fixtureId + dataVersion + neutral + aiMode + provider + modelli + limiti
```

La cache agente usa:

```text
agentId + provider + model + evidencePackHash + promptHash
```

Questo evita chiamate ripetute quando i dati non sono cambiati.

Il budget giornaliero di chiamate, token e costo stimato viene riservato prima delle chiamate concorrenti. I token cached sono sottratti dall'input ordinario nel calcolo costi, evitando il doppio conteggio.

## Provider e Modelli Predefiniti

| Provider | Qualitativi | Challenge | Spiegazione |
|---|---|---|---|
| Gemini | `gemini-2.5-flash-lite` | `gemini-2.5-flash` | `gemini-2.5-flash-lite` |
| OpenAI | `gpt-5.6-luna` | `gpt-5.6-terra` | `gpt-5.6-luna` |
| Claude (Artifact) | tier `default` | tier `default` | tier `default` |

Il provider si seleziona con `AI_PROVIDER=gemini|openai|claude`. Gli identificativi restano configurabili via ambiente. `AI_MAX_CALLS_PER_ANALYSIS` è applicato realmente anche con esecuzione concorrente.

## Fallback

Se un agente fallisce:

- lo stato diventa `error`;
- l'errore viene tracciato nel ledger;
- il motore deterministico resta valido;
- nessun aggiustamento viene applicato da quell'agente.

Se manca la chiave del provider selezionato (o, per Claude, il runtime Artifact):

- `effectiveMode` diventa `off_missing_key`;
- il frontend lo mostra come AI off.

## Tracciabilità

Ogni analisi espone:

- `dataVersion`;
- `layers.realData`;
- `layers.statisticalBaseline`;
- `layers.qualitativeAssessments`;
- `layers.unconfirmedInferences`;
- `layers.finalRecommendation`;
- `governance`;
- `workflow`.

La decision trace registra separatamente aggiustamento richiesto, cap per agente, fattore di scala globale e aggiustamento finale realmente applicato. Un fallback vuoto di un provider non viene classificato come dato osservato se `sourceStatus` dichiara la sorgente indisponibile.

## Fasi a Eliminazione Diretta

Il motore mantiene separati:

- `summary.outcomes`: 1X2 al termine dei 90 minuti;
- `progression.extraTime`: probabilità di supplementari;
- `progression.penalties`: probabilità di arrivare ai rigori;
- `progression.qualification`: probabilità di qualificazione.

Queste stime vengono pubblicate solo per gara secca con regolamento confermato. Per doppi confronti o regole mancanti l'output dichiara `applicable: false`, evitando inferenze non supportate.

## API dei Provider

- Google Gemini usa Interactions API, `x-goog-api-key`, `store=false` e `response_format` con JSON Schema. Il backend rimuove automaticamente le keyword non incluse nel subset Gemini prima dell'invio.
- OpenAI usa Responses API, autenticazione Bearer e Structured Outputs con JSON Schema strict.
- Claude usa la capability `sample` del runtime Artifact claude.ai: il prompt include istruzioni dell'agente, JSON Schema e dati marcati come non attendibili; la risposta JSON passa dalla stessa validazione applicativa. Nessuna chiave, consenso richiesto a chi visualizza.

Il factory `src/ai/structuredClient.js` seleziona l'adapter. Gli schemi, la validazione applicativa, il ledger e i guardrail sono condivisi. Riferimenti: [Gemini Structured Outputs](https://ai.google.dev/gemini-api/docs/structured-output), [OpenAI Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs).
