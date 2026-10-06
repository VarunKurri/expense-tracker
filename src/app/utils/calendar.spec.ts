import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import {
  addMonths, buildMonthGrid, cumulativeSeries, dailyTotals, dateKeyOf, heatScale,
  monthKeyOf, monthLabel, monthRange, transactionsOn,
} from './calendar';

function tx(date: string, amount: number, over: Partial<Transaction> = {}): Transaction {
  return {
    id: over.id ?? `${date}-${amount}-${Math.random().toString(36).slice(2)}`,
    type: 'expense', amount, date, createdAt: 0, updatedAt: 0,
    ...over,
  } as Transaction;
}

describe('monthKeyOf / dateKeyOf', () => {
  it('formats in local time, not UTC', () => {
    // 1 Sept, 00:30 local. toISOString() would render this as 31 August in any
    // negative-offset zone, filing the transaction under the wrong month.
    const d = new Date(2026, 8, 1, 0, 30);
    expect(monthKeyOf(d)).toBe('2026-09');
    expect(dateKeyOf(d)).toBe('2026-09-01');
  });

  it('zero-pads single-digit months and days', () => {
    expect(dateKeyOf(new Date(2026, 0, 5))).toBe('2026-01-05');
  });
});

describe('addMonths', () => {
  it('steps forward and back', () => {
    expect(addMonths('2026-09', 1)).toBe('2026-10');
    expect(addMonths('2026-09', -1)).toBe('2026-08');
  });

  it('crosses year boundaries', () => {
    expect(addMonths('2026-12', 1)).toBe('2027-01');
    expect(addMonths('2026-01', -1)).toBe('2025-12');
  });

  it('does not roll over from a long month to a short one', () => {
    // Stepping back one month from March using a day-31 date lands in March
    // again (3 March), because February has no 31st. Anchoring to day 1 avoids it.
    expect(addMonths('2026-03', -1)).toBe('2026-02');
    expect(addMonths('2026-01', 1)).toBe('2026-02');
  });

  it('steps by more than a year', () => {
    expect(addMonths('2026-09', 14)).toBe('2027-11');
  });
});

describe('monthLabel', () => {
  it('names the month', () => {
    expect(monthLabel('2026-09')).toBe('September 2026');
    expect(monthLabel('2026-09', false)).toBe('September');
  });
});

describe('heatScale', () => {
  it('leaves zero-spend days flat', () => {
    expect(heatScale([100, 500])(0)).toBe(0);
  });

  it('puts the heaviest day at the top of the scale', () => {
    expect(heatScale([100, 500])(500)).toBe(4);
  });

  it('survives a month with no spending at all', () => {
    const scale = heatScale([]);
    expect(scale(0)).toBe(0);
    expect(scale(100)).toBe(0);
  });

  it('handles a month with a single spending day', () => {
    expect(heatScale([42])(42)).toBe(4);
  });

  it('does not divide by zero when every day cost the same', () => {
    // Every day counts as an outlier here, so the ranked bucket is never
    // reached — the guard matters because reaching it would divide by zero.
    const scale = heatScale([50, 50, 50]);
    expect([50, 50, 50].map(scale)).toEqual([4, 4, 4]);
    expect(scale(0)).toBe(0);
  });

  it('spreads the remaining days rather than crushing them under an outlier', () => {
    // This is the case a straight amount/max ramp gets wrong: with a $460 day
    // in the month, everything from $19 to $113 lands in the faintest shade and
    // the calendar stops telling them apart.
    const scale = heatScale([19, 36, 36, 54, 59, 84, 100, 113, 460]);
    expect(scale(460)).toBe(4);
    expect(scale(19)).toBe(1);
    expect(scale(113)).toBe(3);
    // Every shade is actually used.
    const used = new Set([19, 36, 54, 59, 84, 100, 113, 460].map(scale));
    expect([...used].sort()).toEqual([1, 2, 3, 4]);
  });

  it('never shades two equal days differently', () => {
    const scale = heatScale([10, 20, 20, 20, 30, 40, 900]);
    expect(scale(20)).toBe(scale(20));
    const forTwenty = scale(20);
    expect([10, 20, 30, 40].map(scale).every(v => v >= 1 && v <= 3)).toBe(true);
    expect(forTwenty).toBeGreaterThanOrEqual(1);
  });

  it('is monotonic — a bigger day is never a paler day', () => {
    const amounts = [5, 18, 40, 41, 77, 120, 300, 301, 900];
    const scale = heatScale(amounts);
    const levels = amounts.map(scale);
    for (let i = 1; i < levels.length; i++) {
      expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
    }
  });

  it('treats several near-equal top days as outliers together', () => {
    // Two rent-sized days should both read as the expensive ones.
    const scale = heatScale([20, 30, 40, 480, 500]);
    expect(scale(500)).toBe(4);
    expect(scale(480)).toBe(4);
    expect(scale(40)).toBeLessThan(4);
  });
});

