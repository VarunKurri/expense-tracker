import { describe, it, expect } from 'vitest';
import { Account } from '../models';
import { accountForPlaidId, linkedTwice, moveToLink, replaceCard, replacementCandidates, sameAccountOnEarlierLink } from './plaid-accounts';

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

describe('a bank linked a second time', () => {
  const college = acc({ id: 'college', name: 'Chase College', type: 'checking', institution: 'Chase', last4: '2107',
    plaidItemId: 'old-item', plaidAccountId: 'old', createdAt: 1 });

  it('finds the account you already have by bank, kind and last 4', () => {
    expect(sameAccountOnEarlierLink([college], 'Chase', 'new-item', 'checking', '2107')?.id).toBe('college');
    expect(sameAccountOnEarlierLink([college], 'Chase', 'new-item', 'checking', '9999')).toBeUndefined();
    expect(sameAccountOnEarlierLink([college], 'Chase', 'new-item', 'savings', '2107')).toBeUndefined();
    expect(sameAccountOnEarlierLink([college], 'Chase', 'old-item', 'checking', '2107')).toBeUndefined();
    expect(sameAccountOnEarlierLink([college], 'Chase', 'new-item', 'checking', '2107', new Set(['college']))).toBeUndefined();
  });

  it('moves the account onto the new link, keeping every earlier id', () => {
    const patch = moveToLink(college, 'new', 'new-item', ['copy-old']);
    expect(patch).toEqual({ plaidAccountId: 'new', plaidItemId: 'new-item', previousPlaidAccountIds: ['old', 'copy-old'] });
    expect(accountForPlaidId([{ ...college, ...patch }], 'old')?.id).toBe('college');
  });

  it('spots an account that was added twice, keeping the first one made', () => {
    const copy = acc({ ...college, id: 'copy', plaidItemId: 'new-item', plaidAccountId: 'new', createdAt: 2 });
    const savings = acc({ id: 'sav', type: 'savings', institution: 'Chase', last4: '2107', plaidItemId: 'new-item', plaidAccountId: 's' });
    const groups = linkedTwice([copy, college, savings]);
    expect(groups.map(g => [g.keep.id, g.copies.map(c => c.id)])).toEqual([['college', ['copy']]]);
    expect(linkedTwice([college, savings])).toEqual([]);
  });

  it('offers the old link’s accounts as replacements too', () => {
    const list = replacementCandidates([college], 'new-item', 'checking', ['new'], 'Chase');
    expect(list.map(c => [c.account.id, c.stale])).toEqual([['college', true]]);
    expect(replacementCandidates([college], 'new-item', 'checking', ['new'])).toEqual([]);
  });
});
