import { describe, it, expect } from 'vitest';
import { Transaction, TransactionRule } from '../models';
import {
  ruleMatches, evaluateRules, usableRules, applyRulesToDraft,
  planBulkApply, describeRule, ruleHasAction, ruleHasCondition,
  hasMissingCategory, dropMissingCategories,
} from './rules';

function tx(over: Partial<Transaction> = {}): Transaction {
  return {
    id: 't1', type: 'expense', amount: 25, date: '2026-09-10',
    createdAt: 0, updatedAt: 0, ...over,
  } as Transaction;
}

function rule(over: Partial<TransactionRule> = {}): TransactionRule {
  return { id: 'r1', enabled: true, priority: 0, createdAt: 0, ...over };
}

describe('rules — guards', () => {
  it('treats a rule with no condition as unusable', () => {
    const r = rule({ setCategoryId: 'food' });
    expect(ruleHasCondition(r)).toBe(false);
    // Critically, it must not match everything.
    expect(ruleMatches(r, tx())).toBe(false);
    expect(usableRules([r])).toEqual([]);
  });

  it('treats a rule with no action as unusable', () => {
    const r = rule({ merchantContains: 'lyft' });
    expect(ruleHasAction(r)).toBe(false);
    expect(usableRules([r])).toEqual([]);
  });

  it('skips disabled rules', () => {
    const r = rule({ enabled: false, merchantContains: 'lyft', setCategoryId: 'ride' });
    expect(usableRules([r])).toEqual([]);
  });
});

describe('rules — deleted categories', () => {
  const valid = new Set(['food', 'ride']);

  it('flags a rule that files into a category that no longer exists', () => {
    expect(hasMissingCategory(rule({ merchantContains: 'x', setCategoryId: 'gone' }), valid)).toBe(true);
    expect(hasMissingCategory(rule({ merchantContains: 'x', setCategoryId: 'food' }), valid)).toBe(false);
    // A rule that only flags transfers files into nothing, so nothing can be missing.
    expect(hasMissingCategory(rule({ merchantContains: 'x', setInternalTransfer: true }), valid)).toBe(false);
  });

  it('never writes a deleted category onto transactions', () => {
    // This is the failure being guarded: "Re-file everything" stamping a dead
    // id onto every matching transaction after its category was deleted.
    const broken = rule({ merchantContains: 'lyft', setCategoryId: 'gone' });
    const plan = planBulkApply(dropMissingCategories([broken], valid),
      [tx({ id: 'a', merchant: 'Lyft', categoryId: 'food' })]);
    expect(plan).toEqual([]);
  });

  it('keeps the rest of a rule running when only its category is gone', () => {
    const r = rule({ merchantContains: 'chase', setCategoryId: 'gone', setInternalTransfer: true });
    const [cleaned] = dropMissingCategories([r], valid);
    expect(cleaned.setCategoryId).toBeUndefined();
    expect(cleaned.setInternalTransfer).toBe(true);
    const plan = planBulkApply([cleaned], [tx({ id: 'a', merchant: 'Chase payment' })]);
    expect(plan).toEqual([{ id: 'a', patch: { isInternalTransfer: true } }]);
  });

  it('lets a lower rule decide once a broken higher one is dropped', () => {
    // Otherwise the dead rule would "win" the category decision and block
    // a valid rule further down from ever applying.
    const rules = dropMissingCategories([
      rule({ id: 'r1', priority: 0, merchantContains: 'lyft', setCategoryId: 'gone' }),
      rule({ id: 'r2', priority: 1, merchantContains: 'lyft', setCategoryId: 'ride' }),
    ], valid);
    const plan = planBulkApply(rules, [tx({ id: 'a', merchant: 'Lyft' })]);
    expect(plan).toEqual([{ id: 'a', patch: { categoryId: 'ride' } }]);
  });

  it('leaves rules pointing at real categories untouched', () => {
    const r = rule({ merchantContains: 'lyft', setCategoryId: 'ride' });
    expect(dropMissingCategories([r], valid)[0]).toBe(r);
  });
});

describe('rules — matching', () => {
  it('matches a merchant substring case-insensitively', () => {
    const r = rule({ merchantContains: 'LYFT', setCategoryId: 'ride' });
    expect(ruleMatches(r, tx({ merchant: 'Lyft *Ride Sun 2pm' }))).toBe(true);
    expect(ruleMatches(r, tx({ merchant: 'Uber' }))).toBe(false);
  });

  it('also searches the notes, where bank rows often hide the real name', () => {
    const r = rule({ merchantContains: 'chase', setInternalTransfer: true });
    expect(ruleMatches(r, tx({ merchant: '', notes: 'ORIG CO NAME:CHASE CREDIT CRD' }))).toBe(true);
  });

  it('requires every present condition to hold', () => {
    const r = rule({
      merchantContains: 'amazon', type: 'expense', accountId: 'a1',
      amountMin: 10, amountMax: 100, setCategoryId: 'shop',
    });
    const base = { merchant: 'Amazon', type: 'expense' as const, accountId: 'a1', amount: 50 };
    expect(ruleMatches(r, tx(base))).toBe(true);
    expect(ruleMatches(r, tx({ ...base, accountId: 'a2' }))).toBe(false);
    expect(ruleMatches(r, tx({ ...base, amount: 5 }))).toBe(false);
    expect(ruleMatches(r, tx({ ...base, amount: 500 }))).toBe(false);
    expect(ruleMatches(r, tx({ ...base, type: 'income' }))).toBe(false);
  });

  it('compares the absolute amount, so sign conventions cannot break a rule', () => {
    const r = rule({ amountMin: 20, amountMax: 30, setCategoryId: 'x' });
    expect(ruleMatches(r, tx({ amount: -25 }))).toBe(true);
  });

  it('can target transactions currently in a given category', () => {
    const r = rule({ categoryId: 'misc', setCategoryId: 'groceries' });
    expect(ruleMatches(r, tx({ categoryId: 'misc' }))).toBe(true);
    expect(ruleMatches(r, tx({ categoryId: 'rent' }))).toBe(false);
    expect(ruleMatches(r, tx({}))).toBe(false);
  });
});

