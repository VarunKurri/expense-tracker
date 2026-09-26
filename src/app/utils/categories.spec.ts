import { describe, it, expect } from 'vitest';
import { Budget, Category, Transaction, TransactionRule } from '../models';
import {
  validateCategoryName, resolvePlaidCategory, plaidNamesFor, aliasesAfterRename,
  planCategoryDeletion, deletionTargets, defaultDeletionTarget, DeletionInput,
} from './categories';

function cat(over: Partial<Category> & { id: string; name: string }): Category {
  return { kind: 'expense', createdAt: 0, ...over };
}

const dining = cat({ id: 'dining', name: 'Dining' });
const food = cat({ id: 'food', name: 'Food' });
const other = cat({ id: 'other', name: 'Other' });
const salary = cat({ id: 'salary', name: 'Salary', kind: 'income' });
const all = [dining, food, other, salary];

function input(over: Partial<DeletionInput> = {}): DeletionInput {
  return {
    category: dining, targetId: 'food', categories: all,
    storedTransactions: [], matchedBankTransactions: 0,
    budgets: [], rules: [], bills: [], templates: [],
    ...over,
  };
}

function budget(over: Partial<Budget> & { id: string; categoryId: string }): Budget {
  return { amount: 100, isDefault: true, createdAt: 0, ...over };
}

function rule(over: Partial<TransactionRule> & { id: string }): TransactionRule {
  return { enabled: true, priority: 0, createdAt: 0, merchantContains: 'x', ...over };
}

describe('validateCategoryName', () => {
  it('accepts a new name', () => {
    expect(validateCategoryName('Coffee', 'expense', all)).toBeNull();
  });

  it('rejects blank and over-long names', () => {
    expect(validateCategoryName('   ', 'expense', all)).toMatch(/name/);
    expect(validateCategoryName('x'.repeat(41), 'expense', all)).toMatch(/40/);
  });

  it('rejects a duplicate within the same kind, ignoring case', () => {
    // Bank transactions match by name, so two "Dining"s would make where they
    // land depend on load order.
    expect(validateCategoryName('dining', 'expense', all)).toMatch(/already/);
  });

  it('allows the same name in the other kind', () => {
    expect(validateCategoryName('Dining', 'income', all)).toBeNull();
  });

  it('lets a category keep its own name when editing', () => {
    expect(validateCategoryName('Dining', 'expense', all, 'dining')).toBeNull();
    expect(validateCategoryName('DINING', 'expense', all, 'dining')).toBeNull();
  });

  it('points at an archived clash rather than just refusing', () => {
    const archived = cat({ id: 'coffee', name: 'Coffee', archived: true });
    expect(validateCategoryName('coffee', 'expense', [...all, archived])).toMatch(/Restore/);
  });
});

describe('resolvePlaidCategory', () => {
  it('matches by name', () => {
    expect(resolvePlaidCategory(all, 'Dining', 'expense')?.id).toBe('dining');
  });

  it('prefers a category that has taken the name as an alias', () => {
    // Renamed "Dining" to "Eating out", then made a new "Dining". Bank
    // transactions must keep going to the one that has always had them.
    const eatingOut = cat({ id: 'dining', name: 'Eating out', plaidAliases: ['Dining'] });
    const newDining = cat({ id: 'new', name: 'Dining' });
    expect(resolvePlaidCategory([newDining, eatingOut], 'Dining', 'expense')?.id).toBe('dining');
  });

  it('still matches an archived category, so history keeps its filing', () => {
    const archived = cat({ id: 'dining', name: 'Dining', archived: true });
    expect(resolvePlaidCategory([archived], 'Dining', 'expense')?.id).toBe('dining');
  });

  it('never crosses kinds', () => {
    expect(resolvePlaidCategory(all, 'Salary', 'expense')).toBeUndefined();
  });
});

