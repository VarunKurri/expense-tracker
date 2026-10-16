import { describe, it, expect } from 'vitest';
import { Account } from '../models';
import { accountForPlaidId, replaceCard, replacementCandidates } from './plaid-accounts';

const acc = (over: Partial<Account>): Account =>
  ({ id: 'a', name: 'Card', type: 'credit', openingBalance: 0, currency: 'USD', createdAt: 0, ...over }) as Account;

describe('a replaced card carries on in the same account', () => {
  const freedom = acc({ id: 'freedom', name: 'Chase Freedom', plaidItemId: 'chase', plaidAccountId: 'old', last4: '1234' });

  it('points the account at the new card, keeping the old one for its history', () => {
    const patch = replaceCard(freedom, 'new', '5678');
    expect(patch).toEqual({ plaidAccountId: 'new', previousPlaidAccountIds: ['old'], last4: '5678' });
    const replaced = { ...freedom, ...patch };
    // New transactions and the old card's history both land in it.
    expect(accountForPlaidId([replaced], 'new')?.id).toBe('freedom');
    expect(accountForPlaidId([replaced], 'old')?.id).toBe('freedom');
    expect(accountForPlaidId([replaced], 'other')).toBeUndefined();
  });

  it('a second replacement keeps every earlier card', () => {
    const twice = { ...freedom, ...replaceCard(freedom, 'new', '5678') };
    expect(replaceCard(twice, 'newer', null)).toEqual({ plaidAccountId: 'newer', previousPlaidAccountIds: ['old', 'new'] });
  });

  it('suggests the bank’s cards of the same kind, the ones no longer syncing first', () => {
    const sapphire = acc({ id: 'sapphire', name: 'Chase Sapphire', plaidItemId: 'chase', plaidAccountId: 'sap' });
    const checking = acc({ id: 'chk', name: 'Chase Checking', type: 'checking', plaidItemId: 'chase', plaidAccountId: 'chk' });
    const amex = acc({ id: 'amex', name: 'Amex', plaidItemId: 'amex', plaidAccountId: 'ax' });
    const list = replacementCandidates([sapphire, freedom, checking, amex], 'chase', 'credit', ['sap', 'chk', 'new']);
    expect(list.map(c => [c.account.id, c.stale])).toEqual([['freedom', true], ['sapphire', false]]);
  });
});
