import { MoneyBackEntry, Transaction, UntrackedReturn } from '../models';
import { fromCents, toCents } from './money';
import type { MoneyRules } from './reporting';

/**
 * Money back on an expense (refunds and repayments alike) and what it leaves
 * you out of pocket. All integer cents.
 *
 * Refunds, reimbursements and split repayments used to be three separate
 * mechanisms. They are one thing: money that came back on a purchase. Each
 * piece has a source (`refund` from the merchant, `repayment` from a person)
 * and is either tracked (an income transaction linked to the expense through
 * `reimbursesId`) or untracked (recorded by hand on the expense: cash, store
 * credit).
 *
 * The rule (the same one Trackr's reimbursement netting has always used):
 *
 *     out of pocket = what you paid − everything that came back, floored at 0
 *
 * and anything that came back beyond what you paid is a surplus, which counts
 * as income rather than being silently dropped.
 */

export function moneyBackTotalCents(entries: MoneyBackEntry[]): number {
  return entries.reduce((total, e) => total + e.amountCents, 0);
}

export function outOfPocketCents(paidCents: number, entries: MoneyBackEntry[]): number {
  return Math.max(0, paidCents - moneyBackTotalCents(entries));
}

export function surplusCents(paidCents: number, entries: MoneyBackEntry[]): number {
  return Math.max(0, moneyBackTotalCents(entries) - paidCents);
}

/**
 * An income linked to an expense, as money back. Links made before refunds
 * existed carry no `moneyBackInfo`; they were always "a friend paid me back".
 */
/** Where an income goes as money back, and how much to each expense. */
export interface IncomeLink { expenseId: string; amountCents: number; }

/**
 * An income's money-back links: one expense (`reimbursesId`, its whole
 * amount) or spread over several (`moneyBackSplits`). Empty for any other
 * income, which then counts as income.
 */
export function incomeLinks(t: Transaction): IncomeLink[] {
  if (t.type !== 'income') return [];
  if (t.moneyBackSplits?.length) return t.moneyBackSplits;
  return t.reimbursesId ? [{ expenseId: t.reimbursesId, amountCents: toCents(t.amount) }] : [];
}

/** Money back on some purchase: kept out of income while money back is counted. */
export function isMoneyBackIncome(t: Transaction): boolean {
  return incomeLinks(t).length > 0;
}

export function linkedEntry(income: Transaction, amountCents = toCents(income.amount)): MoneyBackEntry {
  return {
    source: income.moneyBackInfo?.source ?? 'repayment',
    amountCents,
    date: income.date,
    fromPersonId: income.moneyBackInfo?.fromPersonId,
    coversPersonIds: income.moneyBackInfo?.coversPersonIds,
  };
}

/**
 * Money back recorded on the expense itself, including the legacy
 * `refunded: true` flag read as one full refund, so data from before the
 * merge keeps exactly the totals it always had.
 */
export function untrackedEntries(t: Transaction): MoneyBackEntry[] {
  const entries: MoneyBackEntry[] = [...(t.moneyBack ?? [])];
  if (t.refunded && !entries.some(e => e.source === 'refund')) {
    entries.push({ source: 'refund', amountCents: toCents(t.amount), date: t.date });
  }
  return entries;
}

/** Every piece of money back on an expense: what's on it, plus its linked incomes. */
/** An income linked to an expense, with the part of it that went there. */
export interface LinkedIncome { income: Transaction; amountCents: number; }

export function moneyBackEntries(expense: Transaction, linked: LinkedIncome[] = []): MoneyBackEntry[] {
  return [...untrackedEntries(expense), ...linked.map(l => linkedEntry(l.income, l.amountCents))];
}

export type RefundState = 'none' | 'partial' | 'full';

/**
 * Refunds only: a friend paying you back doesn't make a purchase "refunded".
 * A fully refunded expense is left out of analysis entirely (with the toggle
 * on), as the old "Mark as refunded" did; a partial one is netted.
 */
export function refundState(t: Transaction, linkedRefundCents = 0): RefundState {
  if (t.type !== 'expense') return 'none';
  const refunded = linkedRefundCents + moneyBackTotalCents(untrackedEntries(t).filter(e => e.source === 'refund'));
  if (refunded <= 0) return 'none';
  return refunded >= toCents(t.amount) ? 'full' : 'partial';
}

/**
 * Pure version for code with no access to linked incomes (loan matching):
 * sees the legacy flag and untracked refunds. Everything that can goes through
 * `TransactionService.isFullyRefunded`, which also counts linked refund incomes.
 */
export function isFullyRefunded(t: Transaction, linkedRefundCents = 0): boolean {
  return refundState(t, linkedRefundCents) === 'full';
}

let nextId = 0;
/** A short id for a hand-recorded entry; only needs to be unique on one expense. */
export function newReturnId(): string {
  return `${Date.now().toString(36)}-${(nextId++).toString(36)}`;
}

/** The whole purchase refunded, as an untracked entry (bulk "Mark refunded", CSV import). */
export function fullRefundEntry(t: Transaction): UntrackedReturn {
  return { id: newReturnId(), source: 'refund', amountCents: toCents(t.amount), date: t.date };
}

