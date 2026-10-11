# Indicazione sull'esito più probabile e giocate più sicure — specifica di design

Data: 2026-10-11 · Autore app: Leone Francesco · Versione di destinazione: **2.1.0**

## 1. Problema

L'Indicazione mostrata in ogni analisi non è l'esito più probabile. `buildRecommendation` (`src/prediction/recommendation.js`) tiene solo i mercati con valore (edge ≥ 2,5% ed EV ≥ 3%) e sceglie quello con `valueScore` più alto, che dipende soprattutto dall'edge.

Esempio reale, Sassuolo–AC Milan dell'11/10/2026:

| Esito | Motore | Quota | Mercato senza margine | Edge |
|---|---|---|---|---|
| 1 · Sassuolo | 33,6% | 3,95 | 23,0% | +10,7% |
| X | 27,3% | 3,60 | 25,4% | +2,0% |
| 2 · AC Milan | **39,0%** | 1,83 | 51,7% | −12,6% |

Oggi l'app indica "1 · Vittoria casa 33%", anche se il motore ritiene più probabile il Milan.

**Misura sui dati reali:**
- Su 138 partite con quote, 104 Indicazioni sono sull'1X2; in **90** il segno indicato non è il più probabile.
- Sulle 16 partite reali concluse nello Storico:

| Scelta | Azzeccate |
|---|---|
| Indicazione attuale | 4/16 |
| Esito più probabile del motore | 6/16 |
| Esito più probabile del mercato | 7/16 |
| Doppia chance della favorita | 11/16 |
| Over 1.5 | 14/16 |

## 2. Obiettivo (parole e scelte dell'utente)

"Almeno per i segni 1X2 mi dovrebbe suggerire di giocare il Milan al 39%." L'utente vuole una soluzione ibrida:
- l'1X2 scegliendo l'esito più probabile;
- sotto, le giocate più sicure. Alla domanda se mostrarne una o entrambe ha risposto **"entrambe"**: la doppia chance (nel caso di specie X2) **e** l'Over 1.5.

**Criteri di successo:**
- Per Sassuolo–Milan l'Indicazione è "2 · AC Milan 39%". Sotto compaiono "X2 66%" e "Over 1.5 77%".
- In nessuna partita il segno 1X2 indicato è meno probabile di un altro segno 1X2.
- Lo Storico misura proprio quello che l'app mostra: il segno più probabile e le due giocate più sicure.

## 3. Regole

### 3.1 Segno 1X2 (Indicazione principale)
- Si sceglie l'esito 1X2 con la probabilità finale più alta del motore. Questa probabilità comprende già l'ensemble e le eventuali correzioni AI.
- A parità, l'ordine è 1, poi 2, poi X: una regola deterministica e documentata.
- `hasValue` vale `true` solo se **lo stesso segno scelto** ha valore (edge ≥ 0,025 ed EV ≥ 0,03, soglie invariate). Il valore su altri segni non cambia l'Indicazione e resta visibile nella tabella "Mercati e quote".
- Testo di stato:
  - con valore: "Esito più probabile, con margine statistico rispetto alla quota.";
  - senza valore: "Esito più probabile del modello; la quota non offre un vantaggio sufficiente.".
- Vale anche senza quote. In quel caso `hasValue = false` e la quota resta vuota.

### 3.2 Giocate più sicure (riga sotto, sempre entrambe)
1. **Doppia chance della favorita.**
   - Favorita in casa → `1X`; favorita in trasferta → `X2`.
   - Se è più probabile il pareggio, si sceglie tra `1X` e `X2` quella con la squadra più probabile, cioè `1X` se P(1) ≥ P(2).
   - Probabilità = somma dei due esiti del motore.
   - Quota: ESPN non la fornisce, quindi si mostra la **quota equa stimata** = 1 / probabilità di mercato senza margine della doppia chance (stesso metodo di de-vig, Shin), segnata come `estimated: true`. Senza quote 1X2 la quota resta vuota.
2. **Over 1.5.**
   - Probabilità del motore.
   - Quota solo se fornita (`odds.values.OVER_1_5`, oggi assente da ESPN), altrimenti vuota. Non viene mai stimata da altri mercati.

Formato del dato: `recommendation.safer = [{ key, label, probability, odd, estimated }]`, sempre in quest'ordine: doppia chance, poi Over 1.5.

## 4. Dove cambia

| Punto | Prima | Dopo |
|---|---|---|
| Scheda Indicazione | mercato con più edge | segno 1X2 più probabile + riga "Giocate più sicure" con due elementi |
| Chip "Valore rilevato" | valore su qualunque mercato | valore sul segno indicato |
| Badge "Valore" e filtro "Solo valore" dell'elenco | come sopra | come sopra (diventano più rari e coerenti) |
| Puntata consigliata (Kelly) | sul mercato con edge | sul segno indicato: senza valore mostra "Nessuna puntata consigliata" |
| Diario: mercato precompilato | quello con edge | il segno indicato (gli altri restano selezionabili) |
| Top del giorno | classifica le Indicazioni | invariata nella logica: ora classifica i segni più probabili con quota |
| Registro e Storico | valuta l'Indicazione | valuta il segno più probabile; **nuovo:** salva `prediction.safer` e mostra quante giocate più sicure sono andate a segno |
| Condividi | testo con l'Indicazione | aggiunge le due giocate più sicure |
| Agenti AI | titolo con l'Indicazione | invariato (usano la nuova Indicazione) |

I record dello Storico creati prima della 2.1.0 restano con la vecchia Indicazione. La sezione delle giocate più sicure conta solo i record che hanno `safer`.

## 5. Fuori ambito
- Correggere lo scostamento del modello dal mercato sulle sfavorite (causa dell'eccesso di "Valore"): resta un rilievo aperto, da affrontare con lo Storico come prova.
- Nuovi mercati con quote reali (ESPN non fornisce doppia chance né Over 1.5).

## 6. Test
- **Unitari su `buildRecommendation`:**
  - caso Sassuolo–Milan con i numeri reali → `key '2'`, `hasValue false`, `safer` = X2 (≈0,664, quota stimata ≈ 1/0,770) e OVER_1_5 (quota `null`);
  - pareggio favorito;
  - parità tra 1 e 2;
  - favorita con valore → `hasValue true`;
  - nessuna quota.
- **Proprietà su tutto lo snapshot reale:** il segno indicato non è mai meno probabile degli altri segni 1X2.
- **Registro:**
  - `prediction.safer` salvato;
  - metrica delle giocate più sicure con i valori attesi su record di prova;
  - record vecchi senza `safer` ignorati.
- **Interfaccia:** presenza della riga nella build; verifica nel simulatore iPhone sulla stessa partita (Sassuolo–Milan) o su una equivalente.
- Versione **2.1.0**, documentazione aggiornata, pubblicazione come nelle fasi precedenti.