describe('aliasesAfterRename', () => {
  it('keeps a Plaid name as an alias when it is renamed away', () => {
    expect(aliasesAfterRename(dining, 'Eating out')).toEqual(['Dining']);
  });

  it('adds nothing for a name Plaid never uses', () => {
    expect(aliasesAfterRename(food, 'Groceries & food')).toBeUndefined();
  });

  it('adds nothing when the name did not change', () => {
    expect(aliasesAfterRename(dining, 'Dining')).toBeUndefined();
  });

  it('keeps earlier aliases across a second rename', () => {
    const once = { ...dining, name: 'Eating out', plaidAliases: ['Dining'] };
    expect(aliasesAfterRename(once, 'Restaurants')).toEqual(['Dining']);
  });

  it('end to end: a renamed category keeps receiving bank transactions', () => {
    const renamed = { ...dining, name: 'Eating out', plaidAliases: aliasesAfterRename(dining, 'Eating out') };
    expect(resolvePlaidCategory([renamed, food], 'Dining', 'expense')?.id).toBe('dining');
  });
});

describe('plaidNamesFor', () => {
  it('includes its own name when Plaid uses it, plus any aliases', () => {
    expect(plaidNamesFor(dining)).toEqual(['Dining']);
    expect(plaidNamesFor(food)).toEqual([]);
    expect(plaidNamesFor({ ...food, plaidAliases: ['Dining'] })).toEqual(['Dining']);
  });
});

describe('planCategoryDeletion — transactions', () => {
  const txs = [
    { id: 't1', type: 'expense', amount: 10, date: '2026-09-01', categoryId: 'dining' },
    { id: 't2', type: 'expense', amount: 20, date: '2026-09-02', categoryId: 'food' },
  ] as Transaction[];

  it('moves stored transactions to the target', () => {
    const plan = planCategoryDeletion(input({ storedTransactions: txs }));
    expect(plan.transactions).toEqual([{ id: 't1', patch: { categoryId: 'food' } }]);
  });

  it('clears them when there is no target', () => {
    const plan = planCategoryDeletion(input({ storedTransactions: txs, targetId: null }));
    expect(plan.transactions).toEqual([{ id: 't1', patch: { categoryId: undefined } }]);
  });

  it('hands its Plaid names to the target, so bank transactions follow', () => {
    // No bank transaction is written to — the sync overwrites them when the
    // bank modifies one, so a stored category would not be guaranteed to last.
    const plan = planCategoryDeletion(input({ matchedBankTransactions: 42 }));
    expect(plan.aliasesToTarget).toEqual(['Dining']);
    expect(plan.bankTransactions).toBe(42);
    const after = [{ ...food, plaidAliases: plan.aliasesToTarget }, other];
    expect(resolvePlaidCategory(after, 'Dining', 'expense')?.id).toBe('food');
  });

  it('hands over nothing when the target already receives those names', () => {
    const plan = planCategoryDeletion(input({
      categories: [dining, { ...food, plaidAliases: ['Dining'] }, other],
    }));
    expect(plan.aliasesToTarget).toEqual([]);
  });

  it('hands over nothing with no target — bank transactions go uncategorised', () => {
    const plan = planCategoryDeletion(input({ targetId: null, matchedBankTransactions: 5 }));
    expect(plan.aliasesToTarget).toEqual([]);
    expect(plan.bankTransactions).toBe(5);
  });
});

describe('planCategoryDeletion — budgets', () => {
  it('moves a budget when the target has none for that period', () => {
    const plan = planCategoryDeletion(input({ budgets: [budget({ id: 'b1', categoryId: 'dining' })] }));
    expect(plan.budgetMoves).toEqual([{ id: 'b1', patch: { categoryId: 'food' } }]);
    expect(plan.budgetDeletes).toEqual([]);
  });

  it('deletes it when the target already has one — never two for one period', () => {
    const plan = planCategoryDeletion(input({ budgets: [
      budget({ id: 'b1', categoryId: 'dining' }),
      budget({ id: 'b2', categoryId: 'food' }),
    ] }));
    expect(plan.budgetMoves).toEqual([]);
    expect(plan.budgetDeletes).toEqual(['b1']);
  });

  it('only counts a clash for the same period', () => {
    // The target's September override doesn't clash with the default.
    const plan = planCategoryDeletion(input({ budgets: [
      budget({ id: 'b1', categoryId: 'dining', isDefault: true }),
      budget({ id: 'b2', categoryId: 'food', isDefault: false, month: '2026-09' }),
      budget({ id: 'b3', categoryId: 'dining', isDefault: false, month: '2026-09' }),
    ] }));
    expect(plan.budgetMoves.map(m => m.id)).toEqual(['b1']);
    expect(plan.budgetDeletes).toEqual(['b3']);
  });

  it('deletes them all when there is no target', () => {
    const plan = planCategoryDeletion(input({
      targetId: null, budgets: [budget({ id: 'b1', categoryId: 'dining' })],
    }));
    expect(plan.budgetDeletes).toEqual(['b1']);
  });
});

