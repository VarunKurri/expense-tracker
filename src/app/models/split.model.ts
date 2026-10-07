import type { Charges, Item, Payment } from '../utils/split/types';

/**
 * Bill splitting. The arithmetic is Split's engine (`utils/split/`), unchanged;
 * these are the shapes Trackr stores around it. Interfaces only.
 */

/** The reserved person id for you, the owner of the account. */
export const ME = 'me';

/**
 * Someone you split bills with. Saved once (encrypted, `people` collection) so
 * the same Alex is recognised across every bill — that's what makes "Alex owes
 * you $85 across three dinners" possible.
 */
export interface SplitPerson {
  id?: string;
  name: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * How a bill is shared, attached to the expense transaction that paid for it.
 *
 * Money is integer cents throughout, as in Split. The transaction's own
 * `amount` stays in dollars like every other transaction; it must equal your
 * entry in `payments`.
 *
 * The bill total is never stored: it is always `calculateSplit()`'s
 * subtotal + tax + tip, so it can't drift from the items.
 */
export interface TransactionSplit {
  /**
   * `quick`    — one line for the whole bill ("$180, four ways").
   * `itemized` — individual items, tax and tip (usually from a receipt).
   * Both are ordinary `items` underneath; the mode only picks the editor.
   */
  mode: 'quick' | 'itemized';
  /** Who shares the cost. Leave `ME` out when you paid for others entirely. */
  participantIds: string[];
  items: Item[];
  charges: Charges;
  /** Who paid the merchant. Yours equals the transaction amount. */
  payments: Payment[];
  /** People marked "won't be repaid": still in your spending, no longer "owed to you". */
  closedPersonIds?: string[];
  source: 'manual' | 'receipt';
}

export type { Charges, Item, Payment };
