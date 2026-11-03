import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import { allShownIds, visibleSelection } from './bulk-selection';

const tx = (id: string) => ({ id, type: 'expense', amount: 1, date: '2026-10-11' }) as Transaction;

describe('bulk selection', () => {
  it('selects every row shown, and only those', () => {
    const shown = [tx('a'), tx('b')];
    expect([...allShownIds(shown)]).toEqual(['a', 'b']);
  });

  it('never lets a bulk action reach a row that is ticked but not shown', () => {
    const shown = [tx('a'), tx('b')];
    const ticked = new Set(['a', 'hidden']);
    expect(visibleSelection(shown, ticked).map(t => t.id)).toEqual(['a']);
  });
});
