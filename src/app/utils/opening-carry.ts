import { Account, Transaction } from '../models';
import { owesMoney, roundMoney, transactionDeltaForAccount } from './finance';

/**
 * For a while (parts 121 to 127) a linked account's balance was pinned to the
 * bank's reported balance (`plaidBalance`) instead of its opening balance.
 * Going back to opening balance + transactions, this works out the opening
 * balance that keeps today's balance where it was, now that pending rows and
 * every hand-added entry count again: the bank's balance, plus what's
 * pending, plus anything added by hand in the last few days. Run once per
 * account, then `plaidBalance` is cleared.
 */
export function carriedOpening(account: Account, transactions: Transaction[]): number {
  if (account.plaidBalance == null || !account.id) return account.openingBalance || 0;
  const read = account.plaidBalanceAt ? new Date(account.plaidBalanceAt) : new Date();
  read.setDate(read.getDate() - 5);
  const recentFrom = `${read.getFullYear()}-${String(read.getMonth() + 1).padStart(2, '0')}-${String(read.getDate()).padStart(2, '0')}`;
  // What the pinned balance treated as inside the bank's figure.
  const inBank = transactions.filter(t =>
    !t.plaidPending && !(!t.plaidTransactionId && t.date >= recentFrom));
  const delta = transactionDeltaForAccount(inBank, account.id);
  return roundMoney(owesMoney(account.type) ? account.plaidBalance + delta : account.plaidBalance - delta);
}
