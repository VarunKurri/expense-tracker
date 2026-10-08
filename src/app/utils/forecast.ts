import { Account, Bill, ManualAsset, Transaction } from '../models';
import { advanceDueDate, monthlyCost } from './bill-schedule';
import { localDateString, parseLocalDate } from './date';
import { countsInNetWorth, loanDirection, loanOutlook, loanPayments, matchTolerance } from './loans';
import { balanceOn, entryValueOn, manualType } from './net-worth';
import { MoneyRules, expenseAmount, monthlySeries, refundedOut, spendingTransactions } from './reporting';

/**
 * The forecast: where your cash and net worth are heading if the next months
 * look like the last few.
 *
 * Deliberately simple and explainable — no simulations. Three kinds of money:
 *
 *  - **Known and dated**: bills and subscriptions on their real due dates (a
 *    yearly insurance bill is a spike in its month, not smeared across the
 *    year), and every loan payment still to come, in either direction.
 *  - **Typical**: income and everyday spending, averaged over past months you
 *    choose — using the same rules as Analysis (no internal transfers,
 *    reimbursements netted, refunded expenses left out).
 *  - **Not assumed**: investments don't grow, nothing else changes value
 *    except things that depreciate.
 *
 * Loan payments are taken out of the history before averaging and added back
 * on their schedule, so they're never counted twice and stop when the loan
 * ends. Bills are taken out of everyday spending by their monthly equivalent.
 *
 * Pure functions: the Forecast page, the Net worth chart and the tests share them.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

// ── Months ───────────────────────────────────────────────────

/** "2026-10" → the first and last day of that month. */
function monthBounds(month: string): { start: string; end: string } {
  const [y, m] = month.split('-').map(Number);
  return { start: `${month}-01`, end: localDateString(new Date(y, m, 0)) };
}

function addMonths(month: string, n: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string, long = false): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US', long ? { month: 'long', year: 'numeric' } : { month: 'short' });
}

/** The last `n` complete months before `today`'s month, oldest first. The month in progress is never one. */
export function pastMonths(today: string, n: number): string[] {
  const current = today.slice(0, 7);
  return Array.from({ length: n }, (_, i) => addMonths(current, i - n));
}

// ── Cash ─────────────────────────────────────────────────────

/**
 * Money that is yours to spend: checking, savings and cash, less what you owe
 * on credit cards (card spending already counted when it happened, so the
 * balance is money already spent). Investments and loans are left out.
 */
export function cashOn(accounts: Account[], txs: Transaction[], date: string): number {
  let cash = 0;
  for (const a of accounts) {
    if (a.archived || !a.id) continue;
    if (a.type === 'checking' || a.type === 'savings' || a.type === 'cash') cash += balanceOn(a, txs, date);
    else if (a.type === 'credit') cash -= balanceOn(a, txs, date);
  }
  return round2(cash);
}

// ── Known, dated money ───────────────────────────────────────

export interface ForecastItem {
  date: string;
  name: string;
  kind: 'bill' | 'loan-out' | 'loan-in';
  /** Always positive; `kind` says which way it moves. */
  amount: number;
  /** For a loan payment: the interest part (what changes net worth). */
  interest?: number;
  /** Was due before today and is still outstanding — counted today. */
  overdue?: boolean;
  /** The bill or loan it came from. */
  sourceId?: string;
  /** For a loan: whether it counts in net worth. */
  inNetWorth?: boolean;
}

/** A bill that is really a loan's payment ("Car payment" next to a car loan): the loan covers it. */
export function billIsLoanPayment(bill: Bill, loans: ManualAsset[]): boolean {
  const name = bill.name.trim().toLowerCase();
  return loans.some(l => {
    const t = l.loan;
    const text = t?.match?.text?.trim().toLowerCase();
    if (!t || !text || !name) return false;
    const named = name.includes(text) || text.includes(name);
    return named && Math.abs(bill.amount - t.payment) <= matchTolerance(t.payment);
  });
}

/**
 * Every bill payment from today to `end`. A bill already past due counts once,
 * today — it's still to be paid — and then carries on from its next date.
 */
