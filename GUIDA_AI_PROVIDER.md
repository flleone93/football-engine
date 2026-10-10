# Guida AI: Claude, Gemini e OpenAI

Release `1.9.0`.

Il progetto supporta un solo provider AI attivo alla volta, selezionato con `AI_PROVIDER`:

| Provider | Dove funziona | Chiave | Modelli |
|---|---|---|---|
| `anthropic` **(consigliato)** | App iPhone, server Node / Render | `ANTHROPIC_API_KEY` (sull'iPhone: Impostazioni) | Claude Opus 5.5 per tutti gli agenti |
| `gemini` | Server Node / Render | `GEMINI_API_KEY` lato server | Flash-Lite agenti, Flash challenge |
| `openai` | Server Node / Render | `OPENAI_API_KEY` lato server | configurabili |
| `claude` | Artifact claude.ai | Nessuna: capability `sample` del runtime Artifact | tier `default` della piattaforma |

Nessuna chiave viene mai inviata al browser. Prompt, evidence pack, JSON Schema, validazione e guardrail sono identici per i tre provider.

## Anthropic Claude con chiave (consigliato)

1. Apri https://console.anthropic.com → **API Keys** → **Create Key** e imposta un limite di spesa nell'organizzazione.
2. iPhone: app → **Impostazioni** → Provider **Anthropic Claude (consigliato)** → incolla la chiave → **Salva**. Server: `AI_PROVIDER=anthropic` e `ANTHROPIC_API_KEY=sk-ant-...`.
3. Ogni agente chiama `POST https://api.anthropic.com/v1/messages` con modello `claude-opus-5-5`, thinking adattivo, `output_config.effort` da `AI_REASONING_EFFORT` (default `low`) e `output_config.format` di tipo `json_schema`: la risposta è JSON garantito conforme allo schema dell'agente. I vincoli che l'API non accetta nello schema (minimi, massimi, lunghezze) sono rimossi prima dell'invio e verificati dal backend dopo la risposta.
4. `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): se i controlli di sicurezza rifiutano una richiesta, Anthropic la riesegue sul modello consigliato. Un rifiuto o una risposta troncata diventano errori tracciati (`anthropic_refusal`, `anthropic_max_tokens`) con fallback al motore statistico.
5. Sull'iPhone la chiamata parte direttamente dal telefono (intestazione `anthropic-dangerous-direct-browser-access`): la chiave resta sul dispositivo e non passa da nessun server intermedio. Stima costi nell'app: 4 $ / 20 $ per milione di token in ingresso/uscita, limite interno 3 $ al giorno.

## Claude nell'Artifact

L'Artifact generato da `npm run build:live` (`dist/artifact/football-engine-live.html`) imposta `AI_PROVIDER=claude` e `AI_MODE=active`. A ogni "Avvia analisi enterprise":

1. il motore calcola la baseline statistica;
2. Player Availability, Tactical Context, News Intelligence e Competition Context ricevono il proprio evidence pack (massimo 2 in parallelo); gli agenti senza dati utili restano `insufficient_data` senza chiamare Claude;
3. il backend nel browser valida schema, evidence ID e indici, applica cap e deduplicazione;
4. Challenge & Bias Detection e Final Explanation completano l'analisi.

Il primo utilizzo mostra la richiesta di consenso di Claude; le chiamate usano l'account di chi visualizza. Un'analisi con tutti gli agenti richiede in genere da 30 secondi a 2 minuti. Se il consenso viene negato o Claude non è disponibile, ogni agente risulta `error` con codice `claude_<motivo>` e restano i numeri deterministici. Le Top Picks dell'Artifact usano solo il ranking deterministico, per non lanciare decine di chiamate.

Aperto come file locale (`Football Engine v1.9.0 - Live offline.html`) il runtime Claude non esiste: l'AI risulta off.

## Server: Scelta Consigliata

Per iniziare con costi contenuti:

```env
AI_MODE=active
AI_PROVIDER=gemini
GEMINI_API_KEY=...
GEMINI_MODEL_DEFAULT=gemini-2.5-flash-lite
GEMINI_MODEL_CHALLENGE=gemini-2.5-flash
GEMINI_MODEL_EXPLANATION=gemini-2.5-flash-lite
```

Gemini 2.5 Flash-Lite viene usato per agenti ripetitivi e spiegazione; Flash viene riservato al challenge. Sono identificativi stabili e supportano output strutturati.

## Creare la Chiave Gemini

1. Apri [Google AI Studio - API Keys](https://aistudio.google.com/app/apikey).
2. Crea o seleziona un progetto dedicato al Football Engine.
3. Premi `Create API key`.
4. Copia la chiave una sola volta.
5. Inseriscila in `.env` locale o tra i Secret Environment Variables di Render:

```env
GEMINI_API_KEY=la_chiave_reale
```

Non inserirla in `public/app.js`, `index.html`, GitHub o screenshot. La documentazione ufficiale sulla gestione chiavi è [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key).

## Usare OpenAI al Posto di Gemini

1. Crea un progetto dedicato nella [OpenAI Platform](https://platform.openai.com/).
2. Crea una API key di progetto.
3. Imposta un budget nel progetto.
4. Configura:

```env
AI_MODE=active
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL_DEFAULT=gpt-5.6-luna
OPENAI_MODEL_CHALLENGE=gpt-5.6-terra
OPENAI_MODEL_EXPLANATION=gpt-5.6-luna
```

OpenAI raccomanda di conservare la chiave in variabili d'ambiente o in un secret manager server-side: [API authentication](https://developers.openai.com/api/reference/overview/) e [production best practices](https://developers.openai.com/api/docs/guides/production-best-practices).

## Modalità

| Valore | Effetto |
|---|---|
| `AI_MODE=off` | Nessuna chiamata AI |
| `AI_MODE=shadow` | Agenti eseguiti; numeri finali invariati |
| `AI_MODE=active` | Aggiustamenti applicati entro i cap backend |

Anche in `active`, il modello non scrive direttamente le probabilità finali. Restano applicati:

```env
AI_MIN_EFFECT_CONFIDENCE=0.55
AI_MAX_TOTAL_XG_DELTA=0.20
AI_MAX_PROBABILITY_SHIFT_PP=5
AI_MAX_CHALLENGE_CONFIDENCE_PENALTY=8
```

## Budget Iniziale Consigliato

```env
AI_DAILY_CALL_LIMIT=100
AI_DAILY_TOKEN_LIMIT=250000
AI_DAILY_COST_LIMIT_USD=3
AI_MAX_CALLS_PER_ANALYSIS=6
AI_MAX_CONCURRENCY=2
TOP_PICKS_AI_ENABLED=true
TOP_PICKS_AI_SHORTLIST_MULTIPLIER=1
```

Il ledger usa i prezzi configurati per stimare il costo. Per Gemini include i thought token nell'output fatturabile. Poiché il profilo usa più modelli, conviene inserire il prezzo del modello più costoso come limite prudenziale.

Profilo prudenziale Gemini incluso nel progetto:

```env
AI_INPUT_COST_PER_MILLION=0.30
AI_CACHED_INPUT_COST_PER_MILLION=0.03
AI_OUTPUT_COST_PER_MILLION=2.50
```

Se si seleziona OpenAI, aggiornare questi tre valori in base ai modelli scelti e al [listino OpenAI corrente](https://openai.com/api/pricing/).

## Verifica

Avvia l'app e controlla:

```text
GET /api/ready
GET /api/meta
GET /api/usage
```

In `/api/meta` devono apparire:

```json
{
  "ai": {
    "provider": "gemini",
    "configuredMode": "active",
    "effectiveMode": "active",
    "models": {
      "default": "gemini-2.5-flash-lite",
      "challenge": "gemini-2.5-flash",
      "explanation": "gemini-2.5-flash-lite"
    }
  }
}
```

Se `effectiveMode` è `off_missing_key`, la chiave del provider selezionato non è presente nel processo. Riavviare il servizio dopo aver salvato i secret.

## Render

Il `render.yaml` è predisposto per Gemini attivo. Durante la creazione del Blueprint inserire:

```env
API_FOOTBALL_KEY=...
GEMINI_API_KEY=...
ADMIN_API_TOKEN=una_stringa_casuale_lunga
```

Per passare a OpenAI nel pannello Render:

```env
AI_PROVIDER=openai
OPENAI_API_KEY=sk-...
OPENAI_MODEL_DEFAULT=gpt-5.6-luna
OPENAI_MODEL_CHALLENGE=gpt-5.6-terra
OPENAI_MODEL_EXPLANATION=gpt-5.6-luna
```

Non lasciare variabili generiche `AI_MODEL_DEFAULT`, `AI_MODEL_CHALLENGE` o `AI_MODEL_EXPLANATION` con valori Gemini quando si passa a OpenAI, perché hanno precedenza sui valori specifici del provider.

## Fallback

Timeout, errore HTTP, JSON non valido, schema non valido, claim senza evidenza o budget superato causano il fallback deterministico. La baseline statistica continua a essere restituita e l'errore AI viene registrato nel ledger senza mostrare la chiave.
