import type { TransactionSplit } from './split.model';

/**
 * Groups (a trip, a flat, a weekend away) and the bills someone else paid.
 * The maths is utils/groups.ts. Interfaces only.
 *
 * A group works like a Splitwise group: everyone's balance is worked out over
 * the whole group, not bill by bill, and "Simplify debts" turns those balances
 * into the fewest payments. A bill belongs to a group through its split's
 * `groupId`, whether you paid it (an expense transaction) or a friend did (a
 * `SharedBill`).
 */
export interface Group {
  id?: string;
  name: string;
  /** Who's in it, by person id. You're always in it, so `ME` is never stored. */
  memberIds: string[];
  /** YYYY-MM-DD, optional: when the trip ran. */
  startDate?: string;
  endDate?: string;
  /**
   * On: suggest the fewest payments overall, even "Alex pays Ben" when Alex
   * owed you and you owed Ben. Off: everyone pays back whoever paid each bill.
   */
  simplify: boolean;
  /**
   * Payments between two other members ("Alex paid Ben $30"). Payments to or
   * from you live on your own transactions instead (see `Settlement` and
   * money back), so the bank transaction stays the one record of them.
   */
  payments: GroupPayment[];
  /** Settled and put away: hidden from the Shared page's list. */
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface GroupPayment {
  id: string;
  fromPersonId: string;
  toPersonId: string;
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  note?: string;
}

/**
 * A bill someone else paid: "Ben paid $200 for the tents, split four ways".
 * Not a transaction, because no money left your accounts. Your share only
 * becomes spending when you pay them back (a settle-up expense).
 *
 * `split.payments` says who paid; `split.groupId` says which group, if any.
 */
export interface SharedBill {
  id?: string;
  /** YYYY-MM-DD */
  date: string;
  merchant: string;
  categoryId?: string;
  notes?: string;
  /** A receipt photo, as on an expense (ReceiptService). */
  receiptId?: string;
  split: TransactionSplit;
  createdAt: number;
  updatedAt: number;
}

/**
 * On an expense: money you sent a friend to settle up ("Paid Ben · Tahoe
 * Trip"). It counts as spending, because it's the cash that covers your share
 * of what they paid.
 */
export interface Settlement {
  personId: string;
  groupId?: string;
}
