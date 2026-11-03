import { parseCents } from './split/money';

/**
 * The bridge between Trackr's stored amounts (dollars, e.g. `12.34`) and
 * integer cents, which is what money maths should run on.
 *
 * Why not just `Math.round(dollars * 100)`? Because floats can't hold most
 * decimals exactly: `1.005 * 100` is `100.49999999999999`, which rounds to 100
 * rather than 101. Reading the number's decimal digits (the same approach as
 * Split's `parseCents`) gets it right.
 *
 * Stored amounts stay in dollars (converting every encrypted document isn't
 * worth the risk), so convert at the edge with `toCents`, do the arithmetic in
 * whole cents, and convert back once with `fromCents` for display.
 */
export function toCents(dollars: number): number {
  // A corrupt amount shouldn't take a whole page of totals down with it.
  if (!Number.isFinite(dollars)) return 0;
  const sign = dollars < 0 ? -1 : 1;
  const magnitude = Math.abs(dollars);
  // String() can produce scientific notation for very small or very large
  // values ("1e-7"); parseCents rejects that, so fall back to plain rounding,
  // which is exact enough at those extremes.
  const cents = parseCents(String(magnitude)) ?? Math.round(magnitude * 100);
  return sign * cents + 0; // `+ 0` turns -0 into 0
}

/** Integer cents back to dollars, for display and for the existing dollar APIs. */
export function fromCents(cents: number): number {
  return cents / 100;
}

/** Sum dollar amounts exactly, returning integer cents. */
export function sumCents(dollars: number[]): number {
  return dollars.reduce((total, value) => total + toCents(value), 0);
}