export function billItems(bills: Bill[], loans: ManualAsset[], today: string, end: string): ForecastItem[] {
  const out: ForecastItem[] = [];
  for (const b of bills) {
    if (!b.active || !b.nextDueDate || !(b.amount > 0) || billIsLoanPayment(b, loans)) continue;
    let d = b.nextDueDate;
    if (d < today) {
      out.push({ date: today, name: b.name, kind: 'bill', amount: round2(b.amount), overdue: true, sourceId: b.id });
      for (let guard = 0; d < today && guard < 1000; guard++) d = advanceDueDate(d, b.frequency);
      // The overdue one stands in for any that fell due since; carry on from the next.
      if (d === today) d = advanceDueDate(d, b.frequency);
    }
    for (let guard = 0; d <= end && guard < 1000; guard++) {
      out.push({ date: d, name: b.name, kind: 'bill', amount: round2(b.amount), sourceId: b.id });
      d = advanceDueDate(d, b.frequency);
    }
  }
  return out;
}

/**
 * Every loan payment still to come, to `end`: out for a loan you took, in for
 * money you lent (including someone else's loan repaid to you — the money
 * reaches your account even though the balance isn't yours). A payment whose
 * date has passed but is still expected comes in today.
 */
export function loanItems(loans: ManualAsset[], txs: Transaction[], today: string, end: string): ForecastItem[] {
  const out: ForecastItem[] = [];
  for (const l of loans) {
    if (l.archived || !l.loan) continue;
    const lent = loanDirection(l.type) === 'lent';
    for (const r of loanOutlook(l, txs, today).upcoming) {
      const date = r.date < today ? today : r.date;
      if (date > end) break;
      out.push({
        date, name: l.name, kind: lent ? 'loan-in' : 'loan-out', amount: r.payment, interest: r.interest,
        overdue: r.date < today, sourceId: l.id, inNetWorth: countsInNetWorth(l),
      });
    }
  }
  return out;
}

// ── Typical money: the history it's based on ─────────────────

export interface BaseMonth {
  month: string;
  label: string;
  /** Income, without loan repayments to you (those come from the schedule). */
  income: number;
  /** All spending, without loan payments (those come from the schedule). */
  spending: number;
  /** Spending that isn't bills: spending less the bills' monthly equivalent. */
  everyday: number;
  /** Counted in the averages (you can leave a one-off month out). */
  included: boolean;
}

/** One category's share of everyday spending in a typical month. */
export interface EverydayCategory {
  /** `__none__` for uncategorised spending. */
  categoryId: string;
  /** Average a month spent in it, over the months counted. */
  spent: number;
  /** Bills filed under it, per month — they're forecast on their dates instead. */
  bills: number;
  /** Their names, so "less $100 in bills" can say which. */
  billNames: string[];
  /** spent − bills, never below zero: what the forecast assumes each month. */
  everyday: number;
}

export interface ForecastBasis {
  months: BaseMonth[];
  income: number;
  /** Everyday spending per month: the categories, less any bills no category could be found for. */
  everyday: number;
  /** What the bills cost per month, on average — taken out of spending to leave "everyday". */
  billsMonthly: number;
  /** Everyday spending by category, largest first. Adds up to `everyday` with `unfiledBills`. */
  categories: EverydayCategory[];
  /** Bills (per month) with no category of their own and no past payment to take one from. */
  unfiledBills: number;
  unfiledBillNames: string[];
}

/**
 * Where a bill's payments land: its own category, or failing that, the
 * category of the latest transaction named like it (a "Netflix" bill pays
 * the "NETFLIX.COM" charge filed under Entertainment). Null if neither.
 */
export function billCategory(bill: Bill, txs: Transaction[]): string | null {
  if (bill.categoryId) return bill.categoryId;
  const name = bill.name.trim().toLowerCase();
  if (name.length < 3) return null;
  let best: Transaction | null = null;
  for (const t of txs) {
    if (t.type !== 'expense' || !t.categoryId) continue;
    const hay = `${t.merchant ?? ''} ${t.notes ?? ''}`.toLowerCase();
    if (!hay.includes(name)) continue;
    if (!best || t.date > best.date) best = t;
  }
  return best?.categoryId ?? null;
}

/**
 * Average income and everyday spending over `months`, leaving out any in
 * `excluded`. Loan payments in either direction are taken out first, and so
 * are fully refunded expenses (as Analysis does while counting money back).
 *
 * Everyday spending is worked out per category: the category's average
 * spending, less the bills that file under it (their monthly cost), never
 * below zero. A quarterly insurance bill that lands in one month out of three
 * then nets out to nothing, rather than leaving "everyday" insurance behind.
 */
