import { Account, Transaction } from '../models';
import { accountBalance, availableCredit, creditCardBalance, handAddedTotal, openingBalanceFor, transactionDeltaForAccount, withBankOpenings } from './finance';

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

describe('a linked account shows the bank’s balance', () => {
  const tx = (type: 'income' | 'expense', amount: number, id: string) =>
    ({ id, type, amount, accountId: 'college', date: '2026-01-15', plaidTransactionId: id }) as Transaction;
  // History that a relink sent twice: the same $1,000 in twice.
  const history = [tx('income', 1000, 'a'), tx('income', 1000, 'b'), tx('expense', 100, 'c')];
  const college = { id: 'college', type: 'checking', openingBalance: 0, plaidBalance: 1214.95 } as Account;

  it('works the opening balance out so the history lands on the bank’s balance', () => {
    expect(openingBalanceFor(college, history)).toBe(-685.05);
    expect(accountBalance(college, history)).toBe(1214.95);
  });

  it('does the same for a card, where the balance is what you owe', () => {
    const card = { id: 'college', type: 'credit', openingBalance: 0, plaidBalance: 250 } as Account;
    expect(accountBalance(card, history)).toBe(250);
    expect(creditCardBalance(card, history)).toBe(250);
  });

  it('keeps the opening balance you entered on an account the bank does not report', () => {
    const cash = { id: 'college', type: 'cash', openingBalance: 50 } as Account;
    expect(openingBalanceFor(cash, history)).toBe(50);
    expect(withBankOpenings([cash], history)[0]).toBe(cash);
    expect(withBankOpenings([college], history)[0].openingBalance).toBe(-685.05);
  });
});

describe('an entry you add by hand on a linked account', () => {
  it('moves the balance on top of the bank’s, until the bank’s row for it is merged', () => {
    const bankRows = [{ id: 'a', type: 'expense', amount: 100, accountId: 'chk', date: '2026-10-01', plaidTransactionId: 'a' }] as Transaction[];
    const chk = { id: 'chk', type: 'checking', openingBalance: 0, plaidBalance: 1000 } as Account;
    expect(accountBalance(chk, bankRows)).toBe(1000);
    const coffee = { id: 'm', type: 'expense', amount: 5, accountId: 'chk', date: '2026-10-16' } as Transaction;
    expect(accountBalance(chk, [...bankRows, coffee])).toBe(995);
    expect(handAddedTotal([...bankRows, coffee], 'chk')).toBe(5);
  });
});
