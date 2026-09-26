import { describe, it, expect } from 'vitest';
import { BILL_FREQUENCIES, advanceDueDate, frequencyLabel, monthlyCost } from './bill-schedule';

describe('advanceDueDate', () => {
  it('steps each frequency by the right amount', () => {
    expect(advanceDueDate('2026-09-15', 'weekly')).toBe('2026-09-22');
    expect(advanceDueDate('2026-09-15', 'monthly')).toBe('2026-10-15');
    expect(advanceDueDate('2026-09-15', 'quarterly')).toBe('2026-12-15');
    expect(advanceDueDate('2026-09-15', 'semiannual')).toBe('2027-03-15');
    expect(advanceDueDate('2026-09-15', 'yearly')).toBe('2027-09-15');
  });

  it('clamps to month end instead of overflowing into the next month', () => {
    // The old setMonth version turned Aug 31 + 1 month into "Sep 31" = Oct 1,
    // skipping September altogether.
    expect(advanceDueDate('2026-08-31', 'monthly')).toBe('2026-09-30');
    expect(advanceDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    // Six months from Aug 31 is February — the old version said Mar 3.
    expect(advanceDueDate('2026-08-31', 'semiannual')).toBe('2027-02-28');
    expect(advanceDueDate('2026-11-30', 'quarterly')).toBe('2027-02-28');
  });

  it('handles leap years', () => {
    expect(advanceDueDate('2027-08-31', 'semiannual')).toBe('2028-02-29');
    expect(advanceDueDate('2028-02-29', 'yearly')).toBe('2029-02-28');
  });

  it('crosses year boundaries', () => {
    expect(advanceDueDate('2026-12-28', 'weekly')).toBe('2027-01-04');
    expect(advanceDueDate('2026-10-05', 'semiannual')).toBe('2027-04-05');
  });

  it('never lands in the wrong month', () => {
    // For every day of a year and every month-based frequency, the result must
    // be exactly N calendar months later — the property the overflow broke.
    for (const f of BILL_FREQUENCIES.filter(x => x.months > 0)) {
      for (let d = new Date(2026, 0, 1); d.getFullYear() === 2026; d.setDate(d.getDate() + 1)) {
        const from = `2026-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
        const [y, m] = advanceDueDate(from, f.value).split('-').map(Number);
        const monthsLater = (y - 2026) * 12 + (m - 1) - d.getMonth();
        expect(monthsLater).toBe(f.months);
      }
    }
  });
});

describe('monthlyCost', () => {
  it('spreads each frequency over the year', () => {
    expect(monthlyCost(120, 'monthly')).toBe(120);
    expect(monthlyCost(120, 'quarterly')).toBe(40);
    expect(monthlyCost(120, 'semiannual')).toBe(20);
    expect(monthlyCost(120, 'yearly')).toBe(10);
    expect(monthlyCost(12, 'weekly')).toBe(52);
  });
});

describe('frequencyLabel', () => {
  it('names the new frequency plainly', () => {
    expect(frequencyLabel('semiannual')).toBe('Every 6 months');
    expect(frequencyLabel('quarterly')).toBe('Quarterly');
  });

  it('lists frequencies shortest first, so the dropdown reads in order', () => {
    expect(BILL_FREQUENCIES.map(f => f.value))
      .toEqual(['weekly', 'monthly', 'quarterly', 'semiannual', 'yearly']);
  });
});
