import { Group, ME, MoneyBackEntry, SharedBill, Transaction, TransactionSplit, UntrackedReturn } from '../models';
import type { IncomeLink, LinkedIncome } from './money-back';
import { toCents } from './money';
import { sum } from './split/money';
import { NetPosition, settle } from './split/settle';
import type { Transfer } from './split/types';
import { billPositions, splitStatus } from './splits';

/**
 * A group's balances, Splitwise style: a trip, a flat, a weekend away.
 *
 * Outside a group, each split bill is settled on its own (utils/splits.ts).
 * Inside one, what matters is where everyone stands over the whole group:
 *
 *     balance = what you paid − your shares   (+ payments you made, − payments you got)
 *
 * Positive is owed money back, negative still owes, and the balances always
 * add up to zero. "Simplify debts" (Split's `settle()`) turns them into the
 * fewest payments. Your own balance doesn't depend on how it's simplified,
 * which is why it matches Splitwise when the bills match.
 *
 * Where each payment lives:
 *   - money you got:  money back (a repayment) on your group expenses, as
 *                     Phase 1 records it: a linked income, or cash by hand.
 *                     One payment is spread over several expenses
 *                     (`spreadReceived`) but reads as one payment here.
 *   - money you sent: an expense with `settlement` (it's real spending).
 *   - between two friends, and cash you sent outside your accounts:
 *                     `Group.payments`.
 *
 * And spending: once a group is settled, what you're out of pocket across your
 * group expenses equals the sum of your shares, to the cent. The tests pin
 * that down. Integer cents throughout.
 */

export interface GroupBill {
  /** `mine`: an expense you paid (or paid part of). `theirs`: a bill someone else paid. */
  kind: 'mine' | 'theirs';
  id: string;
  date: string;
  merchant: string;
  categoryId?: string;
  /** What the bill came to, after any refund. */
  totalCents: number;
  myShareCents: number;
  /** Who paid the merchant. */
  paidByIds: string[];
  /** Everyone's `paid − share` on this bill alone. */
  positions: NetPosition[];
  tx?: Transaction;
  bill?: SharedBill;
  createdAt: number;
}

/** A payment inside the group. */
export interface GroupMove {
  fromPersonId: string;
  toPersonId: string;
  amountCents: number;
  date: string;
  /** `received`: to you · `sent`: from you · `between`: two other members. */
  kind: 'received' | 'sent' | 'between';
  /** The expense it was recorded on (received) or that it is (sent). */
  txId?: string;
  /** Received: every expense it was spread over. */
  txIds?: string[];
  /** Recorded on the group itself: its id in `Group.payments`. */
  paymentId?: string;
  /** Received as a bank payment: the income transaction it came as. */
  incomeId?: string;
  /** Received as cash: the entries it was written as, so it can be removed. */
  entries?: { txId: string; entryId: string }[];
  /** Received without saying who sent it, so credited by bill order: a guess until it's named. */
  guessed?: boolean;
}

export interface GroupLedger {
  groupId: string;
  /** Newest first. */
  bills: GroupBill[];
  /** Newest first. */
  moves: GroupMove[];
  /** You first, then members in the group's order, then anyone else on a bill. Sums to zero. */
  balances: NetPosition[];
  /** Positive: the group owes you. Negative: you owe the group. */
  myBalanceCents: number;
  /** What the group spent, after refunds. */
  totalCents: number;
  /** Your part of it. */
  myShareCents: number;
  /** Suggested payments: the fewest when simplifying, otherwise back to whoever paid. */
  plan: Transfer[];
}

/** A split bill of yours in this group. */
export function isGroupBill(t: Transaction, groupId: string): boolean {
  return t.type === 'expense' && t.split?.groupId === groupId;
}

/** Money you sent someone to settle up in this group. */
export function isGroupSettlement(t: Transaction, groupId: string): boolean {
  return t.type === 'expense' && t.settlement?.groupId === groupId;
}

const byDate = (a: { date: string; createdAt: number }, b: { date: string; createdAt: number }) =>
  a.date.localeCompare(b.date) || a.createdAt - b.createdAt;

/** A bill's own figures, whichever kind it is. */
function groupBill(
  kind: 'mine' | 'theirs', id: string, split: TransactionSplit, moneyBack: MoneyBackEntry[],
  rest: Pick<GroupBill, 'date' | 'merchant' | 'categoryId' | 'tx' | 'bill' | 'createdAt'>,
): GroupBill {
  const { billTotalCents, refundedCents, shares, positions, summary } = billPositions(split, moneyBack);
  const meIndex = summary.perPerson.findIndex(p => p.personId === ME);
  return {
    kind, id, ...rest,
    totalCents: billTotalCents - refundedCents,
    myShareCents: meIndex >= 0 ? shares[meIndex] : 0,
    paidByIds: split.payments.filter(p => p.amountCents > 0).map(p => p.personId),
    positions,
  };
}

