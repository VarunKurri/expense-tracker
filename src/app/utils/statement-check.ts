import { Account, Transaction } from '../models';
import { postedBalanceOn } from './finance';
import { toCents } from './money';

/**
 * Does the history here add up to a statement? A linked account's balance is
 * the bank's (see openingBalanceFor), so the question is whether the rows
 * between the statement and today account for the difference. Walking back
 * from today's bank balance by posted date gives what the statement should
 * say; if it doesn't, something in between is missing here or counted twice.
 */
export interface StatementCheck {
  /** What the history here gives for that day. */
  appBalance: number;
  /** Statement − app, in cents: positive means the statement says more. */
  diffCents: number;
  matches: boolean;
}

export function checkStatement(
  account: Account, transactions: Transaction[], date: string, statementBalance: number,
): StatementCheck {
  const appBalance = postedBalanceOn(account, transactions, date);
  const diffCents = toCents(statementBalance) - toCents(appBalance);
  return { appBalance, diffCents, matches: diffCents === 0 };
}
