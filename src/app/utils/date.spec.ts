import { daysBetweenLocal, localDateString, parseLocalDate } from './date';

describe('date utilities', () => {
  it('formats local dates without UTC conversion', () => {
    expect(localDateString(new Date(2026, 5, 16))).toBe('2026-06-16');
  });

  it('parses date-only strings as local midnight', () => {
    const date = parseLocalDate('2026-06-16');
    expect(date.getFullYear()).toBe(2026);
    expect(date.getMonth()).toBe(5);
    expect(date.getDate()).toBe(16);
  });

  it('counts whole local days', () => {
    expect(daysBetweenLocal('2026-06-16', '2026-06-20')).toBe(4);
  });
});
