import { Transaction } from '../models';

/**
 * Pending is the bank's state right now, not something a row should
 * remember. Each sync the server records what the bank still has as pending
 * (last 30 days) and which posted transaction each pending one became; this
 * works out what to do with every row the app still marks Pending.
 */
export interface BankPending {
  itemId: string;
  /** The first day the bank's pending list covers. */
  windowStart: string;
  pendingIds: string[];
  /** pending id -> the posted transaction it became, when the bank links them. */
  postedFrom: Record<string, string>;
}

export type PendingAction =
  /** The bank posted it as a separate row: fold that into this one (your edits stay). */
  | { kind: 'fold'; row: Transaction; posted: Transaction }
  /** It's posted and nothing else stands for it: just stop calling it pending. */
  | { kind: 'posted'; row: Transaction }
  /** The bank dropped it and nothing posted for it: a cancelled charge. */
  | { kind: 'cancelled'; row: Transaction }
  /** The bank has it as pending but the app had lost that (a merge or edit from before it carried over). */
  | { kind: 'pending'; row: Transaction };

/** Days a pending row may wait with no word from its bank before it's taken as posted. */
const NO_WORD_DAYS = 10;
/** How far apart a pending row and its posted version can be dated. */
const MATCH_DAYS = 5;

export function settlePending(transactions: Transaction[], banks: BankPending[], today: string): PendingAction[] {
  const byItem = new Map(banks.map(b => [b.itemId, b]));
  const linked = linkedIds(transactions);
  const claimed = new Set<string>();
  const actions: PendingAction[] = [];

  const pendingAtBank = new Set(banks.flatMap(b => b.pendingIds));
  for (const row of transactions) {
    if (!row.id) continue;
    if (!row.plaidPending) {
      if (row.plaidTransactionId && pendingAtBank.has(row.plaidTransactionId)) actions.push({ kind: 'pending', row });
      continue;
    }
    const bank = row.plaidItemId ? byItem.get(row.plaidItemId) : undefined;
    const inWindow = !!bank && row.date >= bank.windowStart;

    if (!row.bankRemoved) {
      if (bank && inWindow && bank.pendingIds.includes(row.plaidTransactionId ?? '')) continue; // still pending
      // No word from its bank yet: leave recent ones alone.
      if (!bank && daysBetween(row.date, today) < NO_WORD_DAYS) continue;
    }

    const posted = postedVersion(row, transactions, bank, linked, claimed);
    if (posted) {
      claimed.add(posted.id!);
      actions.push({ kind: 'fold', row, posted });
    } else if (row.bankRemoved) {
      actions.push({ kind: 'cancelled', row });
    } else {
      actions.push({ kind: 'posted', row });
    }
  }
  return actions;
}

/**
 * The posted row standing for a pending one: the one the bank links it to,
 * or else (some banks never link them) a new row on the same account for the
 * same money within a few days. A restaurant charge can post higher once the
 * tip goes on, so a higher amount counts when the merchant name agrees.
 * Only a row exactly as the bank sent it, and linked to nothing, is folded in.
 */
function postedVersion(
  row: Transaction, transactions: Transaction[], bank: BankPending | undefined,
  linked: Set<string>, claimed: Set<string>,
): Transaction | undefined {
  const usable = (t: Transaction) =>
    !!t.id && t.id !== row.id && !t.plaidPending && !claimed.has(t.id) && !linked.has(t.id) &&
    t.createdAt === t.updatedAt && t.plaidAccountId === row.plaidAccountId && t.type === row.type;

  const linkedId = bank?.postedFrom[row.plaidTransactionId ?? ''];
  if (linkedId) {
    const exact = transactions.find(t => t.plaidTransactionId === linkedId && usable(t));
    if (exact) return exact;
  }

  let best: Transaction | undefined;
  let bestScore = Infinity;
  for (const t of transactions) {
    if (!usable(t)) continue;
    const days = daysBetween(t.date, row.date);
    if (days > MATCH_DAYS) continue;
    const same = Math.abs(t.amount - row.amount) < 0.005;
    const tipped = t.amount > row.amount && t.amount <= row.amount * 1.3 && sameMerchant(t, row);
    if (!same && !tipped) continue;
    const score = days + (same ? 0 : 10);
    if (score < bestScore) { best = t; bestScore = score; }
  }
  return best;
}

function sameMerchant(a: Transaction, b: Transaction): boolean {
  const norm = (s?: string) => (s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const x = norm(a.merchant), y = norm(b.merchant);
  return !!x && !!y && (x.includes(y) || y.includes(x));
}

function linkedIds(transactions: Transaction[]): Set<string> {
  const ids = new Set<string>();
  for (const t of transactions) {
    if (t.reimbursesId) ids.add(t.reimbursesId);
    for (const s of t.moneyBackSplits ?? []) ids.add(s.expenseId);
    for (const m of t.moneyBack ?? []) if (m.incomeId) ids.add(m.incomeId);
  }
  return ids;
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a + 'T00:00:00').getTime() - new Date(b + 'T00:00:00').getTime()) / 86_400_000;
}
