import { Transaction } from '../models';

/**
 * Spending worth a second look, worked out from your own history. Three kinds:
 *  - `big`: a charge well above what you usually spend at that merchant
 *    (at least twice the usual and $15 more, with three earlier charges to
 *    know what usual is);
 *  - `twice`: the same charge twice, same merchant, amount and account,
 *    within a day of each other;
 *  - `price`: a monthly charge that went up (a subscription costing more).
 * Each has a stable `key`, so a dismissed one stays dismissed.
 */
export type AlertKind = 'big' | 'twice' | 'price';

export interface SpendingAlert {
  key: string;
  kind: AlertKind;
  /** The charge it's about (the later one, for a repeat). */
  tx: Transaction;
  /** The earlier charge, for a repeat. */
  other?: Transaction;
  /** What's usual: the median at that merchant, or the previous price. */
  usual?: number;
  date: string;
}

/** How far back a charge can be and still be flagged. */
const RECENT_DAYS = 14;
/** How far back "usual" looks. */
const HISTORY_DAYS = 180;
const BIG_MIN_EXTRA = 15;

export function spendingAlerts(transactions: Transaction[], today: string): SpendingAlert[] {
  const spend = transactions.filter(isSpending);
  const recentFrom = addDays(today, -RECENT_DAYS);
  const byMerchant = groupBy(spend, t => merchantKey(t.merchant));
  const alerts: SpendingAlert[] = [];

  for (const [merchant, rows] of byMerchant) {
    if (!merchant) continue;
    const sorted = [...rows].sort((a, b) => a.date.localeCompare(b.date));

    // A monthly charge that went up.
    const monthly = monthlyRun(sorted);
    if (monthly) {
      const [prev, last] = monthly;
      const rise = last.amount - prev.amount;
      if (last.date >= addDays(today, -40) && rise >= 1 && rise >= prev.amount * 0.05) {
        alerts.push({ key: `price:${last.id}`, kind: 'price', tx: last, usual: prev.amount, date: last.date });
      }
    }

    for (const t of sorted) {
      if (t.date < recentFrom) continue;
      // Well above the usual at this merchant.
      const earlier = sorted.filter(o => o.id !== t.id && o.date < t.date && o.date >= addDays(t.date, -HISTORY_DAYS));
      if (earlier.length >= 3 && !(monthly && monthly[1].id === t.id)) {
        const usual = median(earlier.map(o => o.amount));
        if (t.amount >= usual * 2 && t.amount - usual >= BIG_MIN_EXTRA) {
          alerts.push({ key: `big:${t.id}`, kind: 'big', tx: t, usual, date: t.date });
        }
      }
    }

    // The same charge twice.
    for (let i = 0; i < sorted.length; i++) {
      const a = sorted[i];
      if (a.date < addDays(recentFrom, -1)) continue;
      for (let j = i + 1; j < sorted.length; j++) {
        const b = sorted[j];
        if (daysBetween(a.date, b.date) > 1) break;
        if (b.date < recentFrom) continue;
        if (Math.abs(a.amount - b.amount) >= 0.005 || a.accountId !== b.accountId) continue;
        // A pending charge and its posted copy are one charge (the app folds them).
        if (!!a.plaidPending !== !!b.plaidPending) continue;
        const ids = [a.id, b.id].sort();
        alerts.push({ key: `twice:${ids[0]}:${ids[1]}`, kind: 'twice', tx: b, other: a, date: b.date });
      }
    }
  }

  return alerts.sort((x, y) => y.date.localeCompare(x.date));
}

/** Spending a person makes, not money moving between their own accounts or to friends. */
function isSpending(t: Transaction): boolean {
  return t.type === 'expense' && !!t.id && !t.isInternalTransfer && !t.settlement && t.amount > 0;
}

/**
 * The last two charges of a monthly run (three or more charges, each 25 to
 * 35 days after the one before), or null.
 */
function monthlyRun(sorted: Transaction[]): [Transaction, Transaction] | null {
  if (sorted.length < 3) return null;
  const [a, b, c] = sorted.slice(-3);
  const gaps = [daysBetween(a.date, b.date), daysBetween(b.date, c.date)];
  return gaps.every(g => g >= 25 && g <= 35) ? [b, c] : null;
}

/** A merchant name without card numbers, store numbers and punctuation, so "UBER *TRIP 1234" matches "Uber Trip". */
export function merchantKey(name?: string): string {
  return (name ?? '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function groupBy<T>(xs: T[], key: (x: T) => string): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const x of xs) {
    const k = key(x);
    out.set(k, [...(out.get(k) ?? []), x]);
  }
  return out;
}

function addDays(date: string, days: number): string {
  const d = new Date(date + 'T00:00:00');
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysBetween(a: string, b: string): number {
  return Math.round(Math.abs(new Date(b + 'T00:00:00').getTime() - new Date(a + 'T00:00:00').getTime()) / 86_400_000);
}
