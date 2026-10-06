import { Transaction } from '../models';

/**
 * Month-grid construction for the spending calendar.
 *
 * Kept pure and separate from the component for the same reason `reporting.ts`
 * is: this decides what a day is *claimed* to have cost, and a calendar that
 * quietly mis-dates or double-counts a transaction is not something you can
 * spot by looking at it.
 *
 * Two rules here are deliberate and easy to get wrong:
 *
 *  - **A future day shows nothing, not zero.** "You spent $0 on the 30th" and
 *    "the 30th hasn't happened" are different claims, and only one of them is
 *    true in the middle of a month. Future cells carry `future: true` and the
 *    template renders a dash.
 *  - **Dates are parsed local, never UTC.** Transaction dates are plain
 *    `YYYY-MM-DD` with no zone. `new Date('2026-09-01')` is UTC midnight, which
 *    in the Americas lands on 31 August and would file a transaction under the
 *    wrong month. Everything here works on the string, or appends `T00:00:00`.
 */

/** One square in the grid. Padding cells before the 1st have `inMonth: false`. */
export interface DayCell {
  /** `YYYY-MM-DD`, or `''` for a padding cell. */
  date: string;
  /** Day of month, or 0 for a padding cell. */
  day: number;
  amount: number;
  count: number;
  inMonth: boolean;
  /** Later than today — renders as a dash, never as $0. */
  future: boolean;
  isToday: boolean;
  /** 0 (no spend) to 4 (the month's heaviest day). */
  heat: number;
}