describe('rules — evaluation', () => {
  it('the first rule by priority wins a contested field', () => {
    const specific = rule({ id: 'a', priority: 0, merchantContains: 'lyft', setCategoryId: 'rideshare' });
    const broad = rule({ id: 'b', priority: 10, merchantContains: 'l', setCategoryId: 'misc' });
    const out = evaluateRules([broad, specific], tx({ merchant: 'Lyft' }));
    expect(out?.patch.categoryId).toBe('rideshare');
    // Both matched, even though only one changed anything — the tester needs
    // to be able to show overlap.
    expect(out?.matched.map(r => r.id)).toEqual(['a', 'b']);
  });

  it('different rules can each decide a different field', () => {
    const a = rule({ id: 'a', priority: 0, merchantContains: 'chase', setInternalTransfer: true });
    const b = rule({ id: 'b', priority: 1, merchantContains: 'chase', setCategoryId: 'transfer' });
    const out = evaluateRules([a, b], tx({ merchant: 'Chase payment' }));
    expect(out?.patch).toEqual({ isInternalTransfer: true, categoryId: 'transfer' });
  });

  it('returns null when the rule would set what is already there', () => {
    const r = rule({ merchantContains: 'lyft', setCategoryId: 'ride' });
    expect(evaluateRules([r], tx({ merchant: 'Lyft', categoryId: 'ride' }))).toBeNull();
  });

  it('returns null when nothing matches', () => {
    const r = rule({ merchantContains: 'lyft', setCategoryId: 'ride' });
    expect(evaluateRules([r], tx({ merchant: 'Tesco' }))).toBeNull();
  });
});

describe('rules — drafts', () => {
  it('folds the result into a transaction being created', () => {
    const r = rule({ merchantContains: 'lyft', setCategoryId: 'ride' });
    const draft = { type: 'expense' as const, amount: 12, date: '2026-09-01', merchant: 'Lyft' };
    expect(applyRulesToDraft([r], draft)).toMatchObject({ categoryId: 'ride', merchant: 'Lyft' });
  });

  it('leaves the draft untouched when no rule applies', () => {
    const r = rule({ merchantContains: 'lyft', setCategoryId: 'ride' });
    const draft = { type: 'expense' as const, amount: 12, date: '2026-09-01', merchant: 'Tesco' };
    expect(applyRulesToDraft([r], draft)).toBe(draft);
  });
});

describe('rules — bulk apply', () => {
  const r = rule({ merchantContains: 'lyft', setCategoryId: 'ride' });

  it('plans one patch per affected transaction', () => {
    const txs = [
      tx({ id: '1', merchant: 'Lyft' }),
      tx({ id: '2', merchant: 'Tesco' }),
      tx({ id: '3', merchant: 'LYFT again' }),
    ];
    expect(planBulkApply([r], txs)).toEqual([
      { id: '1', patch: { categoryId: 'ride' } },
      { id: '3', patch: { categoryId: 'ride' } },
    ]);
  });

  it('by default leaves already-categorised transactions alone', () => {
    // A new rule must not quietly overwrite deliberate filing.
    const txs = [
      tx({ id: '1', merchant: 'Lyft' }),
      tx({ id: '2', merchant: 'Lyft', categoryId: 'travel' }),
    ];
    expect(planBulkApply([r], txs, { onlyUncategorised: true }))
      .toEqual([{ id: '1', patch: { categoryId: 'ride' } }]);
  });

  it('re-files everything when asked explicitly', () => {
    const txs = [tx({ id: '2', merchant: 'Lyft', categoryId: 'travel' })];
    expect(planBulkApply([r], txs)).toEqual([{ id: '2', patch: { categoryId: 'ride' } }]);
  });

  it('plans nothing when there are no usable rules', () => {
    const broken = rule({ setCategoryId: 'ride' }); // no condition
    expect(planBulkApply([broken], [tx({ merchant: 'Lyft' })])).toEqual([]);
  });

  it('skips transactions with no id, which cannot be written back', () => {
    expect(planBulkApply([r], [tx({ id: undefined, merchant: 'Lyft' })])).toEqual([]);
  });
});

describe('rules — description', () => {
  const cat = (id: string) => ({ ride: 'Rideshare', misc: 'Misc' }[id] ?? id);
  const acct = (id: string) => ({ a1: 'Chase Checking' }[id] ?? id);

  it('reads as a sentence', () => {
    expect(describeRule(
      rule({ merchantContains: 'Lyft', accountId: 'a1', setCategoryId: 'ride' }), cat, acct
    )).toBe('When name contains "Lyft" and on Chase Checking, file as Rideshare');
  });

  it('says what is missing rather than pretending to be complete', () => {
    expect(describeRule(rule({ setCategoryId: 'ride' }), cat, acct))
      .toBe('Incomplete rule — add a condition');
    expect(describeRule(rule({ merchantContains: 'Lyft' }), cat, acct))
      .toBe('Incomplete rule — add an action');
  });
});
