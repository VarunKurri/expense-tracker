// Ported verbatim from VarunKurri/split-the-bill src/domain/types.ts @ cc6a8db.
// Keep it in sync by copying, not by editing: Split's invariants (integer cents,
// allocate() for every division, reconciliation) are what make it trustworthy.

export type ID = string;

/** 1-8, indexes into the person palette in tokens.css. Wraps for 9+ people. */
export type ColorIndex = number;

export interface Person {
  id: ID;
  name: string;
  colorIndex: ColorIndex;
}

/**
 * One person's claim on an item, weighted.
 *
 * Weights let a shared plate be split unevenly without a second concept:
 * two people splitting evenly are `[1, 1]`; someone who had two thirds of it
 * is `[2, 1]`. Equal weights collapse to the ordinary "shared" case.
 */
export interface Assignment {
  personId: ID;
  weight: number;
}

/**
 * How an item's weights were arrived at.
 *
 * This is an editing affordance, not a second allocation model: every mode
 * resolves to the same weight vector, so `allocate()` stays the only place
 * money is ever divided.
 *
 * - `equal`   — every weight is 1.
 * - `shares`  — whole numbers. "He had two thirds" is `[2, 1]`.
 * - `percent` — percentages, which are weights that add up to 100.
 * - `amount`  — exact cents per person, which are weights that add up to the
 *   item's price. The only mode where the weights carry a unit.
 */
export type SplitMode = 'equal' | 'shares' | 'percent' | 'amount';

export interface Item {
  id: ID;
  name: string;
  /** Line total in integer cents — never a float. */
  priceCents: number;
  splitMode: SplitMode;
  assignments: Assignment[];
}

/**
 * Money someone actually handed over — one card at the end, or four people
 * chipping in. Separate from what they owe: the gap between the two is the
 * whole point of settling up.
 */
export interface Payment {
  personId: ID;
  amountCents: number;
}

/** One "A pays B" instruction in the settle-up plan. */
export interface Transfer {
  fromPersonId: ID;
  toPersonId: ID;
  amountCents: number;
}

export type ChargeMode = 'percent' | 'amount';

/** Whether tip is calculated on the subtotal alone or on subtotal + tax. */
export type TipBasis = 'preTax' | 'postTax';

export interface Charges {
  taxMode: ChargeMode;
  taxPercent: number;
  taxCents: number;
  tipMode: ChargeMode;
  tipPercent: number;
  tipCents: number;
  tipBasis: TipBasis;
}

export interface Bill {
  name: string;
  createdAt: string;
  people: Person[];
  items: Item[];
  charges: Charges;
  payments: Payment[];
  settledPersonIds: ID[];
}

/* ------------------------------------------------------------------ */
/* Derived — produced by the split engine, never stored               */
/* ------------------------------------------------------------------ */

export interface PersonLine {
  itemId: ID;
  itemName: string;
  /** This person's weight over the item's total weight, e.g. "1/3". */
  shareLabel: string;
  amountCents: number;
}

export interface PersonBreakdown {
  personId: ID;
  lines: PersonLine[];
  subtotalCents: number;
  taxCents: number;
  tipCents: number;
  /**
   * Cents gained or lost versus the exact (fractional) share, caused by
   * allocating whole cents. Surfaced in the UI rather than hidden, so the
   * totals always reconcile visibly.
   */
  roundingCents: number;
  totalCents: number;
  /** What this person actually paid towards the bill. */
  paidCents: number;
  /**
   * `paid - owed`. Positive means the group owes them money back; negative
   * means they still owe. Sums to zero across everyone once the bill is
   * fully covered.
   */
  netCents: number;
}

export interface BillSummary {
  /** Sum of every item's price, assigned or not. */
  subtotalCents: number;
  /** Value of items nobody has claimed yet. */
  unassignedCents: number;
  unassignedItemIds: ID[];
  taxCents: number;
  tipCents: number;
  /** subtotal + tax + tip. */
  totalCents: number;
  /** Unclaimed tax + tip, including all charges when the item subtotal is zero. */
  unclaimedChargesCents: number;
  /**
   * The two halves of `unclaimedChargesCents`, kept apart so the UI can say
   * "$2.81 tax and $6.60 tip" rather than a single combined figure that looks
   * wrong next to the bill's total tax.
   */
  unclaimedTaxCents: number;
  unclaimedTipCents: number;
  perPerson: PersonBreakdown[];
  /** True when Σ person totals + unclaimed value equals the bill total exactly. */
  reconciles: boolean;
  /** Total recorded against the bill, across everyone who paid. */
  paidCents: number;
  /**
   * `total - paid`. Positive means the table still owes the restaurant that
   * much; negative means it has overpaid. Never silently absorbed into
   * somebody's share.
   */
  unpaidCents: number;
  /** Who pays whom to square everyone up, in as few transfers as possible. */
  transfers: Transfer[];
}
