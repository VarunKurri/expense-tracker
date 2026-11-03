// Ported verbatim from VarunKurri/split-the-bill src/domain/settle.ts @ cc6a8db.
// Keep it in sync by copying, not by editing: Split's invariants (integer cents,
// allocate() for every division, reconciliation) are what make it trustworthy.

import type { ID, Transfer } from './types';

export interface NetPosition {
  personId: ID;
  /** `paid - owed`. Positive is owed money back, negative still owes. */
  netCents: number;
}

/**
 * Turn net positions into "A pays B" instructions.
 *
 * Greedy largest-creditor-against-largest-debtor. It is not guaranteed to find
 * the theoretical minimum number of transfers (that problem is NP-hard), but
 * it never needs more than `n - 1`, and at a dinner table the difference
 * between optimal and near-optimal is one extra Venmo at most. Being able to
 * explain the result matters more than shaving a transfer off it.
 *
 * Two properties the tests pin down:
 *
 * 1. **No money is invented.** Every cent that leaves a debtor arrives at a
 *    creditor, so the transfers always net to zero.
 * 2. **Nobody is asked to overpay.** A person's outgoing transfers never
 *    exceed what they actually owe.
 *
 * When payments don't cover the bill the positions won't sum to zero. Rather
 * than fabricate a transfer to balance the books, the leftover is simply left
 * on the debtors' side and reported as unpaid. The restaurant is still owed
 * that money, and no amount of shuffling between friends changes it.
 */
export function settle(positions: NetPosition[]): Transfer[] {
  // Sorted by size, then by id so the plan is stable across renders rather
  // than reshuffling every time React re-renders the summary.
  const bySize = (a: NetPosition, b: NetPosition) =>
    b.netCents - a.netCents || (a.personId < b.personId ? -1 : 1);

  const creditors = positions
    .filter((p) => p.netCents > 0)
    .map((p) => ({ ...p }))
    .sort(bySize);

  const debtors = positions
    .filter((p) => p.netCents < 0)
    .map((p) => ({ personId: p.personId, netCents: -p.netCents }))
    .sort(bySize);

  const transfers: Transfer[] = [];
  let d = 0;
  let c = 0;

  while (d < debtors.length && c < creditors.length) {
    const amountCents = Math.min(debtors[d].netCents, creditors[c].netCents);

    transfers.push({
      fromPersonId: debtors[d].personId,
      toPersonId: creditors[c].personId,
      amountCents,
    });

    debtors[d].netCents -= amountCents;
    creditors[c].netCents -= amountCents;

    // `amountCents` is the smaller of the two, so at least one side is now
    // zero and the loop always advances.
    if (debtors[d].netCents === 0) d += 1;
    if (creditors[c].netCents === 0) c += 1;
  }

  return transfers;
}
