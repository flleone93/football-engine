// Campi di sola presentazione derivati da dati già calcolati: non modificano le probabilità.
import { LABELS } from './recommendation.js';
import { round } from '../utils.js';

export function formFromRecent(recent) {
  return (recent?.results || [])
    .map((item) => String(item).trim().charAt(0).toUpperCase())
    .filter((letter) => ['W', 'D', 'L'].includes(letter))
    .slice(0, 5);
}

export function scoreGridFromMatrix(matrix, size = 6) {
  const cells = Array.from({ length: size }, () => Array(size).fill(0));
  let other = 0;
  for (const { home, away, probability } of matrix) {
    if (home < size && away < size) cells[home][away] += probability;
    else other += probability;
  }
  return { size, cells: cells.map((row) => row.map((value) => round(value, 6))), other: round(other, 6) };
}

// Ordine esplicito: Object.keys mette prima le chiavi numeriche ('1', '2') e altererebbe 1-X-2.
const MARKET_ORDER = ['1', 'X', '2', '1X', 'X2', 'GOAL', 'NO_GOAL', 'OVER_1_5', 'UNDER_1_5', 'OVER_2_5', 'UNDER_2_5'];

export function oddsMovementFromOdds(odds) {
  if (!odds?.opening || !odds?.values) return null;
  const items = MARKET_ORDER
    .filter((key) => odds.opening[key] > 1 && odds.values[key] > 1)
    .map((key) => ({
      key,
      label: LABELS[key],
      open: odds.opening[key],
      current: odds.values[key],
      impliedChangePp: round((1 / odds.values[key] - 1 / odds.opening[key]) * 100, 2)
    }));
  return items.length ? { bookmaker: odds.bookmaker || null, items } : null;
}
