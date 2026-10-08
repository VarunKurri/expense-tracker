import { ME, MoneyBackEntry, SplitPerson, TransactionSplit } from '../models';
import { wholeShareWeights } from './split/shareWeights';
import { allocate, sum } from './split/money';
import { settle } from './split/settle';
import { activeAssignments, calculateSplit } from './split/split';
import type { Assignment, Bill, BillSummary, Charges, Item, Payment, SplitMode, Transfer } from './split/types';

/**
 * Who owes you what on a split bill, after refunds and repayments.
 *
 * Split's engine (`utils/split/`, untouched) answers "what is everyone's share
 * and who should pay whom". This file adds the two things Trackr knows and
 * Split doesn't: money that came back afterwards (refunds from the merchant,
 * repayments from friends), and that one of the people is you.
 *
 * Two rules worth knowing:
 *
 * 1. **A refund shrinks the bill, for everyone.** It lands on your card, but a
 *    $40 refund on a $240 dinner for four makes every share $50, not just
 *    yours. The smaller total is re-divided with `allocate()` in proportion to
 *    the shares people already had, so it still adds up to the cent.
 *
 * 2. **A repayment pays off the people it covers, in order.** "Alex sent $180
 *    for Alex, Ben and Cara" clears all three; whatever Ben and Cara now owe
 *    Alex is between them. Anything beyond what the covered people owed you is
 *    reported as `unappliedRepaymentCents` — usually a friend covering your
 *    share too — and the out-of-pocket rule in `money-back.ts` takes it from
 *    there.
 *
 * Integer cents throughout.
 */

/** A display name for anyone on a bill — "You" for you. */
export function personName(people: SplitPerson[], id: string): string {
  if (id === ME) return 'You';
  return people.find(p => p.id === id)?.name ?? 'Someone';
}

/** No tax, no tip — the quick "$180, three ways" split. */
export const NO_CHARGES: Charges = {
  taxMode: 'amount', taxPercent: 0, taxCents: 0,
  tipMode: 'amount', tipPercent: 0, tipCents: 0, tipBasis: 'preTax',
};

/**
 * A quick split: the whole bill as one line, shared by `participantIds`, paid
 * by you. `weights` are only read for non-equal modes (shares, percent,
 * amount), in the same order as `participantIds`.
 */
export function quickSplit(
  billCents: number,
  participantIds: string[],
  mode: SplitMode = 'equal',
  weights: number[] = [],
): TransactionSplit {
  return {
    mode: 'quick',
    participantIds: [...participantIds],
    items: [{
      id: 'bill',
      name: 'Bill',
      priceCents: billCents,
      splitMode: mode,
      assignments: participantIds.map((personId, i) => ({
        personId,
        weight: mode === 'equal' ? 1 : (weights[i] ?? 0),
      })),
    }],
    charges: { ...NO_CHARGES },
    payments: [{ personId: ME, amountCents: billCents }],
    source: 'manual',
  };
}

/** Everyone the engine needs to know about: the people sharing, plus anyone who paid. */
function billPeopleIds(split: TransactionSplit): string[] {
  return [...new Set([...split.participantIds, ...split.payments.map(p => p.personId)])];
}

/** A Trackr split in the engine's own shape. Names don't affect the maths. */
export function toBill(split: TransactionSplit): Bill {
  return {
    name: '',
    createdAt: '',
    people: billPeopleIds(split).map((id, i) => ({ id, name: id, colorIndex: i + 1 })),
    items: split.items,
    charges: split.charges,
    payments: split.payments,
    settledPersonIds: [],
  };
}

export type RepayState =
  | 'none'     // owes you nothing (it's you, they paid their own way, or they're owed)
  | 'owed'     // owes you, nothing back yet
  | 'partial'  // some of it back
  | 'repaid'   // all of it back
  | 'closed';  // marked "won't be repaid" with some still outstanding

export interface PersonSplitStatus {
  personId: string;
  /** Their part of the bill, after any refund. */
  shareCents: number;
  /** What they paid the merchant themselves. */
  paidCents: number;
  /** What they owed you before any repayment. */
  dueToMeCents: number;
  repaidCents: number;
  outstandingCents: number;
  state: RepayState;
}

