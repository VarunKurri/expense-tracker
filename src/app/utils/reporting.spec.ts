import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import {
  MoneyRules, totalExpenses, totalIncome, spendingTransactions, incomeTransactions,
  categoryTotals, monthlySeries, monthsBetween, transferTotals, sankeyLinks, sankeyLabel,
} from './reporting';

/** Minimal transaction factory — only the fields the reporting math reads. */
function tx(over: Partial<Transaction> & { type: Transaction['type']; amount: number }): Transaction {
  return {
    id: over.id ?? Math.random().toString(36).slice(2),
    date: '2026-09-10',
    createdAt: 0, updatedAt: 0,
    ...over,
  } as Transaction;
}

/**
 * Stand-in for TransactionService's reimbursement math, with the same shape:
 * an expense's effective cost is its amount minus linked reimbursements, floored
 * at zero, and anything beyond that is surplus.
 */
function rulesWith(netting: boolean, reimbursed: Record<string, number> = {}): MoneyRules {
  return {
    netting,
    effectiveExpense: t => Math.max(0, Math.round((t.amount - (reimbursed[t.id!] ?? 0)) * 100) / 100),
    reimbursementSurplus: t => Math.max(0, Math.round(((reimbursed[t.id!] ?? 0) - t.amount) * 100) / 100),
  };
}

describe('reporting — spending and income selection', () => {
  it('excludes internal transfers from both sides', () => {
    const txs = [
      tx({ type: 'expense', amount: 100 }),
      tx({ type: 'expense', amount: 500, isInternalTransfer: true }),
      tx({ type: 'income',  amount: 200 }),
      tx({ type: 'income',  amount: 500, isInternalTransfer: true }),
    ];
    const r = rulesWith(true);
    expect(spendingTransactions(txs)).toHaveLength(1);
    expect(incomeTransactions(txs, r)).toHaveLength(1);
    expect(totalExpenses(txs, r)).toBe(100);
    expect(totalIncome(txs, r)).toBe(200);
  });

  it('with netting on, a reimbursing income is not income and reduces the expense', () => {
    const meal = tx({ id: 'meal', type: 'expense', amount: 100 });
    const payback = tx({ type: 'income', amount: 40, reimbursesId: 'meal' });
    const r = rulesWith(true, { meal: 40 });
    expect(totalExpenses([meal, payback], r)).toBe(60);
    expect(totalIncome([meal, payback], r)).toBe(0);
  });

  it('with netting off, everything counts exactly as recorded', () => {
    const meal = tx({ id: 'meal', type: 'expense', amount: 100 });
    const payback = tx({ type: 'income', amount: 40, reimbursesId: 'meal' });
    const r = rulesWith(false, { meal: 40 });
    expect(totalExpenses([meal, payback], r)).toBe(100);
    expect(totalIncome([meal, payback], r)).toBe(40);
  });

  it('counts reimbursement over the original amount as income, not negative spending', () => {
    // The $469.40 / $475 overpayment case from ROADMAP part 44.
    const meal = tx({ id: 'meal', type: 'expense', amount: 469.4 });
    const payback = tx({ type: 'income', amount: 475, reimbursesId: 'meal' });
    const r = rulesWith(true, { meal: 475 });
    expect(totalExpenses([meal, payback], r)).toBe(0);
    expect(totalIncome([meal, payback], r)).toBe(5.6);
  });
});

describe('reporting — category totals', () => {
  it('sorts largest first and pools uncategorised under __none__', () => {
    const txs = [
      tx({ type: 'expense', amount: 10, categoryId: 'food' }),
      tx({ type: 'expense', amount: 50, categoryId: 'rent' }),
      tx({ type: 'expense', amount: 5 }),
      tx({ type: 'expense', amount: 20, categoryId: 'food' }),
    ];
    expect(categoryTotals(txs, rulesWith(true))).toEqual([
      { categoryId: 'rent',     amount: 50 },
      { categoryId: 'food',     amount: 30 },
      { categoryId: '__none__', amount: 5 },
    ]);
  });

  it('category totals sum to the reported expense total', () => {
    const txs = [
      tx({ type: 'expense', amount: 12.34, categoryId: 'a' }),
      tx({ type: 'expense', amount: 7.66,  categoryId: 'b' }),
      tx({ type: 'expense', amount: 80,    isInternalTransfer: true }),
    ];
    const r = rulesWith(true);
    const sum = categoryTotals(txs, r).reduce((s, c) => s + c.amount, 0);
    expect(Math.round(sum * 100) / 100).toBe(totalExpenses(txs, r));
  });
});

