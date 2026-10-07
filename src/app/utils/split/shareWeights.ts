// Ported verbatim from VarunKurri/split-the-bill src/domain/shareWeights.ts @ cc6a8db.
// Keep it in sync by copying, not by editing: Split's invariants (integer cents,
// allocate() for every division, reconciliation) are what make it trustworthy.

/**
 * Restate decimal weights as the smallest equivalent whole-number ratio.
 * Rounding each weight relative to the smallest one changes the split:
 * 50:30:20 must become 5:3:2, not 3:2:1. Zero claims stay zero.
 *
 * Decimal digits and BigInt keep scaling exact, including for legacy weights
 * written in scientific notation. Return null if the reduced ratio cannot be
 * represented safely by the bill's number fields; never approximate it silently.
 */
export function wholeShareWeights(weights: number[]): number[] | null {
  if (weights.some((weight) => !Number.isFinite(weight) || weight < 0)) return null;
  const parts = weights.map((weight) => {
    const [mantissa, exponent = '0'] = String(weight).split('e');
    const [whole, fraction = ''] = mantissa.split('.');
    return {
      digits: BigInt(whole + fraction),
      places: fraction.length - Number(exponent),
    };
  });
  const places = parts.reduce((max, part) => Math.max(max, part.places), 0);
  const integers = parts.map((part) => part.digits * 10n ** BigInt(places - part.places));
  const divisor = integers.reduce(gcd, 0n);
  if (divisor === 0n) return weights.map(() => 0);
  const reduced = integers.map((weight) => weight / divisor);
  return reduced.some((weight) => weight > BigInt(Number.MAX_SAFE_INTEGER))
    ? null
    : reduced.map(Number);
}

function gcd(a: bigint, b: bigint): bigint {
  while (b !== 0n) {
    [a, b] = [b, a % b];
  }
  return a;
}
