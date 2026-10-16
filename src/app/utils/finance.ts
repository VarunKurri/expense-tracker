import { Account, AccountType, Transaction } from '../models';

/**
 * How the account's history moves its balance. Pending rows are left out: a
 * bank's balance doesn't include them until they post (Chase shows $588.81
 * with $11.76 pending), so neither does the app's. They still count as
 * spending; see `pendingTotal`.
 */
export function transactionDeltaForAccount(transactions: Transaction[], accountId: string): number {
  let balance = 0;
  for (const t of transactions) {
    if (t.plaidPending) continue;
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

/** Pending rows on an account, as money out (positive) or in (negative). Not in the balance yet. */
export function pendingTotal(transactions: Transaction[], accountId: string): number {
  return roundMoney(-transactionDeltaForAccount(
    transactions.filter(t => t.plaidPending).map(t => ({ ...t, plaidPending: false })), accountId));
}

/** The day the bank counts a row on: when it posted, or (for older rows) its date. */
export function postedOn(t: Transaction): string {
  return t.postedDate ?? t.date;
}

/**
 * The balance at the end of `date` as the bank's books had it: by posted
 * date, pending left out. A linked account walks back from the bank's own
 * balance, so this checks the history between that day and today against a
 * statement. Others count up from the opening balance. For a card, what you owe.
 */
export function postedBalanceOn(account: Account, transactions: Transaction[], date: string): number {
  const id = account.id || '';
  const owes = owesMoney(account.type);
  if (account.plaidBalance != null) {
    const after = transactionDeltaForAccount(transactions.filter(t => postedOn(t) > date), id);
    return roundMoney(owes ? account.plaidBalance + after : account.plaidBalance - after);
  }
  const upTo = transactionDeltaForAccount(transactions.filter(t => postedOn(t) <= date), id);
  return roundMoney(owes ? (account.openingBalance || 0) - upTo : (account.openingBalance || 0) + upTo);
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