export interface MonthGrid {
  monthKey: string;
  /** e.g. `September 2026`. */
  label: string;
  weeks: DayCell[][];
  /** Total spending in the month. */
  total: number;
  /** The single heaviest day's spend, which sets the heat scale. */
  max: number;
  /** Days with any spending — used for the "you spent on N of M days" line. */
  activeDays: number;
  /** Days that have actually happened, so an average can be honest. */
  elapsedDays: number;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** `YYYY-MM` for a Date, in local time. */
export function monthKeyOf(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** `YYYY-MM-DD` for a Date, in local time. */
export function dateKeyOf(d: Date = new Date()): string {
  return `${monthKeyOf(d)}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Parses a `YYYY-MM-DD` as local midnight. */
export function localDate(dateStr: string): Date {
  return new Date(dateStr + 'T00:00:00');
}

/**
 * Steps a month key by `n` months. Uses day 1 so it cannot roll over — stepping
 * back from 31 March with a naive Date would land in March again.
 */
export function addMonths(monthKey: string, n: number): string {
  const [y, m] = monthKey.split('-').map(Number);
  return monthKeyOf(new Date(y, m - 1 + n, 1));
}

export function monthLabel(monthKey: string, withYear = true): string {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('en-US',
    withYear ? { month: 'long', year: 'numeric' } : { month: 'long' });
}

/**
 * Builds the month's heat scale: a function from a day's spend to a shade 0–4.
 *
 * Shading is by **rank within the month**, not by share of the largest day. A
 * straight `amount / max` ramp collapses under one big day — a single $460
 * rent payment drops a $113 day and a $19 day into the same faintest shade, and
 * the calendar stops distinguishing anything below the outlier. Ranking keeps
 * the scale usable whatever the month looks like.
 *
 * The top shade is still reserved for genuine outliers (within 10% of the
 * heaviest day) rather than handed to the top third, so "the expensive day"
 * stays visually singular the way it is in life.
 *
 * Shade encodes *order*, not magnitude — a level 3 day is not three times a
 * level 1 day. That is why every cell also prints its actual figure: the number
 * is the claim, the shade is only a way of finding it.
 *
 * Ties always share a shade; two identical days must never be coloured
 * differently.
 */
export function heatScale(amounts: number[]): (amount: number) => number {
  const active = amounts.filter(a => a > 0).sort((a, b) => a - b);
  if (!active.length) return () => 0;

  const max = active[active.length - 1];
  const outlierFloor = max * 0.9;
  const rest = active.filter(a => a < outlierFloor);

  // Highest index of each value, so equal amounts land in the same bucket.
  const rank = new Map<number, number>();
  rest.forEach((a, i) => rank.set(a, i + 1));

  return (amount: number) => {
    if (amount <= 0) return 0;
    if (amount >= outlierFloor) return 4;
    const r = rank.get(amount);
    if (r === undefined) return 1;
    return Math.min(3, Math.max(1, Math.ceil((3 * r) / rest.length)));
  };
}

/** Day-by-day totals for a month, keyed by `YYYY-MM-DD`. */
export function dailyTotals(
  txs: Transaction[],
  monthKey: string,
  amountOf: (t: Transaction) => number = t => t.amount,
): Map<string, { amount: number; count: number }> {
  const byDay = new Map<string, { amount: number; count: number }>();
  for (const t of txs) {
    if (!t.date?.startsWith(monthKey)) continue;
    const cur = byDay.get(t.date) ?? { amount: 0, count: 0 };
    cur.amount += amountOf(t);
    cur.count += 1;
    byDay.set(t.date, cur);
  }
  for (const [k, v] of byDay) byDay.set(k, { ...v, amount: round2(v.amount) });
  return byDay;
}

/**
 * Builds the Sunday-first grid for a month.
 *
 * `txs` should already be narrowed to the transactions that count as spending
 * (see `reporting.spendingTransactions`) and filtered for refunds — this does
 * not re-apply money rules, so the calendar can never disagree with the totals
 * the rest of the app shows for the same period.
 */
export function buildMonthGrid(
  monthKey: string,
  txs: Transaction[],
  amountOf: (t: Transaction) => number = t => t.amount,
  today: string = dateKeyOf(),
): MonthGrid {
  const [y, m] = monthKey.split('-').map(Number);
  const first = new Date(y, m - 1, 1);
  const daysInMonth = new Date(y, m, 0).getDate();
  const leading = first.getDay(); // 0 = Sunday

  const byDay = dailyTotals(txs, monthKey, amountOf);
  const amounts = [...byDay.values()].map(v => v.amount);
  const max = Math.max(0, ...amounts);
  const heatFor = heatScale(amounts);

  const cells: DayCell[] = [];
  for (let i = 0; i < leading; i++) {
    cells.push({ date: '', day: 0, amount: 0, count: 0, inMonth: false, future: false, isToday: false, heat: 0 });
  }
  for (let day = 1; day <= daysInMonth; day++) {
    const date = `${monthKey}-${String(day).padStart(2, '0')}`;
    const hit = byDay.get(date);
    const amount = hit?.amount ?? 0;
    cells.push({
      date,
      day,
      amount,
      count: hit?.count ?? 0,
      inMonth: true,
      future: date > today,
      isToday: date === today,
      heat: heatFor(amount),
    });
  }
  // Trailing padding, so the last row is a full week and the grid stays square.
  while (cells.length % 7 !== 0) {
    cells.push({ date: '', day: 0, amount: 0, count: 0, inMonth: false, future: false, isToday: false, heat: 0 });
  }

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

  const inMonth = cells.filter(c => c.inMonth);
  return {
    monthKey,
    label: monthLabel(monthKey),
    weeks,
    total: round2(inMonth.reduce((s, c) => s + c.amount, 0)),
    max,
    activeDays: inMonth.filter(c => c.amount > 0).length,
    elapsedDays: inMonth.filter(c => !c.future).length,
  };
}

/** First and last date of a month, as `YYYY-MM-DD`. */
export function monthRange(monthKey: string): { start: string; end: string } {
  const [y, m] = monthKey.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { start: `${monthKey}-01`, end: `${monthKey}-${String(last).padStart(2, '0')}` };
}

/**
 * Running total through a month, for the trend line.
 *
 * Days after `today` come back as `null` rather than as the last known total.
 * Chart.js breaks the line at a null, which is the honest rendering: carrying a
 * flat line to the end of the month would draw a claim that no more will be
 * spent. This is the same "future is not zero" rule the grid cells follow.
 */
export function cumulativeSeries(
  monthKey: string,
  txs: Transaction[],
  amountOf: (t: Transaction) => number = t => t.amount,
  today: string = dateKeyOf(),
): (number | null)[] {
  const [y, m] = monthKey.split('-').map(Number);
  const days = new Date(y, m, 0).getDate();
  const byDay = dailyTotals(txs, monthKey, amountOf);
  const out: (number | null)[] = [];
  let running = 0;
  for (let d = 1; d <= days; d++) {
    const date = `${monthKey}-${String(d).padStart(2, '0')}`;
    running += byDay.get(date)?.amount ?? 0;
    out.push(date > today ? null : round2(running));
  }
  return out;
}

/** Transactions on one day, newest-entered first — what the day popup lists. */
export function transactionsOn(txs: Transaction[], date: string): Transaction[] {
  return txs
    .filter(t => t.date === date)
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
}

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