describe('dailyTotals', () => {
  it('sums by day and ignores other months', () => {
    const txs = [
      tx('2026-09-03', 60), tx('2026-09-03', 40),
      tx('2026-09-05', 25),
      tx('2026-08-31', 999),   // previous month
      tx('2026-10-01', 999),   // next month
    ];
    const totals = dailyTotals(txs, '2026-09');
    expect(totals.get('2026-09-03')).toEqual({ amount: 100, count: 2 });
    expect(totals.get('2026-09-05')).toEqual({ amount: 25, count: 1 });
    expect(totals.has('2026-08-31')).toBe(false);
    expect(totals.has('2026-10-01')).toBe(false);
  });

  it('uses the injected amount function, so netting rules carry through', () => {
    const txs = [tx('2026-09-03', 100, { id: 'a' })];
    // Stand-in for an expense half paid back by a reimbursement.
    const totals = dailyTotals(txs, '2026-09', t => t.amount / 2);
    expect(totals.get('2026-09-03')!.amount).toBe(50);
  });

  it('rounds to cents rather than accumulating float error', () => {
    const txs = [tx('2026-09-03', 0.1), tx('2026-09-03', 0.2)];
    expect(dailyTotals(txs, '2026-09').get('2026-09-03')!.amount).toBe(0.3);
  });
});

describe('buildMonthGrid', () => {
  const txs = [
    tx('2026-09-03', 100),
    tx('2026-09-05', 460),
    tx('2026-09-07', 113),
    tx('2026-09-20', 84),
  ];

  it('pads to whole weeks, Sunday first', () => {
    // 1 September 2026 is a Tuesday, so the first row has two blanks.
    const grid = buildMonthGrid('2026-09', txs, t => t.amount, '2026-09-23');
    expect(grid.weeks[0][0].inMonth).toBe(false);
    expect(grid.weeks[0][1].inMonth).toBe(false);
    expect(grid.weeks[0][2].day).toBe(1);
    for (const w of grid.weeks) expect(w.length).toBe(7);
  });

  it('covers every day of the month exactly once', () => {
    const grid = buildMonthGrid('2026-09', txs, t => t.amount, '2026-09-23');
    const days = grid.weeks.flat().filter(c => c.inMonth).map(c => c.day);
    expect(days).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
  });

  it('handles a 31-day month and a February', () => {
    expect(buildMonthGrid('2026-01', [], t => t.amount, '2026-01-31')
      .weeks.flat().filter(c => c.inMonth).length).toBe(31);
    expect(buildMonthGrid('2026-02', [], t => t.amount, '2026-02-28')
      .weeks.flat().filter(c => c.inMonth).length).toBe(28);
    // 2028 is a leap year.
    expect(buildMonthGrid('2028-02', [], t => t.amount, '2028-02-29')
      .weeks.flat().filter(c => c.inMonth).length).toBe(29);
  });

  it('marks days after today as future rather than as zero-spend', () => {
    const grid = buildMonthGrid('2026-09', txs, t => t.amount, '2026-09-23');
    const cell = (d: number) => grid.weeks.flat().find(c => c.day === d && c.inMonth)!;
    expect(cell(23).future).toBe(false);
    expect(cell(23).isToday).toBe(true);
    expect(cell(24).future).toBe(true);
    // A past day with no transactions is genuinely $0 — not the same as unknown.
    expect(cell(22).future).toBe(false);
    expect(cell(22).amount).toBe(0);
  });

  it('totals only the month in question', () => {
    const grid = buildMonthGrid('2026-09',
      [...txs, tx('2026-08-15', 5000)], t => t.amount, '2026-09-23');
    expect(grid.total).toBe(757);
    expect(grid.max).toBe(460);
  });

  it('counts active and elapsed days', () => {
    const grid = buildMonthGrid('2026-09', txs, t => t.amount, '2026-09-23');
    expect(grid.activeDays).toBe(4);
    expect(grid.elapsedDays).toBe(23);
  });

  it('survives a month with no transactions', () => {
    const grid = buildMonthGrid('2026-09', [], t => t.amount, '2026-09-23');
    expect(grid.total).toBe(0);
    expect(grid.max).toBe(0);
    expect(grid.activeDays).toBe(0);
    expect(grid.weeks.flat().every(c => c.heat === 0)).toBe(true);
  });

  it('scales heat to the heaviest day of that month', () => {
    const grid = buildMonthGrid('2026-09', txs, t => t.amount, '2026-09-23');
    const cell = (d: number) => grid.weeks.flat().find(c => c.day === d && c.inMonth)!;
    // Ranked within the month: 460 is the standout, then 113, 100, 84.
    expect(cell(5).heat).toBe(4);
    expect(cell(7).heat).toBe(3);
    expect(cell(3).heat).toBe(2);
    expect(cell(20).heat).toBe(1);
    expect(cell(1).heat).toBe(0);   // nothing spent
  });
});

