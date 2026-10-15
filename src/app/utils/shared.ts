import { ME, MoneyBackEntry, SharedBill, Transaction } from '../models';
import { formatCurrency } from './format';
import { fromCents } from './money';
import type { SplitTotals } from './reporting';
import { sum } from './split/money';
import type { Transfer } from './split/types';
import { PersonSplitStatus, splitStatus } from './splits';

/**
 * Everyone who owes you, across every split bill: the Shared page.
 *
 * Per-bill arithmetic is `splitStatus` (Split's engine plus refunds and
 * repayments); this only gathers it by person, and spreads one repayment
 * over several bills. Integer cents throughout.
 */

export interface BillShare {
  tx: Transaction;
  status: PersonSplitStatus;
}

/** A bill someone else paid (outside any group), and what you owe them on it. */
export interface OwedBill {
  bill: SharedBill;
  /** Still to pay them on it, after what you've paid them so far. */
  cents: number;
  /** What your payments to them have paid off on it. */
  paidCents?: number;
}

/**
 * A payment you made someone outside any group: a bank payment (an expense
 * with `settlement`, `txId`) or cash (`SplitPerson.payments`, `paymentId`).
 * It pays off their bills oldest first.
 */
export interface PaidOut {
  personId: string;
  amountCents: number;
  date: string;
  txId?: string;
  paymentId?: string;
  note?: string;
}

/**
 * Where someone stands with you in one group: what the group's settle-up plan
 * has them paying you (positive) or you paying them (negative).
 */
export interface GroupPart {
  groupId: string;
  name: string;
  cents: number;
}

export interface PersonBalance {
  personId: string;
  /** Still owed to you on bills outside groups, leaving out any marked "won't be repaid". */
  owedCents: number;
  /** Bills they paid that you owe them on (outside groups), oldest first. */
  owedByMe: OwedBill[];
  /** What you still owe them on those bills, after your payments. */
  iOweCents: number;
  /** Their bills your payments have paid off in full, newest first. */
  settledOwed: OwedBill[];
  /** What you've paid them outside groups, newest first. */
  paidOut: PaidOut[];
  /** Paid them beyond what their bills came to: it's theirs to pay back. */
  overpaidCents: number;
  /** What they owe you (+) or you owe them (−) in each group. Empty until `withGroups`. */
  groups: GroupPart[];
  /** Everything together: bills either way outside groups, plus every group. Positive, they owe you. */
  netCents: number;
  /** Bills they still owe on, oldest first, which is the order a repayment pays them off. */
  openBills: BillShare[];
  /** Every split bill they were on, newest first. */
  allBills: BillShare[];
}

/**
 * Each person you split with, most owed first. Bills in a group are left out
 * (`inGroup`): a group is settled across all its bills (utils/groups.ts), so
 * one bill's "owes you" would be the wrong number.
 */
export function balancesByPerson(
  txs: Transaction[], moneyBackFor: (t: Transaction) => MoneyBackEntry[],
  inGroup: (t: Transaction) => boolean = () => false,
  otherPaid: SharedBill[] = [],
  paidOut: PaidOut[] = [],
): PersonBalance[] {
  const byPerson = new Map<string, BillShare[]>();
  for (const tx of txs) {
    if (tx.type !== 'expense' || !tx.split || inGroup(tx)) continue;
    for (const status of splitStatus(tx.split, moneyBackFor(tx)).people) {
      byPerson.set(status.personId, [...(byPerson.get(status.personId) ?? []), { tx, status }]);
    }
  }
  // Bills someone else paid (the caller leaves out those in a group): what
  // you owe whoever paid, as the bill's own settle-up says.
  const owed = new Map<string, OwedBill[]>();
  for (const bill of [...otherPaid].sort((a, b) => a.date.localeCompare(b.date) || a.createdAt - b.createdAt)) {
    for (const t of splitStatus(bill.split).transfers) {
      if (t.fromPersonId !== ME) continue;
      owed.set(t.toPersonId, [...(owed.get(t.toPersonId) ?? []), { bill, cents: t.amountCents }]);
    }
  }
  for (const personId of owed.keys()) if (!byPerson.has(personId)) byPerson.set(personId, []);
  for (const p of paidOut) if (!byPerson.has(p.personId)) byPerson.set(p.personId, []);
  const byDate = (a: BillShare, b: BillShare) => a.tx.date.localeCompare(b.tx.date) || a.tx.createdAt - b.tx.createdAt;
  return [...byPerson.entries()]
    .map(([personId, bills]) => {
      const openBills = bills
        .filter(b => b.status.outstandingCents > 0 && b.status.state !== 'closed')
        .sort(byDate);
      const owedCents = sum(openBills.map(b => b.status.outstandingCents));
      // What you've paid them pays off their bills, oldest first.
      const mine = paidOut.filter(p => p.personId === personId).sort((a, b) => b.date.localeCompare(a.date));
      let left = sum(mine.map(p => p.amountCents));
      const open: OwedBill[] = [];
      const settledOwed: OwedBill[] = [];
      for (const o of owed.get(personId) ?? []) {
        const paid = Math.min(left, o.cents);
        left -= paid;
        const row = { bill: o.bill, cents: o.cents - paid, ...(paid ? { paidCents: paid } : {}) };
        (row.cents > 0 ? open : settledOwed).push(row);
      }
      const iOweCents = sum(open.map(o => o.cents));
      return {
        personId,
        owedCents,
        owedByMe: open,
        iOweCents,
        settledOwed: settledOwed.reverse(),
        paidOut: mine,
        overpaidCents: left,
        groups: [],
        netCents: owedCents - iOweCents + left,
        openBills,
        allBills: [...bills].sort(byDate).reverse(),
      };
    })
    .sort((a, b) => b.netCents - a.netCents);
}

