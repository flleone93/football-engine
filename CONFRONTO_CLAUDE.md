# Confronto Tecnico con la Variante Claude v1.2

## Metodo

Il pacchetto `enterprise-football-engine-v1.2_1.zip` è stato estratto in un'area separata, verificato con la propria suite di 20 test e confrontato file per file con la release 1.4.0 del progetto principale.

La variante non è stata sovrascritta sul progetto: è una linea architetturale precedente con provider AI Anthropic, frontend alternativo e un diverso modello di evidence ingestion.

## Elementi Validi Integrati

| Idea Claude | Valutazione | Integrazione nella release 1.6 |
|---|---|---|
| Payload diversi per agente | Riduce token, rumore e superficie di prompt injection | Evidence pack realmente filtrato per Player, Tactical, News e Competition |
| Deduplicazione delle evidenze | Evita di contare più volte la stessa notizia | Scala configurabile `AI_DUPLICATE_EVIDENCE_SCALE`, decision trace completa |
| Prompt di dominio espliciti | Migliora l'indipendenza logica | Mantenuti e rafforzati con catalogo evidenze vincolante |
| Test di shadow/fallback | Buona copertura concettuale | Conservati i nostri fallback e aggiunti test su isolamento e deduplicazione |

## Elementi Non Importati

| Elemento Claude | Motivo |
|---|---|
| Textarea pubblica per incollare evidenze | Un utente anonimo potrebbe influenzare l'analisi con claim e fonti non verificati; richiede un flusso operatore autenticato |
| Passaggio esclusivo ad Anthropic | Ridurrebbe la portabilità attuale e richiederebbe una seconda implementazione completa di schema, usage e costi |
| Sostituzione integrale del frontend | La variante perde skip link, tab semantiche, alcuni audit, qualificazione e sezioni introdotte nella v1.4 |
| Server v1.2 | Mancano diversi header, rate limit, request ID, readiness, error redaction e protezione dell'endpoint usage |
| Budget AI v1.2 | La verifica prima delle chiamate concorrenti non riserva in modo atomico token e costo stimato |
| Oggetti fallback come dati | Non usa la correzione `sourceStatus` introdotta nel progetto principale |

## Differenze di Copertura

La suite Claude supera 20 test, concentrati su client Anthropic, schemi e modalità shadow/live. La suite principale 1.6 supera 27 test e copre inoltre provider Gemini/OpenAI, validazione JSON backend, provenienza, concorrenza del budget, quality gate, qualificazione, risultati esatti e isolamento dei payload. Il numero dei test non è usato come metrica assoluta: conta la copertura dei rischi effettivi.

## Decisione Finale

La release 1.6 mantiene la base più robusta del progetto principale, incorpora minimizzazione per agente e controllo del doppio conteggio delle evidenze, e aggiunge provider Gemini/OpenAI intercambiabili. L'inserimento manuale di fonti resta escluso dall'interfaccia pubblica finché non esisterà un workflow operatore autenticato con verifica e approvazione.