/** A repayment that names nobody (no sender, and not exactly one person covered). */
const unnamed = (from?: string, covers?: string[]) => !from && (covers?.length ?? 0) !== 1;

/**
 * Who a repayment on one of your expenses came from. Named entries say so.
 * An unnamed one ("someone paid me back") is credited the way the bill itself
 * would apply it: to whoever it covers, in order, up to what each owed.
 */
function payersOf(entry: MoneyBackEntry, split: TransactionSplit | undefined, fallbackId: string | undefined,
                  refunds: MoneyBackEntry[]): { personId: string; amountCents: number }[] {
  if (entry.fromPersonId) return [{ personId: entry.fromPersonId, amountCents: entry.amountCents }];
  if (entry.coversPersonIds?.length === 1) return [{ personId: entry.coversPersonIds[0], amountCents: entry.amountCents }];
  if (!split) return fallbackId ? [{ personId: fallbackId, amountCents: entry.amountCents }] : [];
  const status = splitStatus(split, [...refunds, { ...entry, fromPersonId: undefined }]);
  const parts = status.people.filter(p => p.repaidCents > 0).map(p => ({ personId: p.personId, amountCents: p.repaidCents }));
  const left = entry.amountCents - sum(parts.map(p => p.amountCents));
  const first = status.people[0]?.personId ?? fallbackId;
  if (left > 0 && first) {
    const existing = parts.find(p => p.personId === first);
    if (existing) existing.amountCents += left;
    else parts.push({ personId: first, amountCents: left });
  }
  return parts;
}

/**
 * Everything about one group: its bills, its payments, where everyone stands,
 * and the suggested way to settle.
 *
 * `txs` and `sharedBills` can be everything you have; this picks out the
 * group's. `moneyBackFor` is `TransactionService.moneyBackEntriesFor`.
 */
export function groupLedger(
  group: Group & { id: string },
  txs: Transaction[],
  sharedBills: SharedBill[],
  moneyBackFor: (t: Transaction) => MoneyBackEntry[],
): GroupLedger {
  const groupId = group.id;
  const bills: GroupBill[] = [];
  const moves: GroupMove[] = [];
  const received = new Map<string, GroupMove>();

  for (const tx of txs) {
    const mine = isGroupBill(tx, groupId);
    const sent = isGroupSettlement(tx, groupId);
    if (!mine && !sent) continue;
    const moneyBack = moneyBackFor(tx);
    const refunds = moneyBack.filter(e => e.source === 'refund');
    if (mine) {
      bills.push(groupBill('mine', tx.id!, tx.split!, moneyBack, {
        date: tx.date, merchant: tx.merchant || 'Expense', categoryId: tx.categoryId, tx, createdAt: tx.createdAt,
      }));
    } else {
      moves.push({ fromPersonId: ME, toPersonId: tx.settlement!.personId, amountCents: toCents(tx.amount), date: tx.date, kind: 'sent', txId: tx.id });
    }
    // Repayments on any of your group expenses are money you got from someone.
    // One payment spread over several expenses (the same income, or cash
    // recorded together) is gathered back into one.
    for (const entry of moneyBack.filter(e => e.source === 'repayment')) {
      const guessed = unnamed(entry.fromPersonId, entry.coversPersonIds) || undefined;
      const entryId = (entry as Partial<UntrackedReturn>).id;
      for (const p of payersOf(entry, mine ? tx.split : undefined, tx.settlement?.personId, refunds)) {
        const key = entry.incomeId ? `i:${entry.incomeId}:${p.personId}` : entry.batchId ? `b:${entry.batchId}:${p.personId}` : '';
        let move = key ? received.get(key) : undefined;
        if (!move) {
          move = {
            fromPersonId: p.personId, toPersonId: ME, amountCents: 0, date: entry.date, kind: 'received',
            txId: tx.id, txIds: [], guessed, ...(entry.incomeId ? { incomeId: entry.incomeId } : {}),
          };
          moves.push(move);
          if (key) received.set(key, move);
        }
        move.amountCents += p.amountCents;
        if (!move.txIds!.includes(tx.id!)) move.txIds!.push(tx.id!);
        if (entryId && !move.entries?.some(e => e.entryId === entryId && e.txId === tx.id)) {
          move.entries = [...(move.entries ?? []), { txId: tx.id!, entryId }];
        }
      }
    }
  }

  for (const b of sharedBills) {
    if (b.split.groupId !== groupId) continue;
    bills.push(groupBill('theirs', b.id!, b.split, [], {
      date: b.date, merchant: b.merchant || 'Bill', categoryId: b.categoryId, bill: b, createdAt: b.createdAt,
    }));
  }

  for (const p of group.payments ?? []) {
    const kind = p.fromPersonId === ME ? 'sent' : p.toPersonId === ME ? 'received' : 'between';
    moves.push({ fromPersonId: p.fromPersonId, toPersonId: p.toPersonId, amountCents: p.amountCents, date: p.date, kind, paymentId: p.id });
  }

  // ---- Where everyone stands --------------------------------------------
  const order = [ME, ...group.memberIds];
  const net = new Map<string, number>(order.map(id => [id, 0]));
  const add = (id: string, cents: number) => net.set(id, (net.get(id) ?? 0) + cents);
  for (const b of bills) for (const p of b.positions) add(p.personId, p.netCents);
  // Paying someone moves you toward being owed, and them toward owing.
  for (const m of moves) { add(m.fromPersonId, m.amountCents); add(m.toPersonId, -m.amountCents); }
  const balances = [...net.entries()].map(([personId, netCents]) => ({ personId, netCents }));

  const plan = group.simplify ? settle(balances) : pairwisePlan(bills, moves);

  return {
    groupId,
    bills: bills.sort(byDate).reverse(),
    moves: moves.sort((a, b) => b.date.localeCompare(a.date)),
    balances,
    myBalanceCents: net.get(ME) ?? 0,
    totalCents: sum(bills.map(b => b.totalCents)),
    myShareCents: sum(bills.map(b => b.myShareCents)),
    plan,
  };
}