describe('reporting — monthly series', () => {
  it('emits every requested month, including empty ones', () => {
    const rows = monthlySeries([tx({ type: 'expense', amount: 10, date: '2026-08-04' })],
      rulesWith(true), ['2026-07', '2026-08', '2026-09']);
    expect(rows.map(r => r.month)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(rows.map(r => r.expenses)).toEqual([0, 10, 0]);
  });

  it('net is income minus expenses per month', () => {
    const rows = monthlySeries([
      tx({ type: 'income',  amount: 500, date: '2026-09-01' }),
      tx({ type: 'expense', amount: 120, date: '2026-09-15' }),
    ], rulesWith(true), ['2026-09']);
    expect(rows[0]).toMatchObject({ income: 500, expenses: 120, net: 380 });
  });

  it('monthly totals reconcile with the period totals', () => {
    const txs = [
      tx({ type: 'income',  amount: 300, date: '2026-08-02' }),
      tx({ type: 'expense', amount: 75,  date: '2026-08-20' }),
      tx({ type: 'income',  amount: 150, date: '2026-09-03' }),
      tx({ type: 'expense', amount: 42,  date: '2026-09-11' }),
      tx({ type: 'expense', amount: 999, date: '2026-09-11', isInternalTransfer: true }),
    ];
    const r = rulesWith(true);
    const rows = monthlySeries(txs, r, ['2026-08', '2026-09']);
    const sumIn = rows.reduce((s, x) => s + x.income, 0);
    const sumOut = rows.reduce((s, x) => s + x.expenses, 0);
    expect(sumIn).toBe(totalIncome(txs, r));
    expect(sumOut).toBe(totalExpenses(txs, r));
  });
});

describe('reporting — monthsBetween', () => {
  it('spans a year boundary', () => {
    expect(monthsBetween('2026-11-05', '2027-02-20'))
      .toEqual(['2026-11', '2026-12', '2027-01', '2027-02']);
  });
  it('returns a single month when start and end share one', () => {
    expect(monthsBetween('2026-09-01', '2026-09-30')).toEqual(['2026-09']);
  });
  it('returns nothing for an open range', () => {
    expect(monthsBetween('', '2026-09-30')).toEqual([]);
  });
  it('returns nothing when the range runs backwards', () => {
    // A custom picker can hand us end < start; the charts should render empty
    // rather than loop or invent months.
    expect(monthsBetween('2026-11-05', '2026-02-20')).toEqual([]);
  });
});

describe('reporting — transfers', () => {
  it('reports money moved without counting it as income or spending', () => {
    const txs = [
      tx({ type: 'transfer', amount: 250, fromAccountId: 'a', toAccountId: 'b' }),
      tx({ type: 'expense',  amount: 90,  isInternalTransfer: true }),
      tx({ type: 'income',   amount: 90,  isInternalTransfer: true }),
      tx({ type: 'expense',  amount: 30 }),
    ];
    const t = transferTotals(txs);
    expect(t.count).toBe(3);
    expect(t.movedIn).toBe(340);
    expect(t.movedOut).toBe(90);
    // ...and none of it reaches the spending total.
    expect(totalExpenses(txs, rulesWith(true))).toBe(30);
  });
});

describe('reporting — sankey', () => {
  it('routes sources through a single pool to categories', () => {
    const links = sankeyLinks(
      [{ name: 'Salary', amount: 300 }],
      [{ name: 'Rent', amount: 200 }, { name: 'Food', amount: 100 }],
    );
    expect(links).toHaveLength(3);
    expect(links[0]).toEqual({ from: 'Salary', to: 'Cash flow', flow: 300 });
    expect(links.filter(l => l.from === 'Cash flow')).toHaveLength(2);
  });

  it('keeps the graph acyclic when a name appears on both sides', () => {
    // Without disambiguation this is a cycle and the chart plugin throws.
    const links = sankeyLinks([{ name: 'Rent', amount: 50 }], [{ name: 'Rent', amount: 50 }]);
    const froms = new Set(links.map(l => l.from));
    const tos = new Set(links.map(l => l.to));
    expect([...froms].some(f => tos.has(f) && f !== 'Cash flow')).toBe(false);
    expect(sankeyLabel(links[1].to)).toBe('Rent');
  });

  it('drops zero and negative flows', () => {
    expect(sankeyLinks([{ name: 'A', amount: 0 }], [{ name: 'B', amount: -5 }])).toEqual([]);
  });
});
