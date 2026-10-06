import { Account, AccountType, ManualAsset, ManualAssetType, Transaction } from '../models';
import { localDateString, parseLocalDate } from './date';
import { owesMoney } from './finance';
import { LoanPayment, countsInNetWorth, estimatedValue, loanOwedOn, loanPayments } from './loans';

/**
 * Net worth: everything you own minus everything you owe, today and on any
 * past date.
 *
 * Account balances are rebuilt from transactions: a balance on a date is the
 * account's opening balance plus every transaction up to and including that
 * day. (For a bank-linked account the opening balance is reconciled so that
 * today's figure matches the bank, so walking back from it is exact for as far
 * back as the transaction history goes, and flat before that.)
 *
 * Manual assets and debts carry dated valuations, and count from their first
 * valuation onwards — a house added today does not appear in last year's
 * figure as if you had always owned it.
 *
 * Pure functions, so the page and the tests share one implementation.
 */

export type Side = 'asset' | 'liability';

export type GroupKey =
  | 'cash' | 'savings' | 'investments' | 'property' | 'vehicles' | 'owed-to-you' | 'other-assets'
  | 'credit' | 'loans' | 'other-liabilities';

/** Groups in the order the page lists them. */
export const GROUPS: { key: GroupKey; label: string; side: Side }[] = [
  { key: 'cash',              label: 'Cash',           side: 'asset' },
  { key: 'savings',           label: 'Savings',        side: 'asset' },
  { key: 'investments',       label: 'Investments',    side: 'asset' },
  { key: 'property',          label: 'Real estate',    side: 'asset' },
  { key: 'vehicles',          label: 'Vehicles',       side: 'asset' },
  { key: 'owed-to-you',       label: 'Owed to you',    side: 'asset' },
  { key: 'other-assets',      label: 'Other assets',   side: 'asset' },
  { key: 'credit',            label: 'Credit cards',   side: 'liability' },
  { key: 'loans',             label: 'Loans',          side: 'liability' },
  { key: 'other-liabilities', label: 'Other debts',    side: 'liability' },
];

/** Every kind of manual entry: what it is called, which side it sits on, where it groups. */
export const MANUAL_TYPES: {
  value: ManualAssetType; label: string; side: Side; group: GroupKey; icon: string;
}[] = [
  { value: 'property',        label: 'Home or property', side: 'asset',     group: 'property',          icon: '🏠' },
  { value: 'vehicle',         label: 'Vehicle',          side: 'asset',     group: 'vehicles',          icon: '🚗' },
  { value: 'investment',      label: 'Investment or retirement', side: 'asset', group: 'investments', icon: '📈' },
  { value: 'cash',            label: 'Cash or deposit',  side: 'asset',     group: 'cash',              icon: '💵' },
  { value: 'valuable',        label: 'Valuable item',    side: 'asset',     group: 'other-assets',      icon: '💎' },
  { value: 'loan-given',      label: 'Money I lent',     side: 'asset',     group: 'owed-to-you',       icon: '🤲' },
  { value: 'other-asset',     label: 'Other asset',      side: 'asset',     group: 'other-assets',      icon: '📦' },
  { value: 'mortgage',        label: 'Mortgage',         side: 'liability', group: 'loans',             icon: '🏦' },
  { value: 'auto-loan',       label: 'Auto loan',        side: 'liability', group: 'loans',             icon: '🚙' },
  { value: 'student-loan',    label: 'Student loan',     side: 'liability', group: 'loans',             icon: '🎓' },
  { value: 'personal-loan',   label: 'Personal loan',    side: 'liability', group: 'loans',             icon: '🤝' },
  { value: 'other-liability', label: 'Other debt',       side: 'liability', group: 'other-liabilities', icon: '📄' },
];

export function manualType(type: ManualAssetType) {
  return MANUAL_TYPES.find(t => t.value === type) ?? MANUAL_TYPES.find(t => t.value === 'other-asset')!;
}

