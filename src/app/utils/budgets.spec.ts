import { describe, it, expect } from 'vitest';
import { Budget, Transaction } from '../models';
import {
  defaultFor, overrideFor, effectiveBudgets, budgetsElsewhere, prefillAmount,
  planBudgetSave, describeBudgetDeletion, wouldClash, budgetProgress, budgetSpent,
  monthOptions, BudgetDraft,
} from './budgets';
import { MoneyRules } from './reporting';

const subsDefault: Budget = { id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 };
const foodDefault: Budget = { id: 'food-d', categoryId: 'food', amount: 400, isDefault: true, createdAt: 2 };
const foodOct: Budget = { id: 'food-oct', categoryId: 'food', amount: 600, isDefault: false, month: '2026-10', createdAt: 3 };

/** Applies a save plan the way BudgetService would, so tests can check the end state. */
function apply(budgets: Budget[], draft: BudgetDraft): Budget[] {
  const plan = planBudgetSave(budgets, draft);
  let out = budgets.filter(b => !plan.deletes.includes(b.id!));
  if (plan.write.kind === 'add') {
    out = [...out, { ...plan.write.data, id: 'new', createdAt: 99 }];
  } else {
    const { id, patch } = plan.write;
    out = out.map(b => b.id === id ? JSON.parse(JSON.stringify({ ...b, ...patch })) : b);
  }
  return out;
}

function tx(over: Partial<Transaction>): Transaction {
  return {
    id: Math.random().toString(36), type: 'expense', amount: 10, date: '2026-10-05',
    categoryId: 'subs', description: '', createdAt: 0, ...over,
  } as Transaction;
}

describe('the override bug', () => {
  it('overriding one month leaves the every-month budget alone', () => {
    // Before: Override opened the every-month budget itself, and saving
    // "Specific month" rewrote it into an October-only budget.
    const after = apply([subsDefault], { categoryId: 'subs', amount: 80, scope: 'month', month: '2026-10' });
    expect(defaultFor(after, 'subs')).toMatchObject({ id: 'subs-d', amount: 50, isDefault: true });
    expect(overrideFor(after, 'subs', '2026-10')).toMatchObject({ amount: 80, month: '2026-10' });
    // Every other month still sees the $50 limit.
    for (const m of ['2026-08', '2026-09', '2026-11', '2027-01']) {
      expect(effectiveBudgets(after, m)).toEqual([
        expect.objectContaining({ categoryId: 'subs', isOverride: false, budget: expect.objectContaining({ amount: 50 }) }),
      ]);
    }
    expect(effectiveBudgets(after, '2026-10')[0]).toMatchObject({ isOverride: true, defaultAmount: 50 });
  });

  it('editing an existing one-off updates it rather than adding another', () => {
    const plan = planBudgetSave([foodDefault, foodOct], { categoryId: 'food', amount: 650, scope: 'month', month: '2026-10' });
    expect(plan.write).toEqual({ kind: 'update', id: 'food-oct', patch: { amount: 650 } });
  });

  it('editing every month changes only the every-month budget', () => {
    const after = apply([foodDefault, foodOct], { categoryId: 'food', amount: 450, scope: 'default', month: '2026-10' });
    expect(defaultFor(after, 'food')!.amount).toBe(450);
    expect(overrideFor(after, 'food', '2026-10')!.amount).toBe(600);
  });

  it('a budget the bug stranded in one month can be made every-month again', () => {
    // What the bug left behind: the only Subscriptions budget is October-only.
    const stranded: Budget = { ...subsDefault, isDefault: false, month: '2026-10' };
    const after = apply([stranded, foodDefault], { categoryId: 'subs', amount: 50, scope: 'default', month: '2026-10' });
    const subs = after.filter(b => b.categoryId === 'subs');
    expect(subs).toHaveLength(1); // promoted, not duplicated
    expect(subs[0]).toMatchObject({ id: 'subs-d', isDefault: true, amount: 50 });
    expect(subs[0].month).toBeUndefined();
  });

  it('never adds a second every-month budget for a category', () => {
    const plan = planBudgetSave([subsDefault], { categoryId: 'subs', amount: 70, scope: 'default', month: '2026-10' });
    expect(plan.write).toEqual({ kind: 'update', id: 'subs-d', patch: { amount: 70 } });
  });

  it('tidies duplicates left by older versions', () => {
    const dupe: Budget = { ...subsDefault, id: 'subs-d2', amount: 999, createdAt: 5 };
    const plan = planBudgetSave([subsDefault, dupe], { categoryId: 'subs', amount: 60, scope: 'default', month: '2026-10' });
    expect(plan.write).toMatchObject({ kind: 'update', id: 'subs-d' });
    expect(plan.deletes).toEqual(['subs-d2']);
  });

  it('adds fresh budgets where nothing exists', () => {
    expect(planBudgetSave([], { categoryId: 'gym', amount: 30, scope: 'default', month: '2026-10' }).write)
      .toEqual({ kind: 'add', data: { categoryId: 'gym', amount: 30, isDefault: true } });
    expect(planBudgetSave([], { categoryId: 'gym', amount: 30, scope: 'month', month: '2026-12' }).write)
      .toEqual({ kind: 'add', data: { categoryId: 'gym', amount: 30, isDefault: false, month: '2026-12' } });
  });
});

