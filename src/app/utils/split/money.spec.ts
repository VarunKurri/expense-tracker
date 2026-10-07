// Ported verbatim from VarunKurri/split-the-bill src/domain/money.test.ts @ cc6a8db.

import { describe, expect, it } from 'vitest';
import { allocate, formatCents, parseCents, parsePercent, percentOf } from './money';

describe('parseCents', () => {
  it('parses plain and decorated input', () => {
    expect(parseCents('12.34')).toBe(1234);
    expect(parseCents('$12.34')).toBe(1234);
    expect(parseCents(' 1,234.50 ')).toBe(123450);
    expect(parseCents('7')).toBe(700);
    expect(parseCents('.5')).toBe(50);
  });

  it('rejects anything that is not a non-negative number', () => {
    expect(parseCents('')).toBeNull();
    expect(parseCents('abc')).toBeNull();
    expect(parseCents('-5')).toBeNull();
    expect(parseCents('1.2.3')).toBeNull();
  });

  it('distinguishes zero from invalid', () => {
    expect(parseCents('0')).toBe(0);
    expect(parseCents('0.00')).toBe(0);
  });

  it('rounds sub-cent input rather than truncating', () => {
    expect(parseCents('0.005')).toBe(1);
    expect(parseCents('10.999')).toBe(1100);
  });

  it('rounds decimal half cents up without binary floating-point drift', () => {
    expect(parseCents('1.005')).toBe(101);
    expect(parseCents('1.015')).toBe(102);
    expect(parseCents('1.255')).toBe(126);
    expect(parseCents('10.075')).toBe(1008);
    expect(parseCents('1.004999999999999999')).toBe(100);
    for (let cents = 0; cents < 10000; cents += 1) {
      const input = `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}5`;
      expect(parseCents(input)).toBe(cents + 1);
    }
  });

  it('requires a digit, including in decorated input', () => {
    for (const input of ['.', '$ .', ', .', '$', ' , ']) {
      expect(parseCents(input)).toBeNull();
    }
    expect(parseCents('5.')).toBe(500);
    expect(parseCents('000.005')).toBe(1);
  });

  it('rejects cents outside the safe integer range, including after rounding', () => {
    expect(parseCents('90071992547409.91')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseCents('90071992547409.914')).toBe(Number.MAX_SAFE_INTEGER);
    expect(parseCents('90071992547409.915')).toBeNull();
    expect(parseCents('90071992547409.92')).toBeNull();
    expect(parseCents('9'.repeat(309))).toBeNull();
  });
});

describe('parsePercent', () => {
  it('accepts values in range, with or without a sign', () => {
    expect(parsePercent('8.5')).toBe(8.5);
    expect(parsePercent('20%')).toBe(20);
    expect(parsePercent('0')).toBe(0);
  });

  it('rejects out-of-range and malformed values', () => {
    expect(parsePercent('101')).toBeNull();
    expect(parsePercent('-1')).toBeNull();
    expect(parsePercent('')).toBeNull();
    expect(parsePercent('.')).toBeNull();
    expect(parsePercent(' . % ')).toBeNull();
  });
});

describe('percentOf', () => {
  it('rounds to the nearest cent', () => {
    expect(percentOf(10000, 8.5)).toBe(850);
    expect(percentOf(333, 20)).toBe(67); // 66.6 -> 67
  });
});

describe('allocate', () => {
  it('never creates or loses a cent', () => {
    expect(allocate(1000, [1, 1, 1])).toEqual([334, 333, 333]);
    expect(allocate(1000, [1, 1, 1]).reduce((a, b) => a + b)).toBe(1000);
  });

  it('splits evenly when it divides cleanly', () => {
    expect(allocate(1000, [1, 1])).toEqual([500, 500]);
    expect(allocate(900, [1, 1, 1])).toEqual([300, 300, 300]);
  });

  it('respects weights', () => {
    expect(allocate(3000, [2, 1])).toEqual([2000, 1000]);
    expect(allocate(1000, [3, 1])).toEqual([750, 250]);
  });

  it('gives leftover cents to the largest remainders, deterministically', () => {
    // 100 / 3 = 33.33 each; the two extra cents go to the first two by index.
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    // Same input, same output, every time.
    expect(allocate(100, [1, 1, 1])).toEqual(allocate(100, [1, 1, 1]));
  });

  it('handles a zero total', () => {
    expect(allocate(0, [1, 2, 3])).toEqual([0, 0, 0]);
  });

  it('returns zeros when there is nothing to split against', () => {
    expect(allocate(1000, [0, 0])).toEqual([0, 0]);
    expect(allocate(1000, [])).toEqual([]);
  });

  it('survives many awkward splits without drift', () => {
    for (let total = 1; total <= 500; total += 1) {
      for (let parts = 2; parts <= 9; parts += 1) {
        const weights = new Array<number>(parts).fill(1);
        const shares = allocate(total, weights);
        expect(shares.reduce((a, b) => a + b, 0)).toBe(total);
        // No share is more than one cent away from any other.
        expect(Math.max(...shares) - Math.min(...shares)).toBeLessThanOrEqual(1);
      }
    }
  });
});

describe('formatCents', () => {
  it('formats to two decimal places', () => {
    expect(formatCents(1234)).toBe('$12.34');
    expect(formatCents(0)).toBe('$0.00');
    expect(formatCents(5)).toBe('$0.05');
  });

  it('formats negatives, for the rounding line', () => {
    expect(formatCents(-3)).toBe('-$0.03');
  });
});
