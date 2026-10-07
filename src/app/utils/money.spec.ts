import { describe, it, expect } from 'vitest';
import { toCents, fromCents, sumCents } from './money';

describe('toCents', () => {
  it('converts ordinary amounts', () => {
    expect(toCents(12.34)).toBe(1234);
    expect(toCents(0)).toBe(0);
    expect(toCents(180)).toBe(18000);
  });

  it('rounds half a cent up where float multiplication would round down', () => {
    // 1.005 * 100 === 100.49999999999999 in floating point.
    expect(Math.round(1.005 * 100)).toBe(100);
    expect(toCents(1.005)).toBe(101);
  });

  it('handles values that are already float noise', () => {
    expect(toCents(0.1 + 0.2)).toBe(30); // 0.30000000000000004
  });

  it('keeps the sign and never returns -0', () => {
    expect(toCents(-12.34)).toBe(-1234);
    expect(Object.is(toCents(-0.001), 0)).toBe(true);
  });

  it('falls back to plain rounding for scientific notation', () => {
    expect(toCents(1e-7)).toBe(0);
    expect(toCents(1e21)).toBe(1e23);
  });

  it('treats non-finite input as zero', () => {
    expect(toCents(NaN)).toBe(0);
    expect(toCents(Infinity)).toBe(0);
  });
});

describe('fromCents / sumCents', () => {
  it('round-trips', () => {
    expect(fromCents(toCents(1234.56))).toBe(1234.56);
  });

  it('sums without float drift', () => {
    const tenDimes = new Array(10).fill(0.1);
    expect(tenDimes.reduce((a, b) => a + b, 0)).not.toBe(1);
    expect(sumCents(tenDimes)).toBe(100);
  });
});
