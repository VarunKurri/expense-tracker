// Ported verbatim from VarunKurri/split-the-bill src/domain/shareWeights.test.ts @ cc6a8db.

import { describe, expect, it } from 'vitest';
import { wholeShareWeights } from './shareWeights';

describe('wholeShareWeights', () => {
  it('reduces whole and fractional weights without changing their ratio', () => {
    expect(wholeShareWeights([50, 30, 20])).toEqual([5, 3, 2]);
    expect(wholeShareWeights([12.5, 37.5, 50])).toEqual([1, 3, 4]);
    expect(wholeShareWeights([33.34, 33.33, 33.33])).toEqual([3334, 3333, 3333]);
  });

  it('preserves zeros, including an empty or entirely unclaimed split', () => {
    expect(wholeShareWeights([0, 750, 2250])).toEqual([0, 1, 3]);
    expect(wholeShareWeights([0, 0])).toEqual([0, 0]);
    expect(wholeShareWeights([])).toEqual([]);
  });

  it('handles scientific notation without rounding tiny positive claims to zero', () => {
    expect(wholeShareWeights([1e-7, 3e-7])).toEqual([1, 3]);
    expect(wholeShareWeights([1e21, 3e21])).toEqual([1, 3]);
    expect(wholeShareWeights([0.000001, 1e-7])).toEqual([10, 1]);
  });

  it('rejects invalid or unrepresentable ratios instead of changing them', () => {
    for (const invalid of [-1, NaN, Infinity, -Infinity]) {
      expect(wholeShareWeights([1, invalid])).toBeNull();
    }
    expect(wholeShareWeights([1, 1e20])).toBeNull();
    expect(wholeShareWeights([1, Number.MAX_SAFE_INTEGER])).toEqual([1, Number.MAX_SAFE_INTEGER]);
  });
});