export function forecastBasis(
  txs: Transaction[], loans: ManualAsset[], bills: Bill[], rules: MoneyRules, months: string[], excluded: string[] = [],
): ForecastBasis {
  const loanTx = new Set<string>();
  for (const l of loans) {
    if (!l.loan) continue;
    for (const p of loanPayments(l, txs)) if (p.kind === 'payment' && p.tx.id) loanTx.add(p.tx.id);
  }
  const counted = txs.filter(t => !(t.id && loanTx.has(t.id)) && !refundedOut(t, rules));
  const liveBills = bills.filter(b => b.active && b.amount > 0 && !billIsLoanPayment(b, loans));
  const billsMonthly = round2(liveBills.reduce((s, b) => s + monthlyCost(b.amount, b.frequency), 0));

  const skip = new Set(excluded);
  const rows: BaseMonth[] = monthlySeries(counted, rules, months).map(r => ({
    month: r.month,
    label: monthLabel(r.month, true),
    income: r.income,
    spending: r.expenses,
    everyday: round2(Math.max(0, r.expenses - billsMonthly)),
    included: !skip.has(r.month),
  }));
  const used = rows.filter(r => r.included);
  const avg = (f: (r: BaseMonth) => number) => used.length ? round2(used.reduce((s, r) => s + f(r), 0) / used.length) : 0;

  // Spending per category over the months counted, then a monthly average.
  const usedMonths = new Set(used.map(r => r.month));
  const spentBy = new Map<string, number>();
  for (const t of spendingTransactions(counted)) {
    if (!usedMonths.has(t.date.slice(0, 7))) continue;
    const key = t.categoryId || '__none__';
    spentBy.set(key, (spentBy.get(key) ?? 0) + expenseAmount(t, rules));
  }
  // Bills, per month, by the category they file under.
  const billsBy = new Map<string, { amount: number; names: string[] }>();
  let unfiledBills = 0;
  const unfiledBillNames: string[] = [];
  for (const b of liveBills) {
    const monthly = monthlyCost(b.amount, b.frequency);
    const cat = billCategory(b, counted);
    if (!cat) { unfiledBills += monthly; unfiledBillNames.push(b.name); continue; }
    const e = billsBy.get(cat) ?? { amount: 0, names: [] };
    e.amount += monthly;
    e.names.push(b.name);
    billsBy.set(cat, e);
  }

  const n = used.length;
  const categories: EverydayCategory[] = [...new Set([...spentBy.keys(), ...billsBy.keys()])]
    .map(categoryId => {
      const spent = n ? round2((spentBy.get(categoryId) ?? 0) / n) : 0;
      const b = billsBy.get(categoryId);
      const billsAmt = round2(b?.amount ?? 0);
      return { categoryId, spent, bills: billsAmt, billNames: b?.names ?? [], everyday: round2(Math.max(0, spent - billsAmt)) };
    })
    .filter(c => c.spent > 0)
    .sort((a, b) => b.everyday - a.everyday || b.spent - a.spent);

  const everyday = round2(Math.max(0, categories.reduce((s, c) => s + c.everyday, 0) - unfiledBills));
  return {
    months: rows, income: avg(r => r.income), everyday, billsMonthly,
    categories, unfiledBills: round2(unfiledBills), unfiledBillNames,
  };
}

// ── The forecast ─────────────────────────────────────────────

export interface ForecastMonth {
  month: string;
  label: string;
  /** The month in progress: only what's left of it is forecast. */
  partial: boolean;
  /** The last day of the month — where the cash figure is read. */
  end: string;
  income: number;
  repayments: number;
  bills: number;
  loans: number;
  everyday: number;
  net: number;
  /** Cash at the end of the month. */
  cash: number;
  items: ForecastItem[];
}

export interface Forecast {
  startCash: number;
  basis: ForecastBasis;
  months: ForecastMonth[];
  /** Cash at the end of the window. */
  endCash: number;
  /** Average monthly net over the full months — "you put away about $X a month". */
  monthlyNet: number;
  /** The biggest single known payment ahead, for the headline. */
  biggest: ForecastItem | null;
  /** Too little history to average: the forecast would only be a guess. */
  thin: boolean;
}

