import { describe, it, expect } from 'vitest';
import { Account, Transaction } from '../models';
import { relinkDuplicates } from './relink-duplicates';

const college = { id: 'college', name: 'Chase College', type: 'checking', openingBalance: 0, currency: 'USD', createdAt: 0,
  institution: 'Chase', plaidItemId: 'new-item', plaidAccountId: 'new', previousPlaidAccountIds: ['old'] } as Account;

let n = 0;
/** A bank row as the bank wrote it (doc id = transaction id, never edited). */
const bank = (plaidAccountId: string, type: 'income' | 'expense', amount: number, date: string, over: Partial<Transaction> = {}): Transaction => {
  const id = `${plaidAccountId}-${++n}`;
  return { id, plaidTransactionId: id, plaidAccountId, type, amount, date, merchant: 'Row', createdAt: 1, updatedAt: 1, ...over } as Transaction;
};

describe('bank rows a relink sent twice', () => {
  it('pairs the copy with the row you already had, keeping yours', () => {
    const mine = bank('old', 'income', 1000, '2026-01-16', { merchant: 'Credit from Priya', updatedAt: 5 });
    const copy = bank('new', 'income', 1000, '2026-01-16', { merchant: 'Zelle payment from SAI PRIYA' });
    const pairs = relinkDuplicates([mine, copy], [college]);
    expect(pairs.map(p => [p.keep.id, p.drop.id])).toEqual([[mine.id, copy.id]]);
  });

  it('never pairs two rows from the same link: those are two real transactions', () => {
    const a = bank('new', 'expense', 4.5, '2026-01-03');
    const b = bank('new', 'expense', 4.5, '2026-01-03');
    expect(relinkDuplicates([a, b], [college])).toEqual([]);
  });

  it('pairs a run of equal charges day by day, and leaves what the old link never saw', () => {
    const old = ['2026-01-01', '2026-01-02', '2026-01-03'].map(d => bank('old', 'expense', 4.5, d));
    const fresh = ['2026-01-01', '2026-01-02', '2026-01-03', '2026-01-10'].map(d => bank('new', 'expense', 4.5, d));
    const pairs = relinkDuplicates([...old, ...fresh], [college]);
    expect(pairs.map(p => [p.keep.date, p.drop.date])).toEqual([
      ['2026-01-01', '2026-01-01'], ['2026-01-02', '2026-01-02'], ['2026-01-03', '2026-01-03'],
    ]);
  });

  it('allows a few days between the two dates, and needs the same amount and direction', () => {
    const old = bank('old', 'expense', 100, '2026-01-15');
    const later = bank('new', 'expense', 100, '2026-01-17');
    const income = bank('new', 'income', 100, '2026-01-15');
    const other = bank('new', 'expense', 100.01, '2026-01-15');
    const pairs = relinkDuplicates([old, later, income, other], [college]);
    expect(pairs.map(p => p.drop.id)).toEqual([later.id]);
  });

  it('matches a row you turned into a transfer by the side this account is on', () => {
    const old = bank('old', 'expense', 1386.07, '2026-01-15', { type: 'transfer', fromAccountId: 'college', toAccountId: 'card' } as Partial<Transaction>);
    const copy = bank('new', 'expense', 1386.07, '2026-01-15');
    expect(relinkDuplicates([old, copy], [college]).map(p => p.keep.id)).toEqual([old.id]);
  });

  it('never removes a copy you edited or linked to something', () => {
    const o1 = bank('old', 'expense', 20, '2026-01-05');
    const o2 = bank('old', 'expense', 30, '2026-01-05');
    const edited = bank('new', 'expense', 20, '2026-01-05', { updatedAt: 9 });
    const linked = bank('new', 'expense', 30, '2026-01-05');
    const repayment = bank('new', 'income', 15, '2026-01-06', { reimbursesId: linked.id });
    expect(relinkDuplicates([o1, o2, edited, linked, repayment], [college])).toEqual([]);
  });

  it('leaves accounts with only one link alone', () => {
    const solo = { ...college, previousPlaidAccountIds: undefined };
    expect(relinkDuplicates([bank('new', 'expense', 5, '2026-01-01'), bank('new', 'expense', 5, '2026-01-01')], [solo])).toEqual([]);
  });
});