describe('effectiveBudgets', () => {
  it('shows categories that only have a one-off this month', () => {
    const travelDec: Budget = { id: 't', categoryId: 'travel', amount: 900, isDefault: false, month: '2026-12', createdAt: 4 };
    const all = [foodDefault, travelDec];
    expect(effectiveBudgets(all, '2026-12').map(e => e.categoryId)).toEqual(['food', 'travel']);
    expect(effectiveBudgets(all, '2026-11').map(e => e.categoryId)).toEqual(['food']);
  });

  it('lists one row per category', () => {
    expect(effectiveBudgets([foodDefault, foodOct, subsDefault], '2026-10')).toHaveLength(2);
  });
});

describe('budgetsElsewhere', () => {
  it('points to one-off-only categories hidden in the viewed month', () => {
    const stranded: Budget = { ...subsDefault, isDefault: false, month: '2026-10' };
    expect(budgetsElsewhere([stranded, foodDefault, foodOct], '2026-09'))
      .toEqual([{ categoryId: 'subs', months: ['2026-10'] }]);
    expect(budgetsElsewhere([stranded], '2026-10')).toEqual([]);
  });
});

describe('prefillAmount', () => {
  it('starts a new one-off from the every-month amount', () => {
    expect(prefillAmount([subsDefault], 'subs', 'month', '2026-10')).toBe(50);
    expect(prefillAmount([foodDefault, foodOct], 'food', 'month', '2026-10')).toBe(600);
    expect(prefillAmount([foodDefault, foodOct], 'food', 'default', '2026-10')).toBe(400);
    expect(prefillAmount([], 'food', 'default', '2026-10')).toBe(0);
  });
});

describe('describeBudgetDeletion', () => {
  it('says what a month falls back to', () => {
    expect(describeBudgetDeletion([foodDefault, foodOct], foodOct, 'Food'))
      .toBe('October 2026 goes back to the every-month limit of $400.00. Other months are not affected.');
    expect(describeBudgetDeletion([foodDefault, foodOct], foodDefault, 'Food'))
      .toBe('Food will have no every-month limit. Its 1 one-month limit stays.');
    expect(describeBudgetDeletion([subsDefault], subsDefault, 'Subscriptions'))
      .toContain('no limit in any month');
  });
});

describe('wouldClash', () => {
  it('blocks re-pointing onto a category that already has that period', () => {
    const orphan: Budget = { id: 'o', categoryId: 'gone', amount: 10, isDefault: true, createdAt: 0 };
    expect(wouldClash([orphan, foodDefault], orphan, 'food')).toBe(true);
    expect(wouldClash([orphan, foodOct], orphan, 'food')).toBe(false);
  });
});

describe('budgetProgress', () => {
  it('uses one set of thresholds', () => {
    expect(budgetProgress(0, 100)).toEqual({ pct: 0, status: 'ok', remaining: 100 });
    expect(budgetProgress(75, 100).status).toBe('warn');
    expect(budgetProgress(100, 100).status).toBe('over');
    expect(budgetProgress(12.345, 0).pct).toBe(0);
  });
});

describe('budgetSpent', () => {
  const reimbursed = new Map([['dinner', 30]]);
  const rules = (netting: boolean): MoneyRules => ({
    netting,
    effectiveExpense: t => Math.max(0, t.amount - (reimbursed.get(t.id!) ?? 0)),
    reimbursementSurplus: () => 0,
  });
  const txs = [
    tx({ id: 'dinner', amount: 50 }),
    tx({ amount: 20, refunded: true }),
    tx({ amount: 100, isInternalTransfer: true }),
    tx({ amount: 5, categoryId: 'food' }),
    tx({ amount: 7, date: '2026-09-30' }),
    tx({ amount: 999, type: 'income' }),
  ];

  it('nets reimbursements and drops refunds, like Spending does', () => {
    expect(budgetSpent(txs, 'subs', '2026-10', rules(true))).toBe(20);
  });

  it('counts everything as recorded with the toggle off', () => {
    expect(budgetSpent(txs, 'subs', '2026-10', rules(false))).toBe(70);
  });
});

describe('monthOptions', () => {
  it('is local, in order, and includes extras', () => {
    const opts = monthOptions('2026-01', 1, 1, ['2025-06']);
    expect(opts.map(o => o.value)).toEqual(['2025-06', '2025-12', '2026-01', '2026-02']);
    expect(opts[2].label).toBe('January 2026');
  });
});
