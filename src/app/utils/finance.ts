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
 * makes its history land exactly on that. The one exception is an entry you
 * added by hand in the last few days (`addsToBankBalance`): the bank may not
 * have it yet, so it moves the balance on top until the bank's row arrives
 * and is merged with it. An older hand-added entry is already in the bank's
 * balance (it's how you filled in something Plaid never sent), so it doesn't.
 * Every other account uses the opening balance you entered.
 */
export function openingBalanceFor(account: Account, transactions: Transaction[]): number {
  if (account.plaidBalance == null || !account.id) return account.openingBalance || 0;
  const delta = transactionDeltaForAccount(transactions.filter(t => !addsToBankBalance(t, account)), account.id);
  return roundMoney(owesMoney(account.type) ? account.plaidBalance + delta : account.plaidBalance - delta);
}

/** A row the bank sent (or one of yours merged with the bank's), as opposed to one you added by hand. */
export function isBankRow(t: Transaction): boolean {
  return !!t.plaidTransactionId;
}

/** Days a hand-added entry counts on top of the bank's balance: about how long a charge takes to reach it. */
export const HAND_ADDED_DAYS = 5;

/** The first date whose hand-added entries the bank may not have yet. */
export function handAddedFrom(account: Account): string {
  const read = account.plaidBalanceAt ? new Date(account.plaidBalanceAt) : new Date();
  read.setDate(read.getDate() - HAND_ADDED_DAYS);
  const y = read.getFullYear(), m = String(read.getMonth() + 1).padStart(2, '0'), d = String(read.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * A hand-added entry recent enough that the bank's balance may not include it
 * yet, so it moves a linked account's balance on top. Never true for the
 * bank's own rows, or for accounts the bank doesn't report.
 */
export function addsToBankBalance(t: Transaction, account: Account): boolean {
  return account.plaidBalance != null && !isBankRow(t) && t.date >= handAddedFrom(account);
}

/** Hand-added entries counted on top of the bank's balance, as money out (positive) or in (negative). */
export function handAddedTotal(transactions: Transaction[], account: Account): number {
  return roundMoney(-transactionDeltaForAccount(transactions.filter(t => addsToBankBalance(t, account)), account.id || ''));
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
    // Everything the bank's balance includes (so not a hand-added entry it may not have yet).
    const after = transactionDeltaForAccount(
      transactions.filter(t => !addsToBankBalance(t, account) && postedOn(t) > date), id);
    return roundMoney(owes ? account.plaidBalance + after : account.plaidBalance - after);
  }
  const upTo = transactionDeltaForAccount(transactions.filter(t => postedOn(t) <= date), id);
  return roundMoney(owes ? (account.openingBalance || 0) - upTo : (account.openingBalance || 0) + upTo);
}

export function roundMoney(value: number): number {
  // `+ 0` turns −0 (from negating an empty total) into 0.
  return Math.round(value * 100) / 100 + 0;
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