export function accountGroup(type: AccountType): GroupKey {
  switch (type) {
    case 'savings': return 'savings';
    case 'investment': return 'investments';
    case 'credit': return 'credit';
    case 'loan': return 'loans';
    default: return 'cash'; // checking, cash
  }
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Accounts ─────────────────────────────────────────────────

/** How one transaction moves one account's transaction total (before credit-card sign). */
function deltasOf(t: Transaction): [string, number][] {
  if (t.type === 'income' && t.accountId) return [[t.accountId, t.amount]];
  if (t.type === 'expense' && t.accountId) return [[t.accountId, -t.amount]];
  if (t.type === 'transfer') {
    const out: [string, number][] = [];
    if (t.fromAccountId) out.push([t.fromAccountId, -t.amount]);
    if (t.toAccountId) out.push([t.toAccountId, t.amount]);
    return out;
  }
  return [];
}

/**
 * What an account adds to net worth given its transaction total. A card's
 * balance is what you owe (opening − total), so it subtracts; every other
 * account's balance (opening + total) adds. Same arithmetic as
 * `accountBalance` in finance.ts.
 */
function contribution(account: Account, txTotal: number): number {
  return owesMoney(account.type)
    ? -(account.openingBalance - txTotal)
    : (account.openingBalance || 0) + txTotal;
}

/** The account's balance as the app shows it (a card shows what you owe). */
export function balanceOn(account: Account, txs: Transaction[], date: string): number {
  let total = 0;
  for (const t of txs) {
    if (t.date > date) continue;
    for (const [id, d] of deltasOf(t)) if (id === account.id) total += d;
  }
  return round2(owesMoney(account.type) ? account.openingBalance - total : (account.openingBalance || 0) + total);
}

// ── Manual entries ───────────────────────────────────────────

export function sortedValuations(asset: ManualAsset) {
  return [...(asset.valuations ?? [])].sort((a, b) => a.date.localeCompare(b.date));
}

/** Value on a date: the latest valuation on or before it; null before the first. */
export function valueOn(asset: ManualAsset, date: string): number | null {
  let v: number | null = null;
  for (const val of sortedValuations(asset)) {
    if (val.date > date) break;
    v = val.value;
  }
  return v;
}

export function currentValue(asset: ManualAsset, today = localDateString()): number {
  return valueOn(asset, today) ?? 0;
}

/**
 * The valuations after recording `value` on `date`: replaces a valuation on
 * the same day, otherwise adds one. History before and after is untouched.
 */
export function withValuation(valuations: ManualAsset['valuations'], date: string, value: number) {
  const rest = (valuations ?? []).filter(v => v.date !== date);
  return [...rest, { date, value: round2(value) }].sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * What a manual entry is worth on a date, by the best information there is:
 * a loan's running balance from its terms and payments; a car's estimated
 * value as it loses worth; otherwise the latest value you entered. Null
 * before it existed.
 *
 * `payments` lets a caller that asks about many dates find a loan's
 * payments once rather than per date.
 */
export function entryValueOn(
  asset: ManualAsset, txs: Transaction[], date: string, payments?: LoanPayment[],
): number | null {
  if (asset.loan) return loanOwedOn(asset, txs, date, payments ?? loanPayments(asset, txs));
  const estimate = estimatedValue(asset, date);
  if (estimate !== null) return estimate;
  return valueOn(asset, date);
}

// ── Holdings: everything on one date, grouped ────────────────

export interface Holding {
  key: string;
  kind: 'account' | 'manual';
  id: string;
  name: string;
  icon: string;
  subtitle: string;
  group: GroupKey;
  side: Side;
  /** Always positive; `side` says whether it adds or subtracts. */
  amount: number;
}

/**
 * Everything counted in net worth on `date`. Accounts land on the side their
 * balance puts them — an overpaid card is an asset, an overdrawn checking
 * account a debt — which is how the Accounts page already counts them.
 */
export function holdingsOn(
  accounts: Account[], manual: ManualAsset[], txs: Transaction[], date: string,
): Holding[] {
  const out: Holding[] = [];
  for (const a of accounts) {
    if (a.archived || !a.id) continue;
    const bal = balanceOn(a, txs, date);
    const c = owesMoney(a.type) ? -bal : bal;
    if (c === 0) continue;
    const side: Side = c > 0 ? 'asset' : 'liability';
    let group = accountGroup(a.type);
    const debtGroup = group === 'credit' || group === 'loans';
    if (side === 'asset' && debtGroup) group = 'other-assets';
    if (side === 'liability' && !debtGroup) group = 'other-liabilities';
    out.push({
      key: `a:${a.id}`, kind: 'account', id: a.id, name: a.name, icon: a.icon || '🏦',
      subtitle: [a.institution, a.last4 ? `•••• ${a.last4}` : ''].filter(Boolean).join(' · ') || accountTypeLabel(a.type),
      group, side, amount: round2(Math.abs(c)),
    });
  }
  for (const m of manual) {
    if (m.archived || !m.id || !countsInNetWorth(m)) continue;
    const v = entryValueOn(m, txs, date);
    if (v === null || v === 0) continue;
    const t = manualType(m.type);
    out.push({
      key: `m:${m.id}`, kind: 'manual', id: m.id, name: m.name, icon: t.icon,
      subtitle: t.label, group: t.group, side: t.side, amount: round2(Math.abs(v)),
    });
  }
  return out;
}

function accountTypeLabel(type: AccountType): string {
  return { checking: 'Checking', savings: 'Savings', credit: 'Credit card', cash: 'Cash', investment: 'Investment', loan: 'Loan' }[type];
}

export interface HoldingGroup {
  key: GroupKey;
  label: string;
  side: Side;
  total: number;
  /** Share of its side's total, 0–1. */
  share: number;
  items: Holding[];
}

export interface Composition {
  assets: number;
  liabilities: number;
  net: number;
  assetGroups: HoldingGroup[];
  liabilityGroups: HoldingGroup[];
}

export function composition(holdings: Holding[]): Composition {
  const assets = round2(holdings.filter(h => h.side === 'asset').reduce((s, h) => s + h.amount, 0));
  const liabilities = round2(holdings.filter(h => h.side === 'liability').reduce((s, h) => s + h.amount, 0));
  const groups = (side: Side): HoldingGroup[] => {
    const sideTotal = side === 'asset' ? assets : liabilities;
    return GROUPS.filter(g => g.side === side)
      .map(g => {
        const items = holdings.filter(h => h.group === g.key && h.side === side)
          .sort((a, b) => b.amount - a.amount);
        const total = round2(items.reduce((s, h) => s + h.amount, 0));
        return { key: g.key, label: g.label, side, total, share: sideTotal > 0 ? total / sideTotal : 0, items };
      })
      .filter(g => g.items.length > 0);
  };
  return {
    assets, liabilities, net: round2(assets - liabilities),
    assetGroups: groups('asset'), liabilityGroups: groups('liability'),
  };
}

// ── History ──────────────────────────────────────────────────

export interface NetWorthPoint {
  date: string;
  assets: number;
  liabilities: number;
  net: number;
}

/**
 * Net worth on each of `dates` (ascending). One pass over the transactions
 * rather than a full recount per date, so a year of history stays cheap.
 * Agrees with `holdingsOn` for any single date — the tests hold it to that.
 */
export function netWorthSeries(
  accounts: Account[], manual: ManualAsset[], txs: Transaction[], dates: string[],
): NetWorthPoint[] {
  const active = accounts.filter(a => !a.archived && a.id);
  const ids = new Set(active.map(a => a.id!));
  const moves: { date: string; id: string; d: number }[] = [];
  for (const t of txs) for (const [id, d] of deltasOf(t)) if (ids.has(id)) moves.push({ date: t.date, id, d });
  moves.sort((a, b) => a.date.localeCompare(b.date));

  const totals = new Map<string, number>(active.map(a => [a.id!, 0]));
  const liveManual = manual.filter(m => !m.archived && m.id && countsInNetWorth(m));
  // Find each loan's payments once, not once per date.
  const loanPays = new Map(liveManual.filter(m => m.loan).map(m => [m.id!, loanPayments(m, txs)]));
  const out: NetWorthPoint[] = [];
  let i = 0;
  for (const date of dates) {
    while (i < moves.length && moves[i].date <= date) {
      totals.set(moves[i].id, totals.get(moves[i].id)! + moves[i].d);
      i++;
    }
    let assets = 0, liabilities = 0;
    for (const a of active) {
      const c = round2(contribution(a, totals.get(a.id!)!));
      if (c > 0) assets += c; else liabilities -= c;
    }
    for (const m of liveManual) {
      const v = entryValueOn(m, txs, date, loanPays.get(m.id!));
      if (v === null) continue;
      if (manualType(m.type).side === 'asset') assets += Math.abs(v); else liabilities += Math.abs(v);
    }
    out.push({ date, assets: round2(assets), liabilities: round2(liabilities), net: round2(assets - liabilities) });
  }
  return out;
}

export type Range = '1M' | '3M' | '6M' | '1Y' | 'ALL';
export const RANGES: Range[] = ['1M', '3M', '6M', '1Y', 'ALL'];

/** Earliest date anything is known: first transaction or first valuation. */
export function earliestDate(txs: Transaction[], manual: ManualAsset[]): string | null {
  let first: string | null = null;
  for (const t of txs) if (!first || t.date < first) first = t.date;
  for (const m of manual) {
    for (const v of m.valuations ?? []) if (!first || v.date < first) first = v.date;
    const start = m.loan?.startDate ?? m.purchase?.date;
    if (start && (!first || start < first)) first = start;
  }
  return first;
}

/**
 * Dates to plot for a range, ending today. At most ~120 points so the line
 * stays smooth without drawing a point per day for years. "All" starts at
 * your first transaction or valuation (and never shows less than a month).
 */
export function rangeDates(range: Range, today: string, earliest: string | null): string[] {
  const end = parseLocalDate(today);
  let start: Date;
  switch (range) {
    case '1M': start = monthsBefore(end, 1); break;
    case '3M': start = monthsBefore(end, 3); break;
    case '6M': start = monthsBefore(end, 6); break;
    case '1Y': start = monthsBefore(end, 12); break;
    case 'ALL': {
      const monthAgo = monthsBefore(end, 1);
      const first = earliest ? parseLocalDate(earliest) : monthAgo;
      start = first < monthAgo ? first : monthAgo;
      break;
    }
  }
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  const step = Math.max(1, Math.ceil(days / 120));
  const out: string[] = [];
  // Walk back from today so the last point is always exactly today.
  for (let back = 0; back <= days; back += step) {
    const d = new Date(end);
    d.setDate(d.getDate() - back);
    out.push(localDateString(d));
  }
  if (out[out.length - 1] !== localDateString(start)) out.push(localDateString(start));
  return out.reverse();
}

/** Same day n months earlier, clamped to month end (31 Mar → 28/29 Feb, not 3 Mar). */
function monthsBefore(d: Date, n: number): Date {
  const target = new Date(d.getFullYear(), d.getMonth() - n, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(d.getDate(), last));
  return target;
}

export function changeOver(series: NetWorthPoint[]): { amount: number; pct: number | null } {
  if (series.length < 2) return { amount: 0, pct: null };
  const first = series[0].net;
  const amount = round2(series[series.length - 1].net - first);
  return { amount, pct: first !== 0 ? amount / Math.abs(first) : null };
}
