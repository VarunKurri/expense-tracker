import { Account, AccountType, Transaction } from '../models';

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

/**
 * Accounts whose balance is what you owe rather than what you have: credit
 * cards, and loan accounts linked through Plaid. Their balance is opening −
 * transactions, and it counts against net worth.
 */
export function owesMoney(type: AccountType): boolean {
  return type === 'credit' || type === 'loan';
}

export function accountBalance(account: Account, transactions: Transaction[]): number {
  const delta = transactionDeltaForAccount(transactions, account.id || '');
  const opening = openingBalanceFor(account, transactions);
  return roundMoney(owesMoney(account.type) ? opening - delta : opening + delta);
}

/**
 * The opening balance the app counts from. A linked account takes the bank's
 * word for its balance (`plaidBalance`), so its opening balance is whatever
 * makes its history land exactly on that. Every other account uses the one
 * you entered.
 */
export function openingBalanceFor(account: Account, transactions: Transaction[]): number {
  if (account.plaidBalance == null || !account.id) return account.openingBalance || 0;
  const delta = transactionDeltaForAccount(transactions, account.id);
  return roundMoney(owesMoney(account.type) ? account.plaidBalance + delta : account.plaidBalance - delta);
}

/** Accounts with their opening balance worked out (see `openingBalanceFor`), for code that reads it directly. */
export function withBankOpenings(accounts: Account[], transactions: Transaction[]): Account[] {
  return accounts.map(a => a.plaidBalance == null ? a : { ...a, openingBalance: openingBalanceFor(a, transactions) });
}

export function creditCardBalance(account: Account, transactions: Transaction[]): number {
  return openingBalanceFor(account, transactions) - transactionDeltaForAccount(transactions, account.id || '');
}

export function availableCredit(account: Account, transactions: Transaction[]): number {
  if (!account.creditLimit) return 0;
  return roundMoney(account.creditLimit - creditCardBalance(account, transactions));
}

export function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Money in/out for one account within a given "YYYY-MM" month. Includes transfers
 *  (a transfer is a real movement of money through that specific account, even
 *  though it's excluded from app-wide income/expense totals). */
export function monthActivityForAccount(
  transactions: Transaction[], accountId: string, month: string
): { in: number; out: number } {
  let moneyIn = 0;
  let moneyOut = 0;
  for (const t of transactions) {
    if (!t.date.startsWith(month)) continue;
    if (t.type === 'income' && t.accountId === accountId) {
      moneyIn += t.amount;
    } else if (t.type === 'expense' && t.accountId === accountId) {
      moneyOut += t.amount;
    } else if (t.type === 'transfer') {
      if (t.toAccountId === accountId) moneyIn += t.amount;
      if (t.fromAccountId === accountId) moneyOut += t.amount;
    }
  }
  return { in: roundMoney(moneyIn), out: roundMoney(moneyOut) };
}
