import { describe, it, expect } from 'vitest';
import { ME, Transaction } from '../models';
import {
  MoneyRules, totalExpenses, totalIncome, spendingTransactions, incomeTransactions,
  categoryTotals, monthlySeries, monthsBetween, transferTotals, sankeyLinks, sankeyLabel,
  NO_SPLITS, SplitTotals, splitTotals,
} from './reporting';
import { MoneyBackLedger } from './money-back';
import { quickSplit } from './splits';

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

describe('reporting — totals in whole cents', () => {
  it('a thousand 10¢ coffees are exactly $100', () => {
    const txs = Array.from({ length: 1000 }, () => tx({ type: 'expense', amount: 0.1, categoryId: 'coffee' }));
    const r = rulesWith(true);
    expect(totalExpenses(txs, r)).toBe(100);
    expect(categoryTotals(txs, r)).toEqual([{ categoryId: 'coffee', amount: 100 }]);
    expect(monthlySeries(txs, r, ['2026-09'])[0].expenses).toBe(100);
  });

  it('0.1 + 0.2 is 0.3, on every side', () => {
    const txs = [
      tx({ type: 'income', amount: 0.1 }), tx({ type: 'income', amount: 0.2 }),
      tx({ type: 'expense', amount: 0.1 }), tx({ type: 'expense', amount: 0.2 }),
      tx({ type: 'transfer', amount: 0.1, toAccountId: 'b' }), tx({ type: 'transfer', amount: 0.2, toAccountId: 'b' }),
    ];
    const r = rulesWith(true);
    expect(totalIncome(txs, r)).toBe(0.3);
    expect(totalExpenses(txs, r)).toBe(0.3);
    expect(transferTotals(txs).movedIn).toBe(0.3);
    expect(monthlySeries(txs, r, ['2026-09'])[0]).toMatchObject({ income: 0.3, expenses: 0.3, net: 0 });
  });

  it('a total is the sum of its rows as shown, to the cent', () => {
    // An amount with a stray third decimal (an old import) shows as $0.13. Two
    // of them are $0.26 — not $0.25, which adding first and rounding after gives.
    const txs = [
      tx({ type: 'expense', amount: 0.125, categoryId: 'a' }),
      tx({ type: 'expense', amount: 0.125, categoryId: 'b' }),
    ];
    const r = rulesWith(false); // raw amounts (rulesWith's netting rounds them itself)
    expect(categoryTotals(txs, r).map(c => c.amount)).toEqual([0.13, 0.13]);
    expect(totalExpenses(txs, r)).toBe(0.26);
  });

  it('reads 1.005 as $1.01, the way it is shown', () => {
    const txs = [tx({ type: 'income', amount: 1.005 })];
    expect(totalIncome(txs, rulesWith(true))).toBe(1.01);
  });

  it('many small amounts, category rows and months reconcile exactly with the totals', () => {
    const cats = ['a', 'b', 'c', 'd', 'e'];
    const txs = Array.from({ length: 997 }, (_, i) => tx({
      type: i % 7 === 0 ? 'income' : 'expense',
      amount: ((i * 37) % 1000) / 100 + 0.01,
      categoryId: cats[i % cats.length],
      date: `2026-0${7 + (i % 3)}-15`,
    }));
    const r = rulesWith(true);
    const cents = (n: number) => Math.round(n * 100);
    const total = totalExpenses(txs, r);
    expect(categoryTotals(txs, r).reduce((s, c) => s + cents(c.amount), 0)).toBe(cents(total));
    const rows = monthlySeries(txs, r, ['2026-07', '2026-08', '2026-09']);
    expect(rows.reduce((s, m) => s + cents(m.expenses), 0)).toBe(cents(total));
    expect(rows.reduce((s, m) => s + cents(m.income), 0)).toBe(cents(totalIncome(txs, r)));
    for (const m of rows) expect(cents(m.net)).toBe(cents(m.income) - cents(m.expenses));
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

describe('reporting — split bills', () => {
  // The real money-back logic, so linked and recorded money back both count.
  class Ledger extends MoneyBackLedger {
    constructor(public transactions: () => Transaction[]) { super(); }
  }
  const totalsOf = (txs: Transaction[]) => {
    const l = new Ledger(() => txs);
    return splitTotals(txs, t => l.moneyBackEntriesFor(t));
  };
  const bill = (cents: number, who: string[], over: Partial<Transaction> = {}) =>
    tx({ type: 'expense', amount: cents / 100, split: quickSplit(cents, who), ...over });
  const repay = (from: string, cents: number, covers = [from]) =>
    ({ id: `r${from}${cents}`, source: 'repayment' as const, amountCents: cents, date: '2026-09-12', fromPersonId: from, coversPersonIds: covers });
  const identity = (t: SplitTotals) => t.forOthersCents === t.repaidCents + t.owedCents + t.wontBeRepaidCents;

  it('$180 three ways: your share is $60, $120 is owed to you', () => {
    const t = totalsOf([bill(18000, [ME, 'a', 'b'])]);
    expect(t).toEqual({ bills: 1, paidCents: 18000, myShareCents: 6000, forOthersCents: 12000, repaidCents: 0, owedCents: 12000, wontBeRepaidCents: 0 });
  });

  it('one friend repaying for two clears both; what is left is your share', () => {
    const t = totalsOf([bill(18000, [ME, 'a', 'b'], { moneyBack: [repay('a', 12000, ['a', 'b'])] })]);
    expect(t.repaidCents).toBe(12000);
    expect(t.owedCents).toBe(0);
    expect(identity(t)).toBe(true);
  });

  it('a linked bank repayment counts the same as one recorded by hand', () => {
    const dinner = bill(18000, [ME, 'a', 'b'], { id: 'dinner' });
    const zelle = tx({ type: 'income', amount: 60, reimbursesId: 'dinner', moneyBackInfo: { source: 'repayment', fromPersonId: 'a' } });
    const t = totalsOf([dinner, zelle]);
    expect(t.repaidCents).toBe(6000);
    expect(t.owedCents).toBe(6000);
  });

  it('"won\'t be repaid" leaves "owed to you" but is still counted', () => {
    const t = totalsOf([bill(18000, [ME, 'a', 'b'], { split: { ...quickSplit(18000, [ME, 'a', 'b']), closedPersonIds: ['b'] } })]);
    expect(t.owedCents).toBe(6000);
    expect(t.wontBeRepaidCents).toBe(6000);
    expect(identity(t)).toBe(true);
  });

  it('paid for others with no share of your own', () => {
    const t = totalsOf([bill(9000, ['a', 'b'])]);
    expect(t.myShareCents).toBe(0);
    expect(t.forOthersCents).toBe(9000);
    expect(t.owedCents).toBe(9000);
  });

  it('a refund on a split bill shrinks every share, yours included', () => {
    const t = totalsOf([bill(24000, [ME, 'a', 'b', 'c'], {
      moneyBack: [{ id: 'f', source: 'refund', amountCents: 4000, date: '2026-09-11' }],
    })]);
    expect(t.myShareCents).toBe(5000);
    expect(t.forOthersCents).toBe(15000);
  });

  it('adds up across bills, to the cent, and ignores everything that is not a split expense', () => {
    const t = totalsOf([
      bill(10000, [ME, 'a', 'b']),           // 33.34 / 33.33 / 33.33
      bill(5000, [ME, 'a'], { moneyBack: [repay('a', 1000)] }),
      tx({ type: 'expense', amount: 99 }),   // not split
      tx({ type: 'expense', amount: 50, isInternalTransfer: true, split: quickSplit(5000, [ME, 'a']) }),
      tx({ type: 'income', amount: 40 }),
    ]);
    expect(t.bills).toBe(2);
    expect(t.paidCents).toBe(15000);
    expect(t.myShareCents + t.forOthersCents).toBe(15000);
    expect(t.repaidCents).toBe(1000);
    expect(identity(t)).toBe(true);
  });

  it('partly paid: Alex paid $60 of a $240 bill, so only Ben and Cara owe you', () => {
    const split = { ...quickSplit(24000, [ME, 'a', 'b', 'c']), payments: [{ personId: ME, amountCents: 18000 }, { personId: 'a', amountCents: 6000 }] };
    const t = totalsOf([bill(18000, [ME], { split })]);
    expect(t.paidCents).toBe(18000);
    expect(t.myShareCents).toBe(6000);
    expect(t.forOthersCents).toBe(12000);
    expect(t.owedCents).toBe(12000);
  });

  it('nothing split: all zero', () => {
    expect(totalsOf([tx({ type: 'expense', amount: 20 })])).toEqual(NO_SPLITS);
  });
});