/**
 * Without simplifying: everyone pays back whoever paid each bill, with what
 * two people owe each other netted into one payment, and payments between them
 * taken off. A payment from A to B counts as B now owing A, so overpaying
 * simply flips the direction.
 */
function pairwisePlan(bills: GroupBill[], moves: GroupMove[]): Transfer[] {
  const owed = new Map<string, number>();
  const key = (from: string, to: string) => `${from}\u0000${to}`;
  const add = (from: string, to: string, cents: number) => owed.set(key(from, to), (owed.get(key(from, to)) ?? 0) + cents);
  for (const b of bills) for (const t of settle(b.positions)) add(t.fromPersonId, t.toPersonId, t.amountCents);
  for (const m of moves) add(m.toPersonId, m.fromPersonId, m.amountCents);

  const plan: Transfer[] = [];
  const seen = new Set<string>();
  for (const k of owed.keys()) {
    const [a, b] = k.split('\u0000');
    const pair = a < b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
    if (seen.has(pair)) continue;
    seen.add(pair);
    const diff = (owed.get(key(a, b)) ?? 0) - (owed.get(key(b, a)) ?? 0);
    if (diff > 0) plan.push({ fromPersonId: a, toPersonId: b, amountCents: diff });
    if (diff < 0) plan.push({ fromPersonId: b, toPersonId: a, amountCents: -diff });
  }
  return plan.sort((x, y) => y.amountCents - x.amountCents || x.fromPersonId.localeCompare(y.fromPersonId));
}

/** The suggested payments you're part of: who pays you, and who you pay. */
export function myPlan(ledger: GroupLedger): { from: Transfer[]; to: Transfer[] } {
  return {
    from: ledger.plan.filter(t => t.toPersonId === ME),
    to: ledger.plan.filter(t => t.fromPersonId === ME),
  };
}

/**
 * Where money you got from someone in a group goes as money back, so your
 * spending stays right: over your group bills, oldest first, each up to the
 * part of it that was other people's and hasn't come back yet; then over your
 * settle-up payments (if you overpaid someone and they're paying you back).
 * Anything beyond all of that goes on the newest, where it shows as a surplus
 * and counts as income, Phase 1's rule. Empty if you have nothing in the
 * group to put it on.
 *
 * The parts always add up to exactly `amountCents`, ready for an income's
 * `moneyBackSplits` or for cash recorded on each expense.
 */
