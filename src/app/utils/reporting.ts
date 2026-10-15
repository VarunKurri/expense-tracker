import { MoneyBackEntry, Transaction } from '../models';
import { isFullyRefunded, isMoneyBackIncome } from './money-back';
import { billPositions, splitStatus } from './splits';
import { ME } from '../models';
import { fromCents, toCents } from './money';

/**
 * Shared money aggregation for the Analysis and Reports pages.
 *
 * These were previously computed()s living inside `analysis.ts`. They are pulled
 * out here as pure functions so Reports produces *identical* numbers rather than
 * a second, subtly different implementation. The two pages showing different
 * totals for the same period would be a bug the user could not diagnose.
 *
 * The rules encoded here were established across ROADMAP phases 8 and 11 and are
 * easy to get wrong:
 *
 *  - **Internal transfers never count.** A credit-card payment is a real
 *    per-account movement but is neither spending nor earning app-wide; counting
 *    it inflates both sides.
 *  - **Reimbursement netting is governed by one flag.** With netting on, an
 *    income that reimburses an expense is not income; it reduces that expense's
 *    true cost instead. With it off, everything counts exactly as recorded.
 *  - **Surplus is real income.** When reimbursements exceed the original expense,
 *    the excess is profit rather than being silently floored away.
 *
 * `effectiveExpense` and `reimbursementSurplus` are injected rather than imported
 * so these stay pure and unit-testable without a Firestore-backed service.
 *
 * Every sum runs in integer cents (`toCents` on each amount, `fromCents` once
 * at the end) so a month of $0.10 coffees adds up to exactly what it says,
 * rather than to whatever a float drifts to. The results are still in dollars.
 */
export interface MoneyRules {
  /** The "Count money back" toggle: on, refunds and repayments are netted off. */
  netting: boolean;
  /** An expense's cost after linked reimbursements. */
  effectiveExpense: (t: Transaction) => number;
  /** Reimbursements beyond the expense's own amount. */
  reimbursementSurplus: (t: Transaction) => number;
  /**
   * Whether a purchase was refunded in full (left out entirely while netting).
   * Defaults to the pure check, which can't see refund incomes linked from the
   * bank. Pages pass `TransactionService.isFullyRefunded`, which can.
   */
  fullyRefunded?: (t: Transaction) => boolean;
}

/** A fully refunded purchase, left out while money back is being counted. */
export function refundedOut(t: Transaction, rules: MoneyRules): boolean {
  return rules.netting && (rules.fullyRefunded ?? isFullyRefunded)(t);
}

/** Expenses that count as spending. */
export function spendingTransactions(txs: Transaction[]): Transaction[] {
  return txs.filter(t => t.type === 'expense' && !t.isInternalTransfer);
}

/** Incomes that count as earning. */
export function incomeTransactions(txs: Transaction[], rules: MoneyRules): Transaction[] {
  return txs.filter(t =>
    t.type === 'income' && !t.isInternalTransfer && (!rules.netting || !isMoneyBackIncome(t))
  );
}

/** An expense's contribution to spending under the current netting rule. */
export function expenseAmount(t: Transaction, rules: MoneyRules): number {
  return rules.netting ? rules.effectiveExpense(t) : t.amount;
}

/** Add up dollar amounts in whole cents. */
function sumToCents<T>(items: T[], amount: (item: T) => number): number {
  return items.reduce((total, item) => total + toCents(amount(item)), 0);
}

export function totalExpenses(txs: Transaction[], rules: MoneyRules): number {
  return fromCents(sumToCents(spendingTransactions(txs), t => expenseAmount(t, rules)));
}

export function totalIncome(txs: Transaction[], rules: MoneyRules): number {
  const direct = sumToCents(incomeTransactions(txs, rules), t => t.amount);
  if (!rules.netting) return fromCents(direct);
  const surplus = sumToCents(spendingTransactions(txs), t => rules.reimbursementSurplus(t));
  return fromCents(direct + surplus);
}

export interface CategoryTotal { categoryId: string; amount: number; }

