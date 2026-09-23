import { Transaction } from '../models';

/**
 * Shared money aggregation for the Analysis and Reports pages.
 *
 * These were previously computed()s living inside `analysis.ts`. They are pulled
 * out here as pure functions so Reports produces *identical* numbers rather than
 * a second, subtly different implementation — the two pages showing different
 * totals for the same period would be a bug the user could not diagnose.
 *
 * The rules encoded here were established across ROADMAP phases 8 and 11 and are
 * easy to get wrong:
 *
 *  - **Internal transfers never count.** A credit-card payment is a real
 *    per-account movement but is neither spending nor earning app-wide; counting
 *    it inflates both sides.
 *  - **Reimbursement netting is governed by one flag.** With netting on, an
 *    income that reimburses an expense is not income — it reduces that expense's
 *    true cost instead. With it off, everything counts exactly as recorded.
 *  - **Surplus is real income.** When reimbursements exceed the original expense,
 *    the excess is profit rather than being silently floored away.
 *
 * `effectiveExpense` and `reimbursementSurplus` are injected rather than imported
 * so these stay pure and unit-testable without a Firestore-backed service.
 */
export interface MoneyRules {
  /** The "exclude refunded" toggle, which also governs reimbursement netting. */
  netting: boolean;
  /** An expense's cost after linked reimbursements. */
  effectiveExpense: (t: Transaction) => number;
  /** Reimbursements beyond the expense's own amount. */
  reimbursementSurplus: (t: Transaction) => number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Expenses that count as spending. */
export function spendingTransactions(txs: Transaction[]): Transaction[] {
  return txs.filter(t => t.type === 'expense' && !t.isInternalTransfer);
}

/** Incomes that count as earning. */
export function incomeTransactions(txs: Transaction[], rules: MoneyRules): Transaction[] {
  return txs.filter(t =>
    t.type === 'income' && !t.isInternalTransfer && (!rules.netting || !t.reimbursesId)
  );
}

/** An expense's contribution to spending under the current netting rule. */
export function expenseAmount(t: Transaction, rules: MoneyRules): number {
  return rules.netting ? rules.effectiveExpense(t) : t.amount;
}

export function totalExpenses(txs: Transaction[], rules: MoneyRules): number {
  return round2(spendingTransactions(txs).reduce((s, t) => s + expenseAmount(t, rules), 0));
}

export function totalIncome(txs: Transaction[], rules: MoneyRules): number {
  const direct = incomeTransactions(txs, rules).reduce((s, t) => s + t.amount, 0);
  if (!rules.netting) return round2(direct);
  const surplus = spendingTransactions(txs)
    .reduce((s, t) => s + rules.reimbursementSurplus(t), 0);
  return round2(direct + surplus);
}

export interface CategoryTotal { categoryId: string; amount: number; }

/**
 * Spending per category, largest first. `__none__` collects uncategorised.
 * Callers decide how many slots to show and fold the tail into "Other" — the
 * category colour ramp is only eight hues deep.
 */
export function categoryTotals(txs: Transaction[], rules: MoneyRules): CategoryTotal[] {
  const byCat = new Map<string, number>();
  for (const t of spendingTransactions(txs)) {
    const key = t.categoryId || '__none__';
    byCat.set(key, (byCat.get(key) || 0) + expenseAmount(t, rules));
  }
  return [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
    .sort((a, b) => b.amount - a.amount);
}

/** Income per category, largest first — the Income report's breakdown. */
export function incomeTotals(txs: Transaction[], rules: MoneyRules): CategoryTotal[] {
  const byCat = new Map<string, number>();
  for (const t of incomeTransactions(txs, rules)) {
    const key = t.categoryId || '__none__';
    byCat.set(key, (byCat.get(key) || 0) + t.amount);
  }
  return [...byCat.entries()]
    .map(([categoryId, amount]) => ({ categoryId, amount: round2(amount) }))
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
 * Months with no activity are still emitted so the series has no gaps — a
 * missing month in a bar chart reads as "no data available" rather than "zero",
 * which is a different claim.
 */
export function monthlySeries(
  txs: Transaction[], rules: MoneyRules, months: string[]
): MonthRow[] {
  const acc = new Map<string, { income: number; expenses: number }>();
  for (const m of months) acc.set(m, { income: 0, expenses: 0 });

  for (const t of txs) {
    if (t.isInternalTransfer) continue;
    const key = t.date.slice(0, 7);
    const entry = acc.get(key);
    if (!entry) continue;
    if (t.type === 'income' && (!rules.netting || !t.reimbursesId)) {
      entry.income += t.amount;
    }
    if (t.type === 'expense') {
      entry.expenses += expenseAmount(t, rules);
      if (rules.netting) entry.income += rules.reimbursementSurplus(t);
    }
  }

  return months.map(month => {
    const d = acc.get(month)!;
    const [y, m] = month.split('-').map(Number);
    const income = round2(d.income), expenses = round2(d.expenses);
    return {
      month,
      label: new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' }),
      income, expenses,
      net: round2(income - expenses),
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
  let movedIn = 0, movedOut = 0, count = 0;
  for (const t of txs) {
    const isTransfer = t.type === 'transfer' || t.isInternalTransfer;
    if (!isTransfer) continue;
    count++;
    if (t.type === 'income' || t.toAccountId) movedIn += t.amount;
    else movedOut += t.amount;
  }
  return { movedIn: round2(movedIn), movedOut: round2(movedOut), count };
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