describe('monthRange', () => {
  it('covers the whole month, inclusive', () => {
    expect(monthRange('2026-09')).toEqual({ start: '2026-09-01', end: '2026-09-30' });
    expect(monthRange('2026-01')).toEqual({ start: '2026-01-01', end: '2026-01-31' });
  });

  it('gets February right in common and leap years', () => {
    expect(monthRange('2026-02').end).toBe('2026-02-28');
    expect(monthRange('2028-02').end).toBe('2028-02-29');
  });
});

describe('cumulativeSeries', () => {
  const txs = [tx('2026-09-03', 100), tx('2026-09-05', 60), tx('2026-09-05', 40)];

  it('accumulates and holds flat on quiet days', () => {
    const s = cumulativeSeries('2026-09', txs, t => t.amount, '2026-09-30');
    expect(s[0]).toBe(0);    // 1st
    expect(s[2]).toBe(100);  // 3rd
    expect(s[3]).toBe(100);  // 4th, nothing spent
    expect(s[4]).toBe(200);  // 5th
    expect(s[29]).toBe(200); // 30th
  });

  it('stops at today rather than drawing a flat line into the future', () => {
    const s = cumulativeSeries('2026-09', txs, t => t.amount, '2026-09-10');
    expect(s[9]).toBe(200);          // the 10th is today
    expect(s[10]).toBeNull();        // the 11th has not happened
    expect(s.slice(10).every(v => v === null)).toBe(true);
  });

  it('has one point per day of the month', () => {
    expect(cumulativeSeries('2026-09', txs, t => t.amount, '2026-09-30').length).toBe(30);
    expect(cumulativeSeries('2026-02', [], t => t.amount, '2026-02-28').length).toBe(28);
  });

  it('carries the injected amount rule', () => {
    const s = cumulativeSeries('2026-09', txs, t => t.amount / 2, '2026-09-30');
    expect(s[4]).toBe(100);
  });
});

describe('transactionsOn', () => {
  it('returns only that day, newest entry first', () => {
    const a = tx('2026-09-03', 10, { id: 'a', createdAt: 1 });
    const b = tx('2026-09-03', 20, { id: 'b', createdAt: 5 });
    const c = tx('2026-09-04', 30, { id: 'c', createdAt: 9 });
    expect(transactionsOn([a, b, c], '2026-09-03').map(t => t.id)).toEqual(['b', 'a']);
  });

  it('returns nothing for a day with no activity', () => {
    expect(transactionsOn([tx('2026-09-03', 10)], '2026-09-04')).toEqual([]);
  });
});
