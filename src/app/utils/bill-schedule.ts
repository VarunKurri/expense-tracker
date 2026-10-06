import { BillFrequency } from '../models';
import { localDateString, parseLocalDate } from './date';

/**
 * Bill frequencies: how far a due date moves, what a bill costs per month, and
 * what to call it. One table, so adding a frequency is one entry rather than a
 * hunt through every switch statement that mentions them.
 */
export const BILL_FREQUENCIES: {
  value: BillFrequency;
  label: string;
  /** Months between due dates; weekly is handled in days instead. */
  months: number;
  /** Payments per year, for converting to a monthly cost. */
  perYear: number;
}[] = [
  { value: 'weekly',     label: 'Weekly',         months: 0,  perYear: 52 },
  { value: 'monthly',    label: 'Monthly',        months: 1,  perYear: 12 },
  { value: 'quarterly',  label: 'Quarterly',      months: 3,  perYear: 4 },
  { value: 'semiannual', label: 'Every 6 months', months: 6,  perYear: 2 },
  { value: 'yearly',     label: 'Yearly',         months: 12, perYear: 1 },
];

function spec(f: BillFrequency) {
  return BILL_FREQUENCIES.find(x => x.value === f) ?? BILL_FREQUENCIES[1];
}

export function frequencyLabel(f: BillFrequency | string): string {
  return BILL_FREQUENCIES.find(x => x.value === f)?.label ?? f;
}

/** What a bill costs per month, averaged over the year. */
export function monthlyCost(amount: number, f: BillFrequency): number {
  return amount * spec(f).perYear / 12;
}

/**
 * The next due date after `from`.
 *
 * Month steps clamp to the last day of the target month instead of
 * overflowing. JavaScript's setMonth overflows: Aug 31 plus one month is
 * "Sep 31", which becomes Oct 1, so a monthly bill skipped September entirely
 * and stayed a day late from then on. Six months from Aug 31 would have landed
 * on Mar 3.
 *
 * Works in local time throughout. The previous version formatted with
 * toISOString(), which is UTC and moved the date back a day in time zones
 * east of UTC.
 */
export function advanceDueDate(from: string, f: BillFrequency): string {
  const d = parseLocalDate(from);
  const s = spec(f);
  if (f === 'weekly') {
    d.setDate(d.getDate() + 7);
    return localDateString(d);
  }
  const day = d.getDate();
  const target = new Date(d.getFullYear(), d.getMonth() + s.months, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return localDateString(target);
}