/**
 * Spending per category, largest first. `__none__` collects uncategorised.
 * Callers decide how many slots to show and fold the tail into "Other", as the
 * category colour ramp is only eight hues deep.
 */
export function categoryTotals(txs: Transaction[], rules: MoneyRules): CategoryTotal[] {
  const byCat = new Map<string, number>();
  for (const t of spendingTransactions(txs)) {
    const key = t.categoryId || '__none__';
    byCat.set(key, (byCat.get(key) || 0) + toCents(expenseAmount(t, rules)));
  }
  return [...byCat.entries()]
    .map(([categoryId, cents]) => ({ categoryId, amount: fromCents(cents) }))
    .sort((a, b) => b.amount - a.amount);
}

/** Income per category, largest first: the Income report's breakdown. */
export function incomeTotals(txs: Transaction[], rules: MoneyRules): CategoryTotal[] {
  const byCat = new Map<string, number>();
  for (const t of incomeTransactions(txs, rules)) {
    const key = t.categoryId || '__none__';
    byCat.set(key, (byCat.get(key) || 0) + toCents(t.amount));
  }
  return [...byCat.entries()]
    .map(([categoryId, cents]) => ({ categoryId, amount: fromCents(cents) }))
    .sort((a, b) => b.amount - a.amount);
}

export interface MonthRow {
  month: string;      // YYYY-MM
  label: string;      // "Sep"
  income: number;
  expenses: number;
  net: number;
}

/**
 * Month-by-month income, spending and net, oldest first.
 *
 * Months with no activity are still emitted so the series has no gaps. A
 * missing month in a bar chart reads as "no data available" rather than "zero",
 * which is a different claim.
 */
export function monthlySeries(
  txs: Transaction[], rules: MoneyRules, months: string[]
): MonthRow[] {
  // In cents.
  const acc = new Map<string, { income: number; expenses: number }>();
  for (const m of months) acc.set(m, { income: 0, expenses: 0 });

  for (const t of txs) {
    if (t.isInternalTransfer) continue;
    const key = t.date.slice(0, 7);
    const entry = acc.get(key);
    if (!entry) continue;
    if (t.type === 'income' && (!rules.netting || !isMoneyBackIncome(t))) {
      entry.income += toCents(t.amount);
    }
    if (t.type === 'expense') {
      entry.expenses += toCents(expenseAmount(t, rules));
      if (rules.netting) entry.income += toCents(rules.reimbursementSurplus(t));
    }
  }

  return months.map(month => {
    const d = acc.get(month)!;
    const [y, m] = month.split('-').map(Number);
    return {
      month,
      label: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
      income: fromCents(d.income),
      expenses: fromCents(d.expenses),
      net: fromCents(d.income - d.expenses),
    };
  });
}

/** The list of YYYY-MM keys spanned by a date range, oldest first. */
export function monthsBetween(start: string, end: string): string[] {
  if (!start || !end) return [];
  const [sy, sm] = start.slice(0, 7).split('-').map(Number);
  const [ey, em] = end.slice(0, 7).split('-').map(Number);
  const out: string[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); m++) {
    if (m > 12) { m = 1; y++; }
    if (y > ey || (y === ey && m > em)) break;
    out.push(`${y}-${String(m).padStart(2, '0')}`);
  }
  return out;
}

export interface TransferTotals { movedIn: number; movedOut: number; count: number; }

/**
 * Money moved between the user's own accounts.
 *
 * Deliberately separate from income/spending: these are the transactions the
 * other reports exclude, surfaced on their own so they are visible rather than
 * merely missing.
 */
export function transferTotals(txs: Transaction[]): TransferTotals {
  let movedIn = 0, movedOut = 0, count = 0; // in cents
  for (const t of txs) {
    const isTransfer = t.type === 'transfer' || t.isInternalTransfer;
    if (!isTransfer) continue;
    count++;
    if (t.type === 'income' || t.toAccountId) movedIn += toCents(t.amount);
    else movedOut += toCents(t.amount);
  }
  return { movedIn: fromCents(movedIn), movedOut: fromCents(movedOut), count };
}

