import { Account, Transaction } from '../models';
import { accountForPlaidId } from './plaid-accounts';

/**
 * Bank rows a relink sent twice. When a bank is linked again (or Chase hands
 * out new account ids), Plaid sends the whole history again under new
 * transaction ids, so every transaction it already sent lands a second time on
 * the same account. Plaid never repeats a transaction within one Plaid
 * account, so a pair is only ever looked for between two different Plaid
 * accounts (the old link and the new one) that feed the same app account.
 */
export interface RelinkPair {
  /** The row you already had: it keeps your edits and anything linked to it. */
  keep: Transaction;
  /** The same transaction sent again by the new link. */
  drop: Transaction;
}

/** Dates this many days apart can still be the same transaction. */
const MATCH_DAYS = 3;

export function relinkDuplicates(transactions: Transaction[], accounts: Account[]): RelinkPair[] {
  const linked = linkedIds(transactions);
  // Bank rows grouped by the app account their Plaid account feeds.
  const byAccount = new Map<string, Transaction[]>();
  for (const t of transactions) {
    if (!t.id || !t.plaidTransactionId || !t.plaidAccountId) continue;
    const account = accountForPlaidId(accounts, t.plaidAccountId);
    if (!account?.id || !account.plaidAccountId) continue;
    const list = byAccount.get(account.id) ?? [];
    list.push(t);
    byAccount.set(account.id, list);
  }

  const pairs: RelinkPair[] = [];
  for (const [accountId, rows] of byAccount) {
    const account = accounts.find(a => a.id === accountId)!;
    // The current link is the copy; anything from an older link is the original.
    const fresh = rows.filter(t => t.plaidAccountId === account.plaidAccountId);
    const old = rows.filter(t => t.plaidAccountId !== account.plaidAccountId);
    if (fresh.length === 0 || old.length === 0) continue;
    // After the old link stopped, nothing new can be a repeat of it.
    const lastOld = old.reduce((max, t) => (t.date > max ? t.date : max), old[0].date);

    const used = new Set<string>();
    const matchFor = (t: Transaction, maxDays: number) => {
      const amount = signedAmount(t, accountId);
      if (amount === null) return undefined;
      let best: Transaction | undefined;
      let bestDays = Infinity;
      for (const o of old) {
        if (used.has(o.id!)) continue;
        const other = signedAmount(o, accountId);
        if (other === null || Math.abs(other - amount) >= 0.005) continue;
        const days = dayDiff(o.date, t.date);
        if (days <= maxDays && days < bestDays) { best = o; bestDays = days; }
      }
      return best;
    };

    // Only a copy exactly as the bank sent it is ever removed: not one you've
    // edited (an edit moves updatedAt on; the bank writes both at once) or
    // linked to anything.
    const candidates = fresh.filter(t =>
      t.id === t.plaidTransactionId && t.updatedAt === t.createdAt && !linked.has(t.id!) &&
      (t.date <= lastOld || dayDiff(t.date, lastOld) <= MATCH_DAYS));
    const unpaired: Transaction[] = [];
    // Same day first, so a run of equal charges (a daily coffee) pairs up day by day.
    for (const t of candidates) {
      const o = matchFor(t, 0);
      if (o) { used.add(o.id!); pairs.push({ keep: o, drop: t }); } else unpaired.push(t);
    }
    for (const t of unpaired) {
      const o = matchFor(t, MATCH_DAYS);
      if (o) { used.add(o.id!); pairs.push({ keep: o, drop: t }); }
    }
  }
  return pairs;
}

/** Transactions something else points at (money back, reimbursements): never removed. */
function linkedIds(transactions: Transaction[]): Set<string> {
  const ids = new Set<string>();
  for (const t of transactions) {
    if (t.reimbursesId) ids.add(t.reimbursesId);
    for (const s of t.moneyBackSplits ?? []) ids.add(s.expenseId);
    for (const m of t.moneyBack ?? []) if (m.incomeId) ids.add(m.incomeId);
  }
  return ids;
}

/**
 * What a row does to this account: money in is positive. A bank row you turned
 * into a transfer still counts, by the side of it this account is on.
 */
function signedAmount(t: Transaction, accountId: string): number | null {
  if (t.type === 'income') return t.amount;
  if (t.type === 'expense') return -t.amount;
  if (t.type === 'transfer') {
    if (t.fromAccountId === accountId) return -t.amount;
    if (t.toAccountId === accountId) return t.amount;
  }
  return null;
}

function dayDiff(a: string, b: string): number {
  const da = new Date(a + 'T00:00:00').getTime();
  const db = new Date(b + 'T00:00:00').getTime();
  return Math.abs(da - db) / 86_400_000;
}
