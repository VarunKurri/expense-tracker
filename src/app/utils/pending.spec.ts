import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import { BankPending, settlePending } from './pending';

const row = (id: string, over: Partial<Transaction> = {}): Transaction => ({
  id, plaidTransactionId: id, plaidItemId: 'chase', plaidAccountId: 'card', type: 'expense', amount: 28.65,
  date: '2026-10-10', merchant: 'India Cash & Carry', createdAt: 1, updatedAt: 1, ...over,
}) as Transaction;
const bank = (over: Partial<BankPending> = {}): BankPending =>
  ({ itemId: 'chase', windowStart: '2026-09-16', pendingIds: [], postedFrom: {}, ...over });
const TODAY = '2026-10-16';

describe('Pending follows the bank', () => {
  it('leaves a row the bank still has as pending', () => {
    const p = row('p1', { plaidPending: true });
    expect(settlePending([p], [bank({ pendingIds: ['p1'] })], TODAY)).toEqual([]);
  });

  it('folds the posted row the bank links it to into the one you edited', () => {
    const p = row('p1', { plaidPending: true, categoryId: 'groceries', updatedAt: 9 });
    const posted = row('x9', { amount: 28.65, postedDate: '2026-10-12' });
    const [a] = settlePending([p, posted], [bank({ postedFrom: { p1: 'x9' } })], TODAY);
    expect(a).toEqual({ kind: 'fold', row: p, posted });
  });

  it('matches the posted row itself when the bank never links them, tip included', () => {
    const p = row('p1', { plaidPending: true, merchant: 'Super Duper', amount: 28.00 });
    const otherShop = row('o1', { merchant: 'Shell', amount: 33.30, date: '2026-10-11' });
    const posted = row('x9', { merchant: 'SUPER DUPER BURGERS', amount: 33.30, date: '2026-10-11' });
    const [a] = settlePending([p, otherShop, posted], [bank()], TODAY);
    expect(a.kind).toBe('fold');
    expect(a.kind === 'fold' && a.posted.id).toBe('x9');
  });

  it('just stops being pending when it posted and nothing else stands for it', () => {
    const p = row('p1', { plaidPending: true });
    expect(settlePending([p], [bank()], TODAY)).toEqual([{ kind: 'posted', row: p }]);
  });

  it('goes when the bank dropped it and nothing posted: it was cancelled', () => {
    const p = row('p1', { plaidPending: true, bankRemoved: true });
    expect(settlePending([p], [], TODAY)).toEqual([{ kind: 'cancelled', row: p }]);
  });

  it('waits for word from the bank on a recent row, but not on an old one', () => {
    const recent = row('p1', { plaidPending: true, date: '2026-10-12' });
    const old = row('p2', { plaidPending: true, date: '2026-09-17' });
    expect(settlePending([recent, old], [], TODAY)).toEqual([{ kind: 'posted', row: old }]);
  });

  it('never folds in a posted row you edited or linked to something', () => {
    const p = row('p1', { plaidPending: true });
    const edited = row('x1', { updatedAt: 5 });
    expect(settlePending([p, edited], [bank()], TODAY)).toEqual([{ kind: 'posted', row: p }]);
  });

  it('marks a row pending again when the bank still has it as pending', () => {
    const merged = row('p1', { plaidPending: false, updatedAt: 9 });
    expect(settlePending([merged], [bank({ pendingIds: ['p1'] })], TODAY)).toEqual([{ kind: 'pending', row: merged }]);
  });
});
