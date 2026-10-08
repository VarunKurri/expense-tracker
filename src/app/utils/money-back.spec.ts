import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import { filterForAnalysis } from './analysis-filter';
import { budgetSpent } from './budgets';
import {
  MoneyBackLedger, fullRefundEntry, isFullyRefunded, refundState, refundedPatch, untrackedEntries,
} from './money-back';
import { totalExpenses, totalIncome } from './reporting';

class Ledger extends MoneyBackLedger {
  constructor(public transactions: () => Transaction[]) { super(); }
}
const ledgerOf = (txs: Transaction[]) => new Ledger(() => txs);

let n = 0;
const tx = (t: Partial<Transaction>): Transaction => ({
  id: `t${++n}`, type: 'expense', amount: 0, date: '2026-10-02', createdAt: 0, updatedAt: 0,
  accountId: 'a', categoryId: 'dining', ...t,
});

describe('the merged model, one expense at a time', () => {
  it('nothing back: out of pocket is the amount', () => {
    const e = tx({ amount: 80 });
    const l = ledgerOf([e]);
    expect(l.moneyBackFor(e)).toBe(0);
    expect(l.effectiveExpenseAmount(e)).toBe(80);
    expect(l.refundState(e)).toBe('none');
  });

  it('a partial store refund (untracked) is netted, and the purchase is partly refunded', () => {
    const e = tx({ amount: 80, moneyBack: [{ id: 'r', source: 'refund', amountCents: 4000, date: '2026-10-05' }] });
    const l = ledgerOf([e]);
    expect(l.effectiveExpenseAmount(e)).toBe(40);
    expect(l.refundState(e)).toBe('partial');
    expect(l.isFullyRefunded(e)).toBe(false);
  });

  it('a repayment does not make a purchase "refunded"', () => {
    const e = tx({ amount: 80, moneyBack: [{ id: 'p', source: 'repayment', amountCents: 8000, date: '2026-10-05' }] });
    const l = ledgerOf([e]);
    expect(l.effectiveExpenseAmount(e)).toBe(0);
    expect(l.refundState(e)).toBe('none');
  });

  it('tracked and untracked money back add up, each counted once', () => {
    const e = tx({ amount: 120, moneyBack: [{ id: 'c', source: 'repayment', amountCents: 3000, date: '2026-10-03' }] });
    const venmo = tx({ type: 'income', amount: 50, reimbursesId: e.id });
    const l = ledgerOf([e, venmo]);
    expect(l.moneyBackFor(e)).toBe(80);
    expect(l.effectiveExpenseAmount(e)).toBe(40);
    expect(l.reimbursementSurplus(e)).toBe(0);
  });

  it('money back beyond the purchase is surplus', () => {
    const e = tx({ amount: 30 });
    const l = ledgerOf([e, tx({ type: 'income', amount: 35, reimbursesId: e.id })]);
    expect(l.effectiveExpenseAmount(e)).toBe(0);
    expect(l.reimbursementSurplus(e)).toBe(5);
  });

  it('links made before refunds existed read as repayments', () => {
    const e = tx({ amount: 80 });
    const old = tx({ type: 'income', amount: 80, reimbursesId: e.id });
    const l = ledgerOf([e, old]);
    expect(l.moneyBackEntriesFor(e)[0].source).toBe('repayment');
    expect(l.refundState(e)).toBe('none');
  });

  it('works in cents: no float drift', () => {
    const e = tx({ amount: 0.3 });
    const l = ledgerOf([e, tx({ type: 'income', amount: 0.1, reimbursesId: e.id }), tx({ type: 'income', amount: 0.2, reimbursesId: e.id })]);
    expect(l.effectiveExpenseAmount(e)).toBe(0);
    expect(l.reimbursementSurplus(e)).toBe(0);
  });
});