/** A group's suggested payments, as `withGroups` needs them. */
export interface GroupPlan {
  groupId: string;
  name: string;
  plan: Transfer[];
}

/**
 * Each person's total with you, groups included, the way Splitwise shows a
 * friend's balance: bills outside groups, plus whatever each group's settle-up
 * plan has them paying you (or you paying them). Someone you only share a
 * group with gets a balance too. Most owed first.
 */
export function withGroups(balances: PersonBalance[], plans: GroupPlan[]): PersonBalance[] {
  const byPerson = new Map(balances.map(b => [b.personId, { ...b, groups: [...b.groups] }]));
  const get = (personId: string) => {
    let b = byPerson.get(personId);
    if (!b) {
      b = { personId, owedCents: 0, owedByMe: [], iOweCents: 0, settledOwed: [], paidOut: [], overpaidCents: 0,
            groups: [], netCents: 0, openBills: [], allBills: [] };
      byPerson.set(personId, b);
    }
    return b;
  };
  for (const g of plans) {
    for (const t of g.plan) {
      const other = t.toPersonId === ME ? t.fromPersonId : t.fromPersonId === ME ? t.toPersonId : null;
      if (!other) continue;
      const cents = t.toPersonId === ME ? t.amountCents : -t.amountCents;
      const b = get(other);
      const part = b.groups.find(p => p.groupId === g.groupId);
      if (part) part.cents += cents;
      else b.groups.push({ groupId: g.groupId, name: g.name, cents });
    }
  }
  return [...byPerson.values()]
    .map(b => ({ ...b, netCents: b.owedCents - b.iOweCents + b.overpaidCents + sum(b.groups.map(p => p.cents)) }))
    .sort((a, b) => b.netCents - a.netCents);
}

/** What someone owes you that a repayment from them can pay off: bills outside groups, and groups where they owe you. */
export function repayableCents(b: PersonBalance): number {
  return b.owedCents + sum(b.groups.filter(g => g.cents > 0).map(g => g.cents));
}

export interface RepaymentPart {
  expenseId: string;
  amountCents: number;
}

/**
 * Spread one repayment over someone's open bills, oldest first, each up to
 * what's still owed on it. Anything beyond everything owed goes on the
 * newest bill (where it shows as a surplus, and counts as income), so the
 * parts always add up to exactly what was paid.
 */
export function spreadRepayment(openBills: BillShare[], amountCents: number): RepaymentPart[] {
  if (amountCents <= 0 || openBills.length === 0) return [];
  const parts: RepaymentPart[] = [];
  let left = amountCents;
  for (const bill of openBills) {
    if (left <= 0) break;
    const take = Math.min(left, bill.status.outstandingCents);
    if (take > 0) parts.push({ expenseId: bill.tx.id!, amountCents: take });
    left -= take;
  }
  if (left > 0) {
    const last = openBills[openBills.length - 1].tx.id!;
    const existing = parts.find(p => p.expenseId === last);
    if (existing) existing.amountCents += left;
    else parts.push({ expenseId: last, amountCents: left });
  }
  return parts;
}

/** Everything owed to you, across everyone (groups included once `withGroups` has run). */
export function totalOwedCents(balances: PersonBalance[]): number {
  return sum(balances.filter(b => b.netCents > 0).map(b => b.netCents));
}

/** Everything you owe, across everyone: a positive number. */
export function totalYouOweCents(balances: PersonBalance[]): number {
  return sum(balances.filter(b => b.netCents < 0).map(b => -b.netCents));
}

const usd = (cents: number) => formatCurrency(fromCents(cents));

/**
 * The sentence under "Owed to you" on Analysis: what you covered for other
 * people on a period's split bills, and what that means for your spending.
 * `period` reads after the bill count: "this month", "in this period", or ''.
 */
export function splitSentence(t: SplitTotals, period: string): string {
  const bills = `${t.bills} split bill${t.bills === 1 ? '' : 's'}${period ? ' ' + period : ''}`;
  if (t.forOthersCents === 0) return `Nobody owes you on your ${bills}. Everyone paid their own way.`;

  const covered = `You covered ${usd(t.forOthersCents)} of other people's shares on ${bills}`;
  const wont = t.wontBeRepaidCents > 0
    ? ` ${usd(t.wontBeRepaidCents)} won't be repaid, so it stays in your spending.`
    : '';
  if (t.owedCents === 0) {
    return t.wontBeRepaidCents === 0
      ? `${covered}, and all of it came back, so only your share counts as spending.`
      : `${covered}.${wont}`;
  }
  const back = t.repaidCents > 0
    ? `, and ${usd(t.repaidCents)} has come back. Until the other ${usd(t.owedCents)} does, it counts in your spending.`
    : '. Until it comes back, it counts in your spending.';
  return `${covered}${back}${wont}`;
}
