import { localDateString } from './date';

export type DateRange = 'last-30' | 'this-month' | 'last-month' | 'this-year' | 'custom' | 'all';

/** Inclusive YYYY-MM-DD bounds; an empty string means "no bound on this side". */
export interface DateBounds {
  start: string;
  end: string;
}

/**
 * The dates a Transactions filter covers, in local time.
 *
 * "Last 30 days" has a start but no end. It means "what has happened
 * recently", and banks sometimes date a transaction a day or two ahead through
 * Plaid (a scheduled or pending payment carrying its settlement date, or a bank
 * dating by its own time zone). Capping it at today hid those, so a payment
 * showed under "This month" and "All time" but not "Last 30 days".
 */
export function transactionRange(
  range: DateRange,
  now: Date = new Date(),
  custom: DateBounds = { start: '', end: '' },
): DateBounds {
  const y = now.getFullYear();
  const m = now.getMonth();
  // Day 0 of the next month is the last day of this one.
  const monthBounds = (year: number, month: number): DateBounds => ({
    start: localDateString(new Date(year, month, 1)),
    end: localDateString(new Date(year, month + 1, 0)),
  });

  switch (range) {
    case 'last-30':
      return { start: localDateString(new Date(y, m, now.getDate() - 29)), end: '' };
    case 'this-month':
      return monthBounds(y, m);
    case 'last-month':
      return monthBounds(y, m - 1); // new Date() rolls January back to last December
    case 'this-year':
      return { start: `${y}-01-01`, end: `${y}-12-31` };
    case 'custom':
      return custom;
    default:
      return { start: '', end: '' };
  }
}
