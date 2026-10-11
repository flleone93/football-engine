// Puntata consigliata con criterio di Kelly frazionario. Funzioni pure, nessuna dipendenza.
// La puntata è un'indicazione di gestione del rischio, non una promessa di profitto.

/** Frazione di Kelly piena: max(0, (p·o − 1)/(o − 1)). null se probabilità o quota non sono utilizzabili. */
export function kellyFraction(probability, odd) {
  const p = Number(probability);
  const o = Number(odd);
  if (odd == null || probability == null || !Number.isFinite(p) || !Number.isFinite(o) || p < 0 || p > 1 || o <= 1) return null;
  return Math.max(0, (p * o - 1) / (o - 1));
}

const round6 = (value) => Math.round(value * 1e6) / 1e6;

/**
 * Puntata = bankroll × moltiplicatore × Kelly, con tetto in % del bankroll, arrotondata a 0,50 €.
 * Senza bankroll restituisce solo la frazione (la UI la mostra in % del bankroll).
 */
export function recommendedStake({ probability, odd, settings }) {
  // Arrotondato a 6 decimali: (1,2 − 1)/1 in virgola mobile vale 0,19999999999999996.
  const raw = kellyFraction(probability, odd);
  if (raw == null) return { kellyFraction: null, fraction: null, stake: null, hasStake: false };
  const kelly = round6(raw);
  const fraction = round6(Math.min(kelly * settings.kellyMultiplier, settings.maxStakePct));
  if (!(settings.bankroll > 0)) return { kellyFraction: kelly, fraction, stake: null, hasStake: fraction > 0 };
  const stake = Math.round(settings.bankroll * fraction * 2) / 2;
  return { kellyFraction: kelly, fraction, stake, hasStake: stake > 0 };
}
