import { describe, it, expect } from 'vitest';
import { Account, Transaction } from '../models';
import { carriedOpening } from './opening-carry';
import { accountBalance } from './finance';

describe('going back to opening balance + transactions', () => {
  const read = new Date('2026-10-19T12:00:00').getTime();
  const txs = [
    { id: 'a', type: 'expense', amount: 100, accountId: 'chk', date: '2026-10-01', plaidTransactionId: 'a' },
    { id: 'p', type: 'expense', amount: 39.61, accountId: 'chk', date: '2026-10-18', plaidTransactionId: 'p', plaidPending: true },
    { id: 'h', type: 'income', amount: 100, accountId: 'chk', date: '2026-01-29' },
    { id: 'n', type: 'expense', amount: 5, accountId: 'chk', date: '2026-10-19' },
  ] as Transaction[];

  it('keeps the balance where it was, now counting what’s pending', () => {
    const chk = { id: 'chk', type: 'checking', openingBalance: 0, plaidBalance: 1214.95, plaidBalanceAt: read } as Account;
    const opening = carriedOpening(chk, txs);
    // Bank's 1,214.95, less the pending 39.61 and today's hand-added 5.
    expect(accountBalance({ ...chk, openingBalance: opening }, txs)).toBe(1170.34);
  });

  it('does the same for a card, where the balance is what you owe', () => {
    const card = { id: 'chk', type: 'credit', openingBalance: 0, plaidBalance: 588.81, plaidBalanceAt: read } as Account;
    expect(accountBalance({ ...card, openingBalance: carriedOpening(card, txs) }, txs)).toBe(633.42);
  });

  it('leaves an account that was never pinned alone', () => {
    const cash = { id: 'chk', type: 'cash', openingBalance: 50 } as Account;
    expect(carriedOpening(cash, txs)).toBe(50);
  });
});
