/**
 * Something you own or owe that no bank connection reports — a home, a car,
 * a car loan, a 401(k) at a provider Plaid can't reach, money you lent a friend.
 *
 * Plain entries carry a list of dated valuations rather than one number, so
 * the net worth history can show what it was worth at the time instead of
 * back-filling today's value into every past month. Updating the value adds a
 * valuation; the latest one on or before a date is the value on that date.
 *
 * Loans carry their terms instead (see `LoanTerms`): the balance is worked out
 * from the amount, the rate and the payments that actually happened.
 */
export type ManualAssetType =
  // assets
  | 'property' | 'vehicle' | 'investment' | 'cash' | 'valuable' | 'loan-given' | 'other-asset'
  // liabilities
  | 'mortgage' | 'auto-loan' | 'student-loan' | 'personal-loan' | 'other-liability';

export interface Valuation {
  date: string;   // YYYY-MM-DD
  value: number;  // always positive; whether it adds or subtracts comes from the type
}

/**
 * How interest is charged.
 * - reducing: the standard EMI — interest each month on what is still owed.
 * - flat: interest on the original amount for the whole term, split evenly.
 * - none: an interest-free loan (family, friends).
 */
export type LoanMethod = 'reducing' | 'flat' | 'none';

export interface LoanTerms {
  /** For money lent: is it owed to you, or to someone else whose repayments reach you? */
  owedTo?: 'me' | 'someone-else';
  method: LoanMethod;
  /** The lender (for a loan you took) or the borrower (for money lent). */
  counterparty?: string;
  /** When the loan was taken out — the day the car was bought. */
  startDate: string;
  /** What it bought, before any down payment. Optional; informational. */
  price?: number;
  downPayment?: number;
  /** The amount borrowed or lent: price − down payment. */
  amountFinanced: number;
  /** Annual rate in percent (4.2 = 4.2%). Flat or reducing according to `method`. */
  rate: number;
  termMonths: number;
  firstPaymentDate: string;
  /**
   * When payments arrive.
   * - exact: on the due day (bank autopay) — missed after 5 days.
   * - flexible: around the due day, sometimes later — missed after `lateDays`.
   * - none: no set day, roughly monthly — never flagged as missed.
   * Absent means exact.
   */
  dueMode?: 'exact' | 'flexible' | 'none';
  /** For flexible: how many days late a payment can be before it counts as missed. */
  lateDays?: number;
  /** The monthly payment (EMI). Calculated, but editable to match the lender's figure. */
  payment: number;
  /** Payments are recognised automatically when the merchant or notes contain this. */
  match?: { text: string; accountId?: string };
  /** Transactions you linked by hand. */
  paymentIds: string[];
  /** Transactions that matched automatically but you said aren't payments. */
  ignoredIds: string[];
  /** The down payment you made (borrowed) or the money you sent out (lent). */
  downPaymentId?: string;
  /**
   * For a loan that began before Trackr could see it: every payment due up to
   * this date was made on schedule. Tracking from transactions starts after it.
   */
  settledThrough?: string;
  /** Balances you entered from a statement; each resets the running balance on its date. */
  corrections?: Valuation[];
}

export interface ManualAsset {
  id?: string;
  name: string;
  type: ManualAssetType;
  valuations: Valuation[];
  notes?: string;
  archived?: boolean;
  /** Present for loans (borrowed or lent). */
  loan?: LoanTerms;
  /** For things that lose value: what you paid and when. */
  purchase?: { price: number; date: string };
  /** Yearly loss of value as a fraction (0.15 = 15%/yr). 0 or absent = no estimate. */
  depreciationRate?: number;
  /** A loan and the thing it bought point at each other. */
  linkedId?: string;
  createdAt: number;
  updatedAt: number;
}