export function spreadReceived(
  groupId: string, txs: Transaction[], moneyBackFor: (t: Transaction) => MoneyBackEntry[], amountCents: number,
): IncomeLink[] {
  if (amountCents <= 0) return [];
  const targets = txs
    .filter(t => isGroupBill(t, groupId) || isGroupSettlement(t, groupId))
    .sort((a, b) => Number(!!a.settlement) - Number(!!b.settlement) || byDate(a, b))
    .map(t => {
      const moneyBack = moneyBackFor(t);
      const repaid = sum(moneyBack.filter(e => e.source === 'repayment').map(e => e.amountCents));
      const room = t.split
        // What you're out of pocket beyond your own share: other people's part.
        ? Math.max(0, (billPositions(t.split, moneyBack).positions.find(p => p.personId === ME)?.netCents ?? 0) - repaid)
        : Math.max(0, toCents(t.amount) - sum(moneyBack.map(e => e.amountCents)));
      return { id: t.id!, room };
    });
  if (!targets.length) return [];

  const parts: IncomeLink[] = [];
  let left = amountCents;
  for (const t of targets) {
    if (left <= 0) break;
    const take = Math.min(left, t.room);
    if (take > 0) parts.push({ expenseId: t.id, amountCents: take });
    left -= take;
  }
  if (left > 0) {
    const last = targets[targets.length - 1].id;
    const existing = parts.find(p => p.expenseId === last);
    if (existing) existing.amountCents += left;
    else parts.push({ expenseId: last, amountCents: left });
  }
  return parts;
}

/**
 * Money that came back to you on a group's expenses without saying who sent
 * it: usually a payment linked before splits existed ("reimburses this
 * expense"). A group credits each payment to the person who made it, so these
 * can only be credited by guessing (bill order); picking who it was fixes it.
 * A bank payment is listed once, however many expenses it was spread over.
 */
export interface UnassignedPayment {
  /** A bank payment (income) linked to the group's expenses. */
  income?: Transaction;
  /** Or cash recorded by hand on one expense: the expense, and the entry's id. */
  expense?: Transaction;
  entryId?: string;
  amountCents: number;
  date: string;
  /** "Zelle from VYBHAV J" or "Cash on BevMo!". */
  label: string;
}

export function unassignedPayments(
  groupId: string, txs: Transaction[], linksFor: (t: Transaction) => LinkedIncome[],
): UnassignedPayment[] {
  const byIncome = new Map<string, UnassignedPayment>();
  const cash: UnassignedPayment[] = [];
  for (const t of txs) {
    if (!isGroupBill(t, groupId) && !isGroupSettlement(t, groupId)) continue;
    for (const link of linksFor(t)) {
      const info = link.income.moneyBackInfo;
      if ((info?.source ?? 'repayment') !== 'repayment' || !unnamed(info?.fromPersonId, info?.coversPersonIds)) continue;
      const id = link.income.id!;
      const existing = byIncome.get(id);
      if (existing) existing.amountCents += link.amountCents;
      else byIncome.set(id, {
        income: link.income, amountCents: link.amountCents, date: link.income.date,
        label: link.income.merchant || 'A payment',
      });
    }
    for (const e of t.moneyBack ?? []) {
      if (e.source !== 'repayment' || !unnamed(e.fromPersonId, e.coversPersonIds)) continue;
      cash.push({ expense: t, entryId: e.id, amountCents: e.amountCents, date: e.date, label: `Cash on ${t.merchant || 'an expense'}` });
    }
  }
  return [...byIncome.values(), ...cash].sort((a, b) => a.date.localeCompare(b.date));
}

/** One category's part of a group: what the bills in it came to, and your share. */
export interface GroupCategory {
  /** Absent for bills with no category. */
  categoryId?: string;
  totalCents: number;
  myShareCents: number;
  bills: number;
}

/**
 * Where a group's money went, by category, biggest first: "Dining $280.24,
 * your share $46.70". Covers every bill, whoever paid it, so it reads the
 * whole trip the way Splitwise's "spending by category" does.
 */
export function groupByCategory(bills: GroupBill[]): GroupCategory[] {
  const byId = new Map<string, GroupCategory>();
  for (const b of bills) {
    const key = b.categoryId ?? '';
    const row = byId.get(key) ?? { ...(b.categoryId ? { categoryId: b.categoryId } : {}), totalCents: 0, myShareCents: 0, bills: 0 };
    row.totalCents += b.totalCents;
    row.myShareCents += b.myShareCents;
    row.bills += 1;
    byId.set(key, row);
  }
  return [...byId.values()]
    .filter(r => r.totalCents > 0)
    .sort((a, b) => b.totalCents - a.totalCents || Number(!a.categoryId) - Number(!b.categoryId));
}