describe('planCategoryDeletion — rules, bills, templates', () => {
  it('re-points a rule that files into it', () => {
    const plan = planCategoryDeletion(input({ rules: [rule({ id: 'r1', setCategoryId: 'dining' })] }));
    expect(plan.rulePatches).toEqual([{ id: 'r1', patch: { setCategoryId: 'food' } }]);
  });

  it('re-points a "currently filed as" condition', () => {
    const plan = planCategoryDeletion(input({
      rules: [rule({ id: 'r1', categoryId: 'dining', setCategoryId: 'other' })],
    }));
    expect(plan.rulePatches).toEqual([{ id: 'r1', patch: { categoryId: 'food' } }]);
  });

  it('switches a conditioned rule off rather than widening it, with no target', () => {
    // Dropping "currently filed as Dining" would make the rule match every
    // transaction from that merchant, in any category.
    const plan = planCategoryDeletion(input({
      targetId: null,
      rules: [rule({ id: 'r1', categoryId: 'dining', setCategoryId: 'other' })],
    }));
    expect(plan.rulePatches).toEqual([{ id: 'r1', patch: { enabled: false } }]);
    expect(plan.rulesDisabled).toBe(1);
  });

  it('does not count an already-disabled rule as newly switched off', () => {
    const plan = planCategoryDeletion(input({
      targetId: null,
      rules: [rule({ id: 'r1', enabled: false, categoryId: 'dining', setCategoryId: 'other' })],
    }));
    expect(plan.rulesDisabled).toBe(0);
  });

  it('re-points bills and templates, or clears them', () => {
    const bills = [{ id: 'bill', categoryId: 'dining' }] as any;
    const templates = [{ id: 'tpl', categoryId: 'dining' }] as any;
    expect(planCategoryDeletion(input({ bills, templates })).billPatches)
      .toEqual([{ id: 'bill', patch: { categoryId: 'food' } }]);
    const cleared = planCategoryDeletion(input({ targetId: null, bills, templates }));
    expect(cleared.billPatches).toEqual([{ id: 'bill', patch: { categoryId: undefined } }]);
    expect(cleared.templatePatches).toEqual([{ id: 'tpl', patch: { categoryId: undefined } }]);
  });

  it('leaves everything unrelated alone', () => {
    const plan = planCategoryDeletion(input({
      rules: [rule({ id: 'r1', setCategoryId: 'food' })],
      budgets: [budget({ id: 'b1', categoryId: 'food' })],
    }));
    expect(plan.rulePatches).toEqual([]);
    expect(plan.budgetMoves).toEqual([]);
    expect(plan.budgetDeletes).toEqual([]);
  });
});

describe('deletion targets', () => {
  it('offers same-kind, non-archived categories other than itself', () => {
    const archived = cat({ id: 'old', name: 'Old', archived: true });
    expect(deletionTargets(dining, [...all, archived]).map(c => c.id)).toEqual(['food', 'other']);
  });

  it('defaults to the catch-all', () => {
    expect(defaultDeletionTarget(dining, all)).toBe('other');
    expect(defaultDeletionTarget(salary, all)).toBeNull();
  });

  it('never defaults to the category being deleted', () => {
    expect(defaultDeletionTarget(other, all)).toBeNull();
  });
});
