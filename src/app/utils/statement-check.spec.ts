import { describe, it, expect } from 'vitest';
import { Account, Transaction } from '../models';
import { checkStatement } from './statement-check';
import { pendingTotal, postedBalanceOn, transactionDeltaForAccount } from './finance';

const card = { id: 'card', type: 'credit', openingBalance: 0, plaidBalance: 588.81 } as Account;
const tx = (amount: number, date: string, over: Partial<Transaction> = {}) =>
  ({ id: date + amount, type: 'expense', amount, date, accountId: 'card', plaidTransactionId: date + amount, ...over }) as Transaction;

const history = [
  tx(40, '2026-09-10'),
  // Bought on the 16th, posted on the 18th: the next statement's.
  tx(25, '2026-09-16', { postedDate: '2026-09-18' }),
  tx(100, '2026-09-25', { type: 'income' }),
  tx(11.76, '2026-10-15', { plaidPending: true }),
];

describe('pending charges', () => {
  it('are not in the balance until they post', () => {
    expect(transactionDeltaForAccount(history, 'card')).toBe(35);
    expect(pendingTotal(history, 'card')).toBe(11.76);
  });
});

describe('checking the history against a statement', () => {
  it('walks back from the bank’s balance by posted date', () => {
    // Owed now 588.81. After Sep 17: +25 charge, −100 payment posted; the pending one isn't counted.
    expect(postedBalanceOn(card, history, '2026-09-17')).toBe(663.81);
    expect(postedBalanceOn(card, history, '2026-09-18')).toBe(688.81);
  });

  it('says when a statement matches, and by how much it doesn’t', () => {
    expect(checkStatement(card, history, '2026-09-17', 663.81)).toEqual({ appBalance: 663.81, diffCents: 0, matches: true });
    const off = checkStatement(card, history, '2026-09-17', 688.81);
    expect(off.matches).toBe(false);
    expect(off.diffCents).toBe(2500);
  });

  it('counts up from the opening balance for an account the bank doesn’t report', () => {
    const cash = { id: 'card', type: 'cash', openingBalance: 100 } as Account;
    expect(postedBalanceOn(cash, history, '2026-09-30')).toBe(135);
  });
});
