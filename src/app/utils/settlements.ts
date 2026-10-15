import { ME, SharedBill, Transaction } from '../models';
import { allocate } from './split/money';
import { billPositions } from './splits';

/** A share of something, by category. `categoryId` is '__none__' for no category. */
export interface CategoryPart {
  categoryId: string;
  cents: number;
}

/**
 * What a payment you sent to settle up actually paid for, by category.
 *
 * Paying Nikhilesh back for the trip is the cash behind your shares of the
 * bills other people paid: Dining, Gas, the cabin. Counted under its own
 * category it would be one big "Transfer" or "Venmo" line instead. So the
 * payment is weighted by your share of those bills, category by category:
 *   - in a group: every bill someone else paid in that group (whoever you
 *     paid, it settles the group as a whole);
 *   - outside one: the bills that person paid that you were on.
 *
 * Returns null when there's nothing to go on (no such bills, or no share of
 * yours in them): the payment then counts under its own category, as before.
 */
export function settlementCategories(tx: Transaction, sharedBills: SharedBill[]): CategoryPart[] | null {
  const s = tx.type === 'expense' ? tx.settlement : undefined;
  if (!s) return null;
  const bills = sharedBills.filter(b => s.groupId
    ? b.split.groupId === s.groupId
    : !b.split.groupId && b.split.payments.some(p => p.personId === s.personId && p.amountCents > 0));
  const byCat = new Map<string, number>();
  for (const b of bills) {
    const { summary, shares } = billPositions(b.split);
    const i = summary.perPerson.findIndex(p => p.personId === ME);
    const mine = i >= 0 ? shares[i] : 0;
    if (mine <= 0) continue;
    const key = b.categoryId || '__none__';
    byCat.set(key, (byCat.get(key) ?? 0) + mine);
  }
  const parts = [...byCat.entries()].map(([categoryId, cents]) => ({ categoryId, cents }));
  return parts.length ? parts : null;
}

/**
 * Divide `cents` over categories in proportion to `weights`, to the cent
 * (largest remainder, as everywhere money is divided). Biggest first.
 */
export function spreadOverCategories(cents: number, weights: CategoryPart[]): CategoryPart[] {
  const amounts = allocate(cents, weights.map(w => w.cents));
  return weights
    .map((w, i) => ({ categoryId: w.categoryId, cents: amounts[i] }))
    .filter(p => p.cents !== 0)
    .sort((a, b) => b.cents - a.cents);
}
