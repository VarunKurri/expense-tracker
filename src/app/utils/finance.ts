import { Account, Transaction } from '../models';

export function transactionDeltaForAccount(transactions: Transaction[], accountId: string): number {
  let balance = 0;
  for (const t of transactions) {
    if (t.type === 'income' && t.accountId === accountId) {
      balance += t.amount;
    } else if (t.type === 'expense' && t.accountId === accountId) {
      balance -= t.amount;
    } else if (t.type === 'transfer') {
      if (t.fromAccountId === accountId) balance -= t.amount;
      if (t.toAccountId === accountId) balance += t.amount;
    }
  }
  return roundMoney(balance);
}

export function accountBalance(account: Account, transactions: Transaction[]): number {
  const delta = transactionDeltaForAccount(transactions, account.id || '');
  const balance = account.type === 'credit'
    ? account.openingBalance - delta
    : (account.openingBalance || 0) + delta;
  return roundMoney(balance);
}

export function creditCardBalance(account: Account, transactions: Transaction[]): number {
  return account.openingBalance - transactionDeltaForAccount(transactions, account.id || '');
}

export function availableCredit(account: Account, transactions: Transaction[]): number {
  if (!account.creditLimit) return 0;
  return roundMoney(account.creditLimit - creditCardBalance(account, transactions));
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}
