import { Account } from '../models';

/**
 * The app account a synced transaction belongs to: the one linked to its
 * Plaid account now, or one that used to be (a card that was replaced keeps
 * its history in the same account).
 */
export function accountForPlaidId(accounts: Account[], plaidAccountId: string | undefined): Account | undefined {
  if (!plaidAccountId) return undefined;
  return accounts.find(a => a.plaidAccountId === plaidAccountId)
    ?? accounts.find(a => a.previousPlaidAccountIds?.includes(plaidAccountId));
}

/** Point an account at the card that replaced it, keeping the old card's id so its history still maps. */
export function replaceCard(account: Account, newPlaidAccountId: string, mask: string | null): Partial<Account> {
  const previous = [...(account.previousPlaidAccountIds ?? [])];
  if (account.plaidAccountId && account.plaidAccountId !== newPlaidAccountId && !previous.includes(account.plaidAccountId)) {
    previous.push(account.plaidAccountId);
  }
  return {
    plaidAccountId: newPlaidAccountId,
    previousPlaidAccountIds: previous,
    ...(mask ? { last4: mask } : {}),
  };
}

/**
 * Which existing accounts a new Plaid account might be replacing: the bank's
 * accounts of the same kind, those Plaid no longer reports first (the old
 * card stops being shared once it's replaced).
 */
export function replacementCandidates(
  accounts: Account[], itemId: string, type: Account['type'], returnedPlaidIds: string[], institution?: string,
): { account: Account; stale: boolean }[] {
  // The same bank linked a second time counts too: its accounts are on the old link.
  const sameBank = (a: Account) => a.plaidItemId === itemId || (!!institution && a.institution === institution);
  return accounts
    .filter(a => sameBank(a) && a.type === type && !a.archived && !!a.plaidAccountId)
    .map(account => ({ account, stale: !returnedPlaidIds.includes(account.plaidAccountId!) }))
    .sort((x, y) => Number(y.stale) - Number(x.stale) || x.account.name.localeCompare(y.account.name));
}

/**
 * The account a new link already has here: the same bank, kind and last 4
 * digits, but from an earlier link. Linking a bank again (rather than Manage
 * accounts) gives every account a new Plaid id, and this is how it carries on
 * in the account you have instead of appearing twice.
 */
export function sameAccountOnEarlierLink(
  accounts: Account[], institution: string, itemId: string, type: Account['type'], mask: string | null,
  claimedIds: Set<string> = new Set(),
): Account | undefined {
  if (!mask) return undefined;
  return accounts.find(a =>
    !!a.id && !a.archived && !claimedIds.has(a.id) &&
    !!a.plaidItemId && a.plaidItemId !== itemId &&
    a.institution === institution && a.type === type && a.last4 === mask,
  );
}

/** Move an account onto a new link of the same bank account. Every earlier Plaid id stays, so its history still maps. */
export function moveToLink(account: Account, plaidAccountId: string, plaidItemId: string, alsoPrevious: string[] = []): Partial<Account> {
  const patch = replaceCard(account, plaidAccountId, null);
  const previous = patch.previousPlaidAccountIds!;
  for (const id of alsoPrevious) if (id !== plaidAccountId && !previous.includes(id)) previous.push(id);
  return { ...patch, plaidItemId };
}

/**
 * Bank accounts that are here twice because the bank was linked again: the
 * same bank, kind and last 4 digits on different links. The first one made
 * stays (it has your history and edits); the copies fold into it.
 */
export function linkedTwice(accounts: Account[]): { keep: Account; copies: Account[] }[] {
  const groups = new Map<string, Account[]>();
  for (const a of accounts) {
    if (!a.id || a.archived || !a.plaidItemId || !a.plaidAccountId || !a.last4 || !a.institution) continue;
    const key = [a.institution, a.type, a.last4].join('|');
    groups.set(key, [...(groups.get(key) ?? []), a]);
  }
  const out: { keep: Account; copies: Account[] }[] = [];
  for (const list of groups.values()) {
    if (new Set(list.map(a => a.plaidItemId)).size < 2) continue;
    const [keep, ...copies] = [...list].sort((x, y) => (x.createdAt ?? 0) - (y.createdAt ?? 0));
    out.push({ keep, copies: copies.filter(c => c.plaidItemId !== keep.plaidItemId) });
  }
  return out.filter(g => g.copies.length > 0);
}
