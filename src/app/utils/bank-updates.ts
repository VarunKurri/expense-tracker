import { Transaction } from '../models';

/**
 * A row you've edited is yours: the server can't read it, so when the bank
 * changes it the bank's version waits beside it (`bankUpdate`) and the app
 * folds in what belongs to the bank. Everything else is kept: your merchant
 * name, category, notes, splits and links. The date stays yours too, since
 * it's when you made the purchase.
 */
export function bankUpdatePatch(current: Transaction, bank: Partial<Transaction>): Partial<Transaction> {
  const patch: Partial<Transaction> = {
    amount: bank.amount ?? current.amount,
    plaidPending: bank.plaidPending,
    postedDate: bank.postedDate,
    plaidTransactionId: bank.plaidTransactionId ?? current.plaidTransactionId,
    plaidAccountId: bank.plaidAccountId ?? current.plaidAccountId,
    plaidItemId: bank.plaidItemId ?? current.plaidItemId,
  };
  // Money in or out can flip (a charge reversed into a credit); a row you
  // made a transfer keeps being a transfer.
  if (current.type !== 'transfer' && bank.type) patch.type = bank.type;
  return patch;
}

/** The fields read beside a row, never saved inside it. */
export function withoutBankSidecars<T extends Partial<Transaction>>(t: T): T {
  if (!('bankUpdate' in t) && !('bankRemoved' in t)) return t;
  const { bankUpdate: _update, bankRemoved: _removed, ...rest } = t;
  return rest as T;
}
