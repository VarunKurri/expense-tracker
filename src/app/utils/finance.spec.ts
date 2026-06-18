import { Account, Transaction } from '../models';
import { accountBalance, availableCredit, creditCardBalance, transactionDeltaForAccount } from './finance';

describe('finance utilities', () => {
  const checking: Account = {
    id: 'checking',
    name: 'Checking',
    type: 'checking',
    openingBalance: 100,
    currency: 'USD',
    createdAt: 1,
  };

  const credit: Account = {
    id: 'credit',
    name: 'Credit',
    type: 'credit',
    openingBalance: 50,
    creditLimit: 500,
    currency: 'USD',
    createdAt: 1,
  };

  const transactions: Transaction[] = [
    { id: '1', type: 'income', accountId: 'checking', amount: 200, date: '2026-06-01', createdAt: 1, updatedAt: 1 },
    { id: '2', type: 'expense', accountId: 'checking', amount: 35.25, date: '2026-06-02', createdAt: 1, updatedAt: 1 },
    { id: '3', type: 'transfer', fromAccountId: 'checking', toAccountId: 'credit', amount: 25, date: '2026-06-03', createdAt: 1, updatedAt: 1 },
    { id: '4', type: 'expense', accountId: 'credit', amount: 20, date: '2026-06-04', createdAt: 1, updatedAt: 1 },
  ];

  it('calculates transaction delta for a deposit account', () => {
    expect(transactionDeltaForAccount(transactions, 'checking')).toBe(139.75);
  });

  it('calculates deposit account balance with opening balance', () => {
    expect(accountBalance(checking, transactions)).toBe(239.75);
  });

  it('calculates credit card debt and available credit', () => {
    expect(creditCardBalance(credit, transactions)).toBe(45);
    expect(availableCredit(credit, transactions)).toBe(455);
  });
});
