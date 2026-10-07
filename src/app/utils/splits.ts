import { ME, MoneyBackEntry, TransactionSplit } from '../models';
import { allocate, sum } from './split/money';
import { settle } from './split/settle';
import { calculateSplit } from './split/split';
import type { Bill, BillSummary, Charges, SplitMode, Transfer } from './split/types';

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
