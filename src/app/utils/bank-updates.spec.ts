import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import { bankUpdatePatch, withoutBankSidecars } from './bank-updates';

const mine = {
  id: 'pending-1', type: 'expense', amount: 11.76, date: '2026-10-15', merchant: 'Market (lunch with Priya)',
  categoryId: 'dining', notes: 'split', plaidTransactionId: 'pending-1', plaidPending: true, createdAt: 1, updatedAt: 9,
} as Transaction;

describe('the bank changing a row you edited', () => {
  it('takes the bank’s amount, pending state and posted date, and keeps your edits and date', () => {
    const posted = { type: 'expense', amount: 14.11, date: '2026-10-15', postedDate: '2026-10-17', plaidPending: false,
      plaidTransactionId: 'posted-1', plaidAccountId: 'card', merchant: 'THE MARKET AT NORTHPARK' } as Partial<Transaction>;
    const after = { ...mine, ...bankUpdatePatch(mine, posted) };
    expect(after).toMatchObject({
      amount: 14.11, plaidPending: false, postedDate: '2026-10-17', plaidTransactionId: 'posted-1',
      merchant: 'Market (lunch with Priya)', categoryId: 'dining', notes: 'split', date: '2026-10-15',
    });
  });

  it('keeps a row you made a transfer as a transfer', () => {
    const transfer = { ...mine, type: 'transfer' } as Transaction;
    expect(bankUpdatePatch(transfer, { type: 'expense', amount: 5 }).type).toBeUndefined();
  });

  it('never saves the waiting update inside the row', () => {
    const t = { ...mine, bankUpdate: { amount: 1 }, bankRemoved: true };
    expect(withoutBankSidecars(t)).not.toHaveProperty('bankUpdate');
    expect(withoutBankSidecars(t)).not.toHaveProperty('bankRemoved');
    expect(withoutBankSidecars(mine)).toBe(mine);
  });
});