export interface ForecastInput {
  accounts: Account[];
  manual: ManualAsset[];
  bills: Bill[];
  txs: Transaction[];
  rules: MoneyRules;
  today: string;
  /** Months ahead, counting the one in progress as the first. */
  horizon: number;
  /** How many past months to average over. */
  baseMonths: number;
  /** Past months you left out of the averages. */
  excluded?: string[];
}

export function forecast(input: ForecastInput): Forecast {
  const { accounts, manual, bills, txs, rules, today, horizon } = input;
  const loans = manual.filter(m => m.loan && !m.archived);
  const basis = forecastBasis(txs, loans, bills, rules, pastMonths(today, input.baseMonths), input.excluded);
  const first = today.slice(0, 7);
  const last = addMonths(first, horizon - 1);
  const windowEnd = monthBounds(last).end;

  const items = [...billItems(bills, loans, today, windowEnd), ...loanItems(loans, txs, today, windowEnd)]
    .sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));

  const startCash = cashOn(accounts, txs, today);
  let cash = startCash;
  const months: ForecastMonth[] = [];
  for (let i = 0; i < horizon; i++) {
    const month = addMonths(first, i);
    const { start, end } = monthBounds(month);
    // The month in progress: only the days still to come.
    const partial = i === 0;
    const days = parseLocalDate(end).getDate();
    const share = partial ? (days - parseLocalDate(today).getDate()) / days : 1;
    const mine = items.filter(it => it.date >= start && it.date <= end);
    const sum = (k: ForecastItem['kind']) => round2(mine.filter(it => it.kind === k).reduce((s, it) => s + it.amount, 0));
    const income = round2(basis.income * share);
    const everyday = round2(basis.everyday * share);
    const repayments = sum('loan-in'), billsOut = sum('bill'), loansOut = sum('loan-out');
    const net = round2(income + repayments - billsOut - loansOut - everyday);
    cash = round2(cash + net);
    months.push({
      month, label: monthLabel(month), partial, end, income, repayments, bills: billsOut, loans: loansOut,
      everyday, net, cash, items: mine,
    });
  }

  const full = months.filter(m => !m.partial);
  const monthlyNet = full.length ? round2(full.reduce((s, m) => s + m.net, 0) / full.length) : 0;
  const biggest = items.filter(it => it.kind !== 'loan-in')
    .reduce<ForecastItem | null>((b, it) => (!b || it.amount > b.amount ? it : b), null);
  return {
    startCash, basis, months, endCash: cash, monthlyNet, biggest,
    thin: !basis.months.some(m => m.included && (m.income > 0 || m.spending > 0)),
  };
}

// ── Net worth, projected ─────────────────────────────────────

export interface ProjectedPoint { date: string; net: number }

/**
 * Net worth at the end of each forecast month, starting from today's.
 *
 * Cash moves by each month's net. A loan payment moves cash by the whole
 * payment, but only its interest changes net worth — the rest swaps cash for
 * less debt — so the principal is added back. For money you lent the other
 * way round: the principal coming in was already yours (as what you're owed),
 * so it's taken back out. Someone else's loan repaid to you isn't in your net
 * worth at all, so all of that money is a gain. Things that depreciate keep
 * losing value; everything else is held flat.
 */
export function projectNetWorth(
  f: Forecast, netToday: number, manual: ManualAsset[], txs: Transaction[], today: string,
): ProjectedPoint[] {
  const valued = manual.filter(m => !m.archived && !m.loan && countsInNetWorth(m));
  const valueToday = new Map(valued.map(m => [m.id, entryValueOn(m, txs, today) ?? 0]));
  let cashFlow = 0, principalBack = 0;
  return f.months.map(m => {
    cashFlow += m.net;
    for (const it of m.items) {
      if (it.kind === 'bill' || !it.inNetWorth) continue;
      const principal = it.amount - (it.interest ?? 0);
      principalBack += it.kind === 'loan-out' ? principal : -principal;
    }
    let drift = 0;
    for (const a of valued) {
      const sign = manualType(a.type).side === 'asset' ? 1 : -1;
      drift += sign * ((entryValueOn(a, txs, m.end) ?? 0) - (valueToday.get(a.id) ?? 0));
    }
    return { date: m.end, net: round2(netToday + cashFlow + principalBack + drift) };
  });
}