export interface SplitStatus {
  /** The engine's answer for the bill as charged, before refunds. */
  summary: BillSummary;
  billTotalCents: number;
  refundedCents: number;
  /** Your part of the bill, after any refund. */
  myShareCents: number;
  /** What you paid the merchant — equals the transaction amount. */
  myPaidCents: number;
  /** Everyone except you. */
  people: PersonSplitStatus[];
  /** Still owed to you, leaving out anyone marked "won't be repaid". */
  owedToMeCents: number;
  /** Repaid beyond what the covered people owed you (e.g. a friend covered your share too). */
  unappliedRepaymentCents: number;
  /** The full settle-up plan after refunds, including any friend-to-friend transfers. */
  transfers: Transfer[];
}

export function splitStatus(split: TransactionSplit, moneyBack: MoneyBackEntry[] = []): SplitStatus {
  const summary = calculateSplit(toBill(split));
  const billTotalCents = summary.totalCents;

  // ---- Refunds shrink the bill for everyone ------------------------------
  const refundedCents = Math.min(
    billTotalCents,
    sum(moneyBack.filter(e => e.source === 'refund').map(e => e.amountCents)),
  );
  // Unclaimed value rides along as a phantom weight, exactly as in the engine,
  // so a refund never quietly lands on the people who did claim their items.
  const unclaimedCents = summary.unassignedCents + summary.unclaimedChargesCents;
  const shares = refundedCents > 0
    ? allocate(billTotalCents - refundedCents, [...summary.perPerson.map(p => p.totalCents), unclaimedCents])
    : summary.perPerson.map(p => p.totalCents);

  // ---- Who owes whom, after the refund ------------------------------------
  // The refund came back to you, so it reduces what you effectively paid.
  const positions = summary.perPerson.map((p, i) => ({
    personId: p.personId,
    netCents: (p.personId === ME ? p.paidCents - refundedCents : p.paidCents) - shares[i],
  }));
  const transfers = settle(positions);
  const dueToMe = new Map<string, number>();
  for (const t of transfers) {
    if (t.toPersonId === ME) dueToMe.set(t.fromPersonId, (dueToMe.get(t.fromPersonId) ?? 0) + t.amountCents);
  }

  // ---- Repayments pay off the people they cover, in order -----------------
  const others = summary.perPerson.filter(p => p.personId !== ME).map(p => p.personId);
  const outstanding = new Map(others.map(id => [id, dueToMe.get(id) ?? 0]));
  const repaid = new Map(others.map(id => [id, 0]));
  let unappliedRepaymentCents = 0;

  const repayments = moneyBack
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.source === 'repayment')
    // Oldest first; same-day entries keep the order they were recorded in.
    .sort((a, b) => a.entry.date.localeCompare(b.entry.date) || a.index - b.index)
    .map(({ entry }) => entry);

  for (const r of repayments) {
    let left = r.amountCents;
    // No named person at all: it pays off whoever still owes, in bill order.
    const covers = r.coversPersonIds?.length ? r.coversPersonIds
      : r.fromPersonId ? [r.fromPersonId]
      : others;
    for (const id of covers) {
      const take = Math.min(left, outstanding.get(id) ?? 0);
      if (take <= 0) continue;
      outstanding.set(id, (outstanding.get(id) ?? 0) - take);
      repaid.set(id, (repaid.get(id) ?? 0) + take);
      left -= take;
    }
    unappliedRepaymentCents += left;
  }

  // ---- Per person ----------------------------------------------------------
  const closed = new Set(split.closedPersonIds ?? []);
  const people: PersonSplitStatus[] = summary.perPerson
    .map((p, i) => ({ p, share: shares[i] }))
    .filter(({ p }) => p.personId !== ME)
    .map(({ p, share }) => {
      const due = dueToMe.get(p.personId) ?? 0;
      const back = repaid.get(p.personId) ?? 0;
      const left = outstanding.get(p.personId) ?? 0;
      const state: RepayState =
        due === 0 ? 'none'
        : left === 0 ? 'repaid'
        : closed.has(p.personId) ? 'closed'
        : back > 0 ? 'partial'
        : 'owed';
      return {
        personId: p.personId,
        shareCents: share,
        paidCents: p.paidCents,
        dueToMeCents: due,
        repaidCents: back,
        outstandingCents: left,
        state,
      };
    });

  const meIndex = summary.perPerson.findIndex(p => p.personId === ME);

  return {
    summary,
    billTotalCents,
    refundedCents,
    myShareCents: meIndex >= 0 ? shares[meIndex] : 0,
    myPaidCents: meIndex >= 0 ? summary.perPerson[meIndex].paidCents : 0,
    people,
    owedToMeCents: sum(people.filter(p => p.state !== 'closed').map(p => p.outstandingCents)),
    unappliedRepaymentCents,
    transfers,
  };
}