/**
 * Split bills in a period, in integer cents: what you paid, what was yours,
 * and what was other people's, and how much of that has come back.
 *
 * Spending is always out of pocket (what you paid − money back), so a friend's
 * unpaid share sits in your spending until it's repaid. These figures say how
 * much of your spending that is.
 *
 * Always true: `forOthersCents = repaidCents + owedCents + wontBeRepaidCents`.
 */
export interface SplitTotals {
  /** Split bills in the period. */
  bills: number;
  /** What you paid the merchant on them. */
  paidCents: number;
  /** Your part of them, after any refund. */
  myShareCents: number;
  /** Other people's shares that you covered. */
  forOthersCents: number;
  /** How much of that they've paid back. */
  repaidCents: number;
  /** Still owed to you. */
  owedCents: number;
  /** Marked "won't be repaid", so it stays in your spending for good. */
  wontBeRepaidCents: number;
}

export const NO_SPLITS: SplitTotals = {
  bills: 0, paidCents: 0, myShareCents: 0, forOthersCents: 0, repaidCents: 0, owedCents: 0, wontBeRepaidCents: 0,
};

/**
 * Totals for the split bills among `txs` (already filtered to a period).
 * Per-bill arithmetic is `splitStatus`, the same numbers the transaction view
 * and the Shared page show, so the three can't disagree.
 *
 * A bill in a group (`inGroup`) is settled with the group, not person by
 * person, so for it "for others" is simply what you paid beyond your share,
 * and "paid back" is the money back on it, which is where a group puts what
 * people pay you (`spreadReceived`). Either way the figures say how much of
 * your spending is other people's, which is what these totals are for.
 */
export function splitTotals(
  txs: Transaction[], moneyBackFor: (t: Transaction) => MoneyBackEntry[],
  inGroup: (t: Transaction) => boolean = () => false,
): SplitTotals {
  return addUpSplitBills(splitBills(txs, moneyBackFor, inGroup));
}

/** One split bill in a period, the figures `SplitTotals` adds up. */
export interface SplitBillRow extends Omit<SplitTotals, 'bills'> {
  tx: Transaction;
  /** Set when the bill is in a group that still exists. */
  groupId?: string;
}

/** Totals of some bill rows: always what `splitTotals` says for the same bills. */
export function addUpSplitBills(rows: SplitBillRow[]): SplitTotals {
  const totals = { ...NO_SPLITS, bills: rows.length };
  for (const r of rows) {
    totals.paidCents += r.paidCents;
    totals.myShareCents += r.myShareCents;
    totals.forOthersCents += r.forOthersCents;
    totals.repaidCents += r.repaidCents;
    totals.owedCents += r.owedCents;
    totals.wontBeRepaidCents += r.wontBeRepaidCents;
  }
  return totals;
}

/**
 * The split bills among `txs`, one row each, newest first: what `splitTotals`
 * adds up, for a report that lists them. "Not back yet" is only ever other
 * people's shares; your own share is never expected back.
 */
export function splitBills(
  txs: Transaction[], moneyBackFor: (t: Transaction) => MoneyBackEntry[],
  inGroup: (t: Transaction) => boolean = () => false,
): SplitBillRow[] {
  const rows: SplitBillRow[] = [];
  for (const t of spendingTransactions(txs)) {
    if (!t.split) continue;
    const moneyBack = moneyBackFor(t);
    const status = splitStatus(t.split, moneyBack);
    const row: SplitBillRow = {
      tx: t, paidCents: status.myPaidCents, myShareCents: status.myShareCents,
      forOthersCents: 0, repaidCents: 0, owedCents: 0, wontBeRepaidCents: 0,
    };
    if (inGroup(t)) {
      // Settled with the group: what you paid beyond your share, and the money back on it.
      const mine = billPositions(t.split, moneyBack).positions.find(p => p.personId === ME)?.netCents ?? 0;
      const forOthers = Math.max(0, mine);
      const back = moneyBack.filter(e => e.source === 'repayment').reduce((sum, e) => sum + e.amountCents, 0);
      row.groupId = t.split.groupId;
      row.forOthersCents = forOthers;
      row.repaidCents = Math.min(forOthers, back);
      row.owedCents = forOthers - row.repaidCents;
    } else {
      for (const p of status.people) {
        row.forOthersCents += p.dueToMeCents;
        row.repaidCents += p.repaidCents;
        if (p.state === 'closed') row.wontBeRepaidCents += p.outstandingCents;
        else row.owedCents += p.outstandingCents;
      }
    }
    rows.push(row);
  }
  return rows.sort((a, b) => b.tx.date.localeCompare(a.tx.date));
}

