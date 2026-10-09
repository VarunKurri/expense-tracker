/**
 * Money that comes back on an expense: the one concept behind refunds,
 * reimbursements and split repayments.
 *
 * - `refund`:    the merchant gave money back (part or all of the purchase).
 * - `repayment`: a person paid you back, possibly on behalf of others
 *                ("Alex sent $180 for Alex, Ben and Cara").
 *
 * Interfaces only; the maths lives in `utils/money-back.ts` and `utils/splits.ts`.
 */
export type MoneyBackSource = 'refund' | 'repayment';

/**
 * One piece of money back, in the normalised shape the maths works on,
 * whether it came from a linked income transaction (tracked) or was recorded
 * by hand (cash, store credit: untracked).
 */
export interface MoneyBackEntry {
  source: MoneyBackSource;
  /** Integer cents, always positive. */
  amountCents: number;
  /** YYYY-MM-DD */
  date: string;
  /** Repayments only: who handed the money over. */
  fromPersonId?: string;
  /**
   * Repayments only: whose shares this settles, in the order they are paid
   * off. Defaults to `[fromPersonId]`, the common "Ben paid me back" case.
   */
  coversPersonIds?: string[];
}

/**
 * Money back recorded by hand: cash, store credit, anything that never hit an
 * account Trackr tracks. Stored on the expense itself (`Transaction.moneyBack`).
 */
export interface UntrackedReturn extends MoneyBackEntry {
  id: string;
  note?: string;
}

/**
 * On an income linked to an expense (`reimbursesId`): what kind of money back
 * it is. Absent on links made before refunds and repayments were merged;
 * those were always repayments ("a friend paid me back").
 */
export interface MoneyBackInfo {
  source: MoneyBackSource;
  fromPersonId?: string;
  coversPersonIds?: string[];
}