/**
 * What everyone owes you across many split bills, by person. People whose
 * balance is closed on a bill ("won't be repaid") don't count for that bill.
 */
export function owedToMeByPerson(
  rows: { split: TransactionSplit; moneyBack: MoneyBackEntry[] }[],
): Map<string, number> {
  const totals = new Map<string, number>();
  for (const { split, moneyBack } of rows) {
    for (const p of splitStatus(split, moneyBack).people) {
      if (p.state === 'closed' || p.outstandingCents === 0) continue;
      totals.set(p.personId, (totals.get(p.personId) ?? 0) + p.outstandingCents);
    }
  }
  return totals;
}

export type SplitProblem =
  | 'no-one-else'         // nobody to split with but you
  | 'unassigned'          // some items (and their tax/tip) belong to nobody
  | 'not-covered'         // payments don't add up to the bill
  | 'my-payment-mismatch'; // your payment isn't the transaction amount

/**
 * Why a split can't be saved yet. An empty list means it's good to go.
 *
 * Saving requires every cent to be accounted for: otherwise "what you're owed"
 * would be built on a bill nobody fully paid or fully claimed.
 */
export function splitProblems(split: TransactionSplit, transactionAmountCents: number): SplitProblem[] {
  const problems: SplitProblem[] = [];
  const summary = calculateSplit(toBill(split));
  if (!split.participantIds.some(id => id !== ME)) problems.push('no-one-else');
  if (summary.unassignedCents > 0 || summary.unclaimedChargesCents > 0) problems.push('unassigned');
  if (summary.unpaidCents !== 0) problems.push('not-covered');
  const mine = sum(split.payments.filter(p => p.personId === ME).map(p => p.amountCents));
  if (mine !== transactionAmountCents) problems.push('my-payment-mismatch');
  return problems;
}

/* ------------------------------------------------------------------ */
/* Quick split editing                                                 */
/* ------------------------------------------------------------------ */

/**
 * What the quick split editor holds: the choices, not the arithmetic. The
 * split itself is built from these at save time with the amount as it is
 * then, so editing the amount after setting up a split can't leave it stale.
 */
export interface QuickSplitState {
  /** Who shares the bill. Leave `ME` out when you paid for others entirely. */
  participantIds: string[];
  mode: SplitMode;
  /**
   * Per person, meaning set by `mode` (as in Split): `shares` whole numbers,
   * `percent` percentages adding to 100, `amount` cents adding to the bill.
   * Ignored for `equal`.
   */
  weights: Record<string, number>;
  /** Other people who paid the merchant part of the bill, in cents. */
  otherPayments: Payment[];
}

export function emptyQuickState(): QuickSplitState {
  return { participantIds: [ME], mode: 'equal', weights: {}, otherPayments: [] };
}

/** Everyone who paid, you first. Zero and duplicate entries for you are dropped. */
function payments(state: QuickSplitState, myPaidCents: number): Payment[] {
  return [
    { personId: ME, amountCents: myPaidCents },
    ...state.otherPayments.filter(p => p.personId !== ME && p.amountCents > 0),
  ];
}

/** The bill: what you paid plus what anyone else paid towards it. */
export function quickBillCents(state: QuickSplitState, myPaidCents: number): number {
  return sum(payments(state, myPaidCents).map(p => p.amountCents));
}

/**
 * The split to save. Keeps anything the editor doesn't own (who's marked
 * "won't be repaid") from the split being edited.
 */
export function buildQuickSplit(
  state: QuickSplitState, myPaidCents: number, existing?: TransactionSplit | null,
): TransactionSplit {
  const split = quickSplit(
    quickBillCents(state, myPaidCents),
    state.participantIds,
    state.mode,
    state.participantIds.map(id => state.weights[id] ?? 0),
  );
  split.payments = payments(state, myPaidCents);
  if (existing?.closedPersonIds?.length) split.closedPersonIds = [...existing.closedPersonIds];
  if (existing?.source) split.source = existing.source;
  return split;
}

