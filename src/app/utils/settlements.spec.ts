import { describe, it, expect } from 'vitest';
import { ME, SharedBill, Transaction } from '../models';
import { settlementCategories, spreadOverCategories } from './settlements';
import { categoryTotals, MoneyRules } from './reporting';
import { budgetSpent } from './budgets';
import { quickSplit } from './splits';

const theirs = (id: string, payer: string, cents: number, people: string[], categoryId?: string, groupId?: string): SharedBill => ({
  id, date: '2026-09-12', merchant: id, createdAt: 0, updatedAt: 0, ...(categoryId ? { categoryId } : {}),
  split: { ...quickSplit(cents, people), payments: [{ personId: payer, amountCents: cents }], ...(groupId ? { groupId } : {}) },
});

const venmo = (amount: number, settlement: Transaction['settlement'], over: Partial<Transaction> = {}): Transaction => ({
  id: 'v', type: 'expense', amount, date: '2026-09-20', merchant: 'Venmo', accountId: 'chk', categoryId: 'transfer',
  createdAt: 0, updatedAt: 0, settlement, ...over,
} as Transaction);

describe('settlementCategories: what a settle-up payment paid for', () => {
  // Tahoe: Nik paid dinner $90 (3 ways) and gas $60 (2 ways, you and Nik); Priya paid the cabin $300 without you.
  const bills = [
    theirs('dinner', 'nik', 9000, [ME, 'nik', 'priya'], 'dining', 'tahoe'),
    theirs('gas', 'nik', 6000, [ME, 'nik'], 'gas', 'tahoe'),
    theirs('cabin', 'priya', 30000, ['nik', 'priya'], 'lodging', 'tahoe'),
    theirs('movie', 'nik', 2000, [ME, 'nik'], 'fun'), // outside the group
  ];

  it('in a group: weighted by your shares of bills others paid there', () => {
    expect(settlementCategories(venmo(60, { personId: 'nik', groupId: 'tahoe' }), bills)).toEqual([
      { categoryId: 'dining', cents: 3000 },
      { categoryId: 'gas', cents: 3000 },
    ]);
  });

  it("outside a group: only that person's bills you were on", () => {
    expect(settlementCategories(venmo(10, { personId: 'nik' }), bills)).toEqual([{ categoryId: 'fun', cents: 1000 }]);
  });

  it('nothing to go on, or not a settle-up: counts under its own category', () => {
    expect(settlementCategories(venmo(10, { personId: 'priya' }), bills)).toBeNull();
    expect(settlementCategories(venmo(10, undefined), bills)).toBeNull();
  });

  it('spreads to the cent, biggest first', () => {
    const parts = spreadOverCategories(10000, [{ categoryId: 'a', cents: 1 }, { categoryId: 'b', cents: 2 }]);
    expect(parts).toEqual([{ categoryId: 'b', cents: 6667 }, { categoryId: 'a', cents: 3333 }]);
  });
});

describe('Analysis, Reports and Budgets count a settle-up under what it paid for', () => {
  const rules = (parts: ReturnType<typeof settlementCategories>): MoneyRules => ({
    netting: true, effectiveExpense: t => t.amount, reimbursementSurplus: () => 0, categoryParts: t => (t.settlement ? parts : null),
  });
  const weights = [{ categoryId: 'dining', cents: 3000 }, { categoryId: 'gas', cents: 1000 }];
  const lunch = { id: 'l', type: 'expense', amount: 12, date: '2026-09-21', categoryId: 'dining', accountId: 'chk', createdAt: 0, updatedAt: 0 } as Transaction;

  it('category totals', () => {
    const totals = categoryTotals([venmo(80, { personId: 'nik', groupId: 'tahoe' }), lunch], rules(weights));
    expect(totals).toEqual([{ categoryId: 'dining', amount: 72 }, { categoryId: 'gas', amount: 20 }]);
  });

  it('a budget for the category', () => {
    const txs = [venmo(80, { personId: 'nik', groupId: 'tahoe' }), lunch];
    expect(budgetSpent(txs, 'dining', '2026-09', rules(weights))).toBe(72);
    expect(budgetSpent(txs, 'transfer', '2026-09', rules(weights))).toBe(0);
    expect(budgetSpent(txs, 'transfer', '2026-09', rules(null))).toBe(80);
  });
});