/** One payment back on some split bills: a bank payment, or cash recorded by hand. */
export interface SplitPaymentRow {
  /** Who sent it, when it says. */
  fromPersonId?: string;
  date: string;
  /** What came back on these bills (a payment can also cover bills outside them). */
  amountCents: number;
  /** The income it came as, when it's a bank payment. */
  incomeId?: string;
  note?: string;
  /** The bills it paid back, by transaction id. */
  billIds: string[];
}

/**
 * The money that came back on some split bills, one row per payment, newest
 * first. A payment spread over several bills (one Zelle for three dinners, or
 * a group repayment) is gathered back into one row, as the group page does.
 * Refunds aren't listed: they make the bill smaller rather than paying anyone back.
 */
export function splitPayments(rows: SplitBillRow[], moneyBackFor: (t: Transaction) => MoneyBackEntry[]): SplitPaymentRow[] {
  const byKey = new Map<string, SplitPaymentRow>();
  for (const r of rows) {
    moneyBackFor(r.tx).filter(e => e.source === 'repayment').forEach((e, i) => {
      const entryId = (e as { id?: string }).id;
      const key = e.incomeId ? `i:${e.incomeId}` : e.batchId ? `b:${e.batchId}` : `e:${r.tx.id}:${entryId ?? i}`;
      const from = e.fromPersonId ?? (e.coversPersonIds?.length === 1 ? e.coversPersonIds[0] : undefined);
      const row = byKey.get(key) ?? {
        date: e.date, amountCents: 0, billIds: [],
        ...(from ? { fromPersonId: from } : {}),
        ...(e.incomeId ? { incomeId: e.incomeId } : {}),
        ...((e as { note?: string }).note ? { note: (e as { note?: string }).note } : {}),
      };
      row.amountCents += e.amountCents;
      if (r.tx.id && !row.billIds.includes(r.tx.id)) row.billIds.push(r.tx.id);
      byKey.set(key, row);
    });
  }
  return [...byKey.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export interface SankeyLink { from: string; to: string; flow: number; }

/**
 * Income sources → a single pooled node → spending categories.
 *
 * Origin's cash-flow Sankey has exactly this shape. The middle node is what
 * makes it readable: without it every source would fan to every category and the
 * ribbons would be meaningless, since the underlying data says nothing about
 * which income paid for which expense.
 *
 * Chart.js's sankey plugin throws on a cyclic graph, so a name appearing on both
 * sides (a category used for both income and spending) would break the chart.
 * Outgoing nodes are suffixed to keep the two sides disjoint; `sankeyLabel`
 * strips it again for display.
 */
export function sankeyLinks(
  sources: { name: string; amount: number }[],
  categories: { name: string; amount: number }[],
  poolLabel = 'Cash flow',
): SankeyLink[] {
  const links: SankeyLink[] = [];
  for (const s of sources) {
    if (s.amount > 0) links.push({ from: s.name, to: poolLabel, flow: s.amount });
  }
  for (const c of categories) {
    if (c.amount > 0) links.push({ from: poolLabel, to: `${c.name}​`, flow: c.amount });
  }
  return links;
}

/** Strips the zero-width marker `sankeyLinks` adds to outgoing node names. */
export function sankeyLabel(node: string): string {
  return node.replace(/​$/, '');
}