describe('scenario 9: legacy "Mark as refunded" keeps its totals', () => {
  const legacy = () => tx({ amount: 56.84, refunded: true, merchant: 'Walmart' });

  it('reads as one full refund, and the pure check sees it too (loans use that)', () => {
    const t = legacy();
    expect(untrackedEntries(t)).toEqual([{ source: 'refund', amountCents: 5684, date: t.date }]);
    expect(refundState(t)).toBe('full');
    expect(isFullyRefunded(t)).toBe(true);
    expect(ledgerOf([t]).effectiveExpenseAmount(t)).toBe(0);
  });

  it('Analysis, Reports and Budgets totals are what they were before the merge', () => {
    const dinner = tx({ amount: 120 });
    const payback = tx({ type: 'income', amount: 80, reimbursesId: dinner.id });
    const salary = tx({ type: 'income', amount: 1000, categoryId: 'pay' });
    const old = legacy();
    const txs = [dinner, payback, salary, old];
    const l = ledgerOf(txs);

    // Counting money back: the refunded purchase drops out, the dinner is netted,
    // and the payback is not income — exactly the old "Excluding refunded" result.
    const counted = filterForAnalysis(txs, { excludeRefunded: true, isRefunded: t => l.isFullyRefunded(t) });
    expect(counted).not.toContain(old);
    expect(totalExpenses(counted, l.moneyRules(true))).toBe(40);
    expect(totalIncome(counted, l.moneyRules(true))).toBe(1000);
    expect(budgetSpent(txs, 'dining', '2026-10', l.moneyRules(true))).toBe(40);

    // Everything as recorded: unchanged too.
    const all = filterForAnalysis(txs, { excludeRefunded: false });
    expect(totalExpenses(all, l.moneyRules(false))).toBe(176.84);
    expect(totalIncome(all, l.moneyRules(false))).toBe(1080);
    expect(budgetSpent(txs, 'dining', '2026-10', l.moneyRules(false))).toBe(176.84);
  });

  it('a new full refund entry stands in for the legacy flag, without doubling', () => {
    const t = { ...legacy(), moneyBack: [fullRefundEntry(legacy())] };
    expect(untrackedEntries(t)).toHaveLength(1);
  });
});

describe('scenario 10: a refund income from the bank, linked', () => {
  it('is not counted as income, and the purchase drops out as fully refunded', () => {
    const order = tx({ amount: 80, merchant: 'Amazon' });
    const refund = tx({ type: 'income', amount: 80, merchant: 'Amazon', reimbursesId: order.id, moneyBackInfo: { source: 'refund' }, categoryId: 'refunds' });
    const salary = tx({ type: 'income', amount: 1000, categoryId: 'pay' });
    const txs = [order, refund, salary];
    const l = ledgerOf(txs);

    expect(l.isFullyRefunded(order)).toBe(true);
    // The pure check can't see linked incomes — which is why pages use the ledger's.
    expect(isFullyRefunded(order)).toBe(false);

    const counted = filterForAnalysis(txs, { excludeRefunded: true, isRefunded: t => l.isFullyRefunded(t) });
    expect(totalExpenses(counted, l.moneyRules(true))).toBe(0);
    expect(totalIncome(counted, l.moneyRules(true))).toBe(1000);
  });

  it('before it is linked, it still counts as income (the old double count, now fixable)', () => {
    const order = tx({ amount: 80, refunded: true });
    const refund = tx({ type: 'income', amount: 80, categoryId: 'refunds' });
    const txs = [order, refund];
    const l = ledgerOf(txs);
    const counted = filterForAnalysis(txs, { excludeRefunded: true, isRefunded: t => l.isFullyRefunded(t) });
    expect(totalIncome(counted, l.moneyRules(true))).toBe(80);
  });

  it('a partial refund income is netted, not dropped', () => {
    const order = tx({ amount: 80 });
    const l = ledgerOf([order, tx({ type: 'income', amount: 30, reimbursesId: order.id, moneyBackInfo: { source: 'refund' } })]);
    expect(l.refundState(order)).toBe('partial');
    expect(l.effectiveExpenseAmount(order)).toBe(50);
  });
});

describe('refundedPatch (bulk "Mark refunded")', () => {
  it('records a full refund in the new shape and clears the legacy flag', () => {
    const t = tx({ amount: 25, refunded: true });
    const patch = refundedPatch(t, true);
    expect(patch.refunded).toBeUndefined();
    expect('refunded' in patch).toBe(true); // explicitly cleared, so the merge drops it
    expect(patch.moneyBack).toEqual([expect.objectContaining({ source: 'refund', amountCents: 2500 })]);
  });

  it('un-marking removes refunds but keeps repayments', () => {
    const t = tx({
      amount: 25,
      moneyBack: [
        { id: 'a', source: 'refund', amountCents: 2500, date: '2026-10-02' },
        { id: 'b', source: 'repayment', amountCents: 500, date: '2026-10-02' },
      ],
    });
    expect(refundedPatch(t, false).moneyBack).toEqual([t.moneyBack![1]]);
  });
});