/**
 * The patch that marks an expense fully refunded (or un-marks it), in the new
 * shape. Clears the legacy flag either way so the fact lives in one place, and
 * keeps any repayments already recorded.
 */
export function refundedPatch(t: Transaction, refunded: boolean): Partial<Transaction> {
  const others = (t.moneyBack ?? []).filter(e => e.source !== 'refund');
  return {
    moneyBack: refunded ? [...others, fullRefundEntry(t)] : others,
    refunded: undefined,
  };
}

/** Incomes linked to each expense, with the part that went there, by expense id. */
export function linkedIncomesMap(txs: Transaction[]): Map<string, LinkedIncome[]> {
  const map = new Map<string, LinkedIncome[]>();
  for (const income of txs) {
    for (const link of incomeLinks(income)) {
      map.set(link.expenseId, [...(map.get(link.expenseId) ?? []), { income, amountCents: link.amountCents }]);
    }
  }
  return map;
}

/**
 * Money back for a whole set of transactions: what `TransactionService`
 * (and the test fakes) answer every "how much came back on this?" with.
 *
 * A base class rather than service methods so the logic lives in exactly one
 * place: the service extends it, and so do the fakes in page tests, which used
 * to re-implement reimbursement netting by hand and could drift from the real
 * thing. Subclasses just provide `transactions`.
 */
export abstract class MoneyBackLedger {
  abstract transactions: () => Transaction[];

  // Rebuilt only when the transaction list itself changes (signals hand back
  // the same array until then), so totalling a page stays linear.
  private linkCache?: { txs: Transaction[]; map: Map<string, LinkedIncome[]> };

  private linked(): Map<string, LinkedIncome[]> {
    const txs = this.transactions();
    if (this.linkCache?.txs !== txs) this.linkCache = { txs, map: linkedIncomesMap(txs) };
    return this.linkCache.map;
  }

  /** The incomes linked to an expense as money back. */
  linkedIncomesFor(expense?: Transaction | null): Transaction[] {
    return this.linksFor(expense).map(l => l.income);
  }

  /** The incomes linked to an expense, with how much of each went to it. */
  linksFor(expense?: Transaction | null): LinkedIncome[] {
    return expense?.id ? this.linked().get(expense.id) ?? [] : [];
  }

  /** Every piece of money back on an expense, tracked and untracked. */
  moneyBackEntriesFor(t: Transaction): MoneyBackEntry[] {
    if (t.type !== 'expense') return [];
    return moneyBackEntries(t, this.linksFor(t));
  }

  /** How much came back on an expense, in dollars. */
  moneyBackFor(t: Transaction): number {
    return fromCents(moneyBackTotalCents(this.moneyBackEntriesFor(t)));
  }

  /** An expense's true cost after money back (floored at 0). Non-expenses pass through. */
  effectiveExpenseAmount(t: Transaction): number {
    if (t.type !== 'expense') return t.amount;
    return fromCents(outOfPocketCents(toCents(t.amount), this.moneyBackEntriesFor(t)));
  }

  /** When money back exceeds the original expense (e.g. split evenly but one
   *  side rounded up), the excess is real profit, not spending. It belongs in
   *  income, not silently floored away by `effectiveExpenseAmount`. */
  reimbursementSurplus(t: Transaction): number {
    if (t.type !== 'expense') return 0;
    return fromCents(surplusCents(toCents(t.amount), this.moneyBackEntriesFor(t)));
  }

  /** Refunded in full, in part, or not at all, counting refund incomes linked from the bank. */
  refundState(t: Transaction): RefundState {
    const linkedRefunds = this.linksFor(t).map(l => linkedEntry(l.income, l.amountCents)).filter(e => e.source === 'refund');
    return refundState(t, moneyBackTotalCents(linkedRefunds));
  }

  /** An income that is money back on some purchase (for templates). */
  isMoneyBackIncome(t: Transaction): boolean {
    return isMoneyBackIncome(t);
  }

  /** A purchase refunded in full: left out of analysis while money back is counted. */
  isFullyRefunded(t: Transaction): boolean {
    return this.refundState(t) === 'full';
  }

  /** The money rules every page totals with, so none of them drift apart. */
  moneyRules(netting: boolean): MoneyRules {
    return {
      netting,
      effectiveExpense: t => this.effectiveExpenseAmount(t),
      reimbursementSurplus: t => this.reimbursementSurplus(t),
      fullyRefunded: t => this.isFullyRefunded(t),
    };
  }

  /** For an income that pays back an expense: that expense's surplus, if any. Surplus
   *  belongs to the expense as a whole (it can come from one or several linked
   *  incomes together), not to any single payment; this just lets a linked
   *  income's own row indicate "this is part of a package that came out ahead." */
  reimbursementSurplusForIncome(income: Transaction): number {
    const ids = new Set(incomeLinks(income).map(l => l.expenseId));
    if (!ids.size) return 0;
    return this.transactions()
      .filter(t => t.id && ids.has(t.id))
      .reduce((total, expense) => total + this.reimbursementSurplus(expense), 0);
  }
}
