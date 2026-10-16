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
  accounts: Account[], itemId: string, type: Account['type'], returnedPlaidIds: string[],
): { account: Account; stale: boolean }[] {
  return accounts
    .filter(a => a.plaidItemId === itemId && a.type === type && !a.archived && !!a.plaidAccountId)
    .map(account => ({ account, stale: !returnedPlaidIds.includes(account.plaidAccountId!) }))
    .sort((x, y) => Number(y.stale) - Number(x.stale) || x.account.name.localeCompare(y.account.name));
}