/** Read a saved quick split back into the editor. */
export function quickStateFrom(split: TransactionSplit): QuickSplitState {
  const item = split.items[0];
  const weights: Record<string, number> = {};
  for (const a of item?.assignments ?? []) weights[a.personId] = a.weight;
  return {
    participantIds: [...split.participantIds],
    mode: item?.splitMode ?? 'equal',
    weights: item?.splitMode === 'equal' ? {} : weights,
    otherPayments: split.payments.filter(p => p.personId !== ME).map(p => ({ ...p })),
  };
}

/**
 * Switching mode restates the split rather than resetting it (Split's rule):
 * "$80 / $40" becomes "2 : 1" in shares and "66.67% / 33.33%" in percent.
 * Each person's current share is worked out by the engine, then expressed in
 * the new mode's terms.
 */
export function restateWeights(state: QuickSplitState, mode: SplitMode, billCents: number): Record<string, number> {
  const ids = state.participantIds;
  if (mode === 'equal' || ids.length === 0) return {};
  const current = ids.map(id => state.mode === 'equal' ? 1 : (state.weights[id] ?? 0));
  const shareCents = allocate(billCents, current);
  const out: Record<string, number> = {};
  if (mode === 'shares') {
    // Whole-number ratio of the current shares. Messy cents ("$33.34 / $33.33")
    // would reduce to giant numbers nobody wants to type, so those start even.
    const whole = state.mode === 'equal' ? ids.map(() => 1) : wholeShareWeights(shareCents);
    const usable = whole && Math.max(...whole) <= 20 ? whole : ids.map(() => 1);
    ids.forEach((id, i) => out[id] = usable[i]);
  } else if (mode === 'percent') {
    // Basis points through allocate(), so the percentages add to exactly 100.
    const bps = allocate(10000, shareCents.some(c => c > 0) ? shareCents : ids.map(() => 1));
    ids.forEach((id, i) => out[id] = bps[i] / 100);
  } else {
    ids.forEach((id, i) => out[id] = shareCents[i]);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Itemized split editing                                              */
/* ------------------------------------------------------------------ */

/**
 * What the itemized editor holds: the receipt's lines, tax and tip, and who
 * had what. As with the quick split, the arithmetic is the engine's — the
 * bill total here is whatever `calculateSplit` says items + tax + tip come to.
 */
export interface ItemizedSplitState {
  participantIds: string[];
  items: Item[];
  charges: Charges;
  otherPayments: Payment[];
}

let nextItem = 0;
/** An id for a new line; only needs to be unique within one bill. */
export function newItemId(): string {
  return `i${Date.now().toString(36)}${(nextItem++).toString(36)}`;
}

/** A blank line, shared equally by `assigneeIds` (or nobody yet). */
export function newItem(assigneeIds: string[] = [], name = '', priceCents = 0): Item {
  return {
    id: newItemId(), name, priceCents, splitMode: 'equal',
    assignments: assigneeIds.map(personId => ({ personId, weight: 1 })),
  };
}

/** Start itemizing, keeping who's on the bill and who paid from the quick split. */
export function emptyItemizedState(from?: Pick<QuickSplitState, 'participantIds' | 'otherPayments'>): ItemizedSplitState {
  return {
    participantIds: [...(from?.participantIds ?? [ME])],
    items: [newItem()],
    charges: { ...NO_CHARGES, taxMode: 'percent', tipMode: 'percent' },
    otherPayments: (from?.otherPayments ?? []).map(p => ({ ...p })),
  };
}

export function buildItemizedSplit(
  state: ItemizedSplitState, myPaidCents: number, existing?: TransactionSplit | null,
): TransactionSplit {
  const split: TransactionSplit = {
    mode: 'itemized',
    participantIds: [...state.participantIds],
    // A line with no name and no price is an empty row, not part of the bill.
    items: state.items.filter(i => i.name.trim() || i.priceCents > 0).map(i => ({ ...i, name: i.name.trim() || 'Item' })),
    charges: { ...state.charges },
    payments: [
      { personId: ME, amountCents: myPaidCents },
      ...state.otherPayments.filter(p => p.personId !== ME && p.amountCents > 0),
    ],
    source: existing?.source ?? 'manual',
  };
  if (existing?.closedPersonIds?.length) split.closedPersonIds = [...existing.closedPersonIds];
  return split;
}

export function itemizedStateFrom(split: TransactionSplit): ItemizedSplitState {
  return {
    participantIds: [...split.participantIds],
    items: split.items.map(i => ({ ...i, assignments: i.assignments.map(a => ({ ...a })) })),
    charges: { ...split.charges },
    otherPayments: split.payments.filter(p => p.personId !== ME).map(p => ({ ...p })),
  };
}

/** Items + tax + tip, as the engine adds them up. */
export function itemizedBillCents(state: ItemizedSplitState): number {
  return calculateSplit(toBill(buildItemizedSplit(state, 0))).totalCents;
}

/**
 * The amount you paid if everyone else's payments stand: the bill less what
 * they put in. What "Use this as the amount" fills in when the receipt and
 * the transaction disagree.
 */
export function myPaymentToCoverCents(state: ItemizedSplitState): number {
  const others = sum(state.otherPayments.filter(p => p.personId !== ME).map(p => p.amountCents));
  return Math.max(0, itemizedBillCents(state) - others);
}

/** Give every item nobody has claimed to one person — "the rest is mine". */
export function assignUnclaimedTo(state: ItemizedSplitState, personId: string): ItemizedSplitState {
  const people = state.participantIds.map(id => ({ id }));
  return {
    ...state,
    items: state.items.map(item =>
      item.priceCents > 0 && activeAssignments(item, people).length === 0
        ? { ...item, splitMode: 'equal' as const, assignments: [{ personId, weight: 1 }] }
        : item),
  };
}

/** Someone left the bill: drop their claims and their payment, so nothing points at them. */
export function removeFromItemized(state: ItemizedSplitState, personId: string): ItemizedSplitState {
  return {
    ...state,
    participantIds: state.participantIds.filter(id => id !== personId),
    items: state.items.map(i => ({ ...i, assignments: i.assignments.filter(a => a.personId !== personId) })),
    otherPayments: state.otherPayments.filter(p => p.personId !== personId),
  };
}

/** Equal mode: tap someone on or off an item. */
export function toggleAssignee(item: Item, personId: string): Item {
  const has = item.assignments.some(a => a.personId === personId && a.weight > 0);
  return {
    ...item,
    assignments: has
      ? item.assignments.filter(a => a.personId !== personId)
      : [...item.assignments.filter(a => a.personId !== personId), { personId, weight: 1 }],
  };
}

/**
 * An item's split mode changes the way the whole split's does: restated, not
 * reset. Whoever had it keeps their part ("Alex had two thirds" stays two
 * thirds whether written as 2:1, 66.67% or $20).
 */
export function setItemMode(item: Item, mode: SplitMode, participantIds: string[]): Item {
  if (item.splitMode === mode) return item;
  const current: Record<string, number> = {};
  for (const a of item.assignments) current[a.personId] = item.splitMode === 'equal' ? (a.weight > 0 ? 1 : 0) : a.weight;
  const asShares: QuickSplitState = { participantIds, mode: 'shares', weights: current, otherPayments: [] };
  const hasClaims = participantIds.some(id => (current[id] ?? 0) > 0);
  const weights = mode === 'equal' || !hasClaims ? {} : restateWeights(asShares, mode, item.priceCents);
  const assignments: Assignment[] = mode === 'equal'
    ? participantIds.filter(id => (current[id] ?? 0) > 0).map(personId => ({ personId, weight: 1 }))
    : participantIds.map(personId => ({ personId, weight: weights[personId] ?? 0 }));
  return { ...item, splitMode: mode, assignments };
}

/** Uneven modes: set one person's shares, percent or amount (cents) on an item. */
export function setItemWeight(item: Item, personId: string, weight: number): Item {
  const w = Math.max(0, weight);
  // Keep the order: the engine breaks cent ties by position, so moving someone
  // to the end could shift a cent between people just because a number was edited.
  const assignments = item.assignments.some(a => a.personId === personId)
    ? item.assignments.map(a => a.personId === personId ? { ...a, weight: w } : a)
    : [...item.assignments, { personId, weight: w }];
  return { ...item, assignments };
}
