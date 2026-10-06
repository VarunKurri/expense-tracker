import { describe, it, expect } from 'vitest';
import { transactionRange } from './date-ranges';

const within = (date: string, b: { start: string; end: string }) =>
  (!b.start || date >= b.start) && (!b.end || date <= b.end);

describe('transactionRange', () => {
  const oct3 = new Date(2026, 9, 3, 21, 30); // Saturday evening, local time

  it('"Last 30 days" includes a transaction the bank dated tomorrow', () => {
    const r = transactionRange('last-30', oct3);
    expect(within('2026-10-04', r)).toBe(true);  // PYMT SENT STRIKE
    expect(within('2026-10-03', r)).toBe(true);
    expect(within('2026-09-04', r)).toBe(true);  // 30th day back, inclusive
    expect(within('2026-09-03', r)).toBe(false);
  });

  it('months use local dates, with the right last day', () => {
    expect(transactionRange('this-month', oct3)).toEqual({ start: '2026-10-01', end: '2026-10-31' });
    expect(transactionRange('last-month', oct3)).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(transactionRange('this-month', new Date(2028, 1, 10))).toEqual({ start: '2028-02-01', end: '2028-02-29' });
  });

  it('"Last month" in January is last December', () => {
    expect(transactionRange('last-month', new Date(2027, 0, 15))).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('this year, custom and all time', () => {
    expect(transactionRange('this-year', oct3)).toEqual({ start: '2026-01-01', end: '2026-12-31' });
    expect(transactionRange('custom', oct3, { start: '2026-05-01', end: '2026-05-09' })).toEqual({ start: '2026-05-01', end: '2026-05-09' });
    expect(transactionRange('all', oct3)).toEqual({ start: '', end: '' });
  });

  it('"Last 30 days" crosses a year boundary', () => {
    expect(transactionRange('last-30', new Date(2027, 0, 10)).start).toBe('2026-12-12');
  });
});
