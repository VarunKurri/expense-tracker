import { describe, it, expect } from 'vitest';
import { ME } from '../models';
import { calculateSplit } from './split/split';
import { buildItemizedSplit, emptyItemizedState, toBill } from './splits';
import {
  ReceiptScan, cleanScan, itemizedFromScan, scanAmountCents, scanBillCents, scanMismatchCents,
} from './receipt';

const scan = (over: Partial<ReceiptScan> = {}): ReceiptScan => ({
  isReceipt: true, merchant: 'Hashtag India', date: '2026-09-29', items: [], subtotalCents: null,
  discountCents: 0, feesCents: 0, taxCents: 0, tipCents: 0, totalCents: null, confidence: 0.9, ...over,
});

describe('cleanScan — nothing the model says is trusted as given', () => {
  it('keeps a well-formed scan as it is', () => {
    const raw = scan({ items: [{ name: 'Mandi', quantity: 2, unitPriceCents: 2500, totalCents: 5000 }], taxCents: 444, totalCents: 5444 });
    expect(cleanScan(raw)).toEqual(raw);
  });

  it('clamps money to whole, non-negative cents and drops empty lines', () => {
    const s = cleanScan({
      items: [
        { name: '  Garlic   naan ', quantity: 1, unitPriceCents: null, totalCents: 399.6 },
        { name: 'Refund?', quantity: 1, unitPriceCents: null, totalCents: -500 },
        { name: '', quantity: 0, unitPriceCents: 'x', totalCents: 250 },
      ],
      taxCents: -3, tipCents: '120', totalCents: 'n/a',
    });
    expect(s.items).toEqual([
      { name: 'Garlic naan', quantity: 1, unitPriceCents: null, totalCents: 400 },
      { name: 'Item', quantity: 1, unitPriceCents: 0, totalCents: 250 },
    ]);
    expect(s.taxCents).toBe(0);
    expect(s.tipCents).toBe(120);
    expect(s.totalCents).toBe(0);
  });

  it('accepts only real YYYY-MM-DD dates', () => {
    expect(cleanScan({ date: '2026-02-30' }).date).toBeNull();
    expect(cleanScan({ date: 'Tuesday' }).date).toBeNull();
    expect(cleanScan({ date: '2026-09-29' }).date).toBe('2026-09-29');
  });

  it('survives garbage', () => {
    const s = cleanScan(null);
    expect(s.items).toEqual([]);
    expect(s.isReceipt).toBe(true);
    expect(s.confidence).toBe(0);
    expect(cleanScan({ isReceipt: false }).isReceipt).toBe(false);
  });
});

describe('checking the lines against the printed total', () => {
  const dinner = scan({
    items: [{ name: 'Mandi', quantity: 2, unitPriceCents: 2500, totalCents: 5000 }, { name: 'Chai', quantity: 1, unitPriceCents: 300, totalCents: 300 }],
    discountCents: 300, feesCents: 200, taxCents: 416, tipCents: 800, totalCents: 6416,
  });

  it('items − discount + fees + tax + tip', () => {
    expect(scanBillCents(dinner)).toBe(5000 + 300 - 300 + 200 + 416 + 800);
    expect(scanMismatchCents(dinner)).toBe(0);
  });

  it('a missed line shows as the total being more than the lines', () => {
    expect(scanMismatchCents({ ...dinner, totalCents: 6916 })).toBe(500);
  });

  it('no printed total: nothing to check, and the amount is the lines', () => {
    expect(scanMismatchCents({ ...dinner, totalCents: null })).toBe(0);
    expect(scanAmountCents({ ...dinner, totalCents: null })).toBe(6416);
  });
});

describe('itemizedFromScan — the scan as an item-by-item split', () => {
  const base = { ...emptyItemizedState(), participantIds: [ME, 'm', 'p'] };

  it('lines start unclaimed; quantities stay one line; tax and tip are fixed amounts', () => {
    const s = itemizedFromScan(scan({
      items: [{ name: 'Mandi', quantity: 2, unitPriceCents: 2500, totalCents: 5000 }, { name: 'Chai', quantity: 1, unitPriceCents: null, totalCents: 300 }],
      taxCents: 616, tipCents: 500,
    }), base);
    expect(s.items.map(i => [i.name, i.quantity ?? 1, i.priceCents, i.assignments.length])).toEqual([
      ['Mandi', 2, 5000, 0],
      ['Chai', 1, 300, 0],
    ]);
    expect(s.items[0].unitPriceCents).toBe(2500);
    expect(s.charges).toMatchObject({ taxMode: 'amount', taxCents: 616, tipMode: 'amount', tipCents: 500 });
    expect(s.participantIds).toEqual([ME, 'm', 'p']);
    expect(s.source).toBe('receipt');
  });

  it('an order-level discount comes off every line in proportion, to the cent', () => {
    const s = itemizedFromScan(scan({
      items: [
        { name: 'A', quantity: 1, unitPriceCents: null, totalCents: 1000 },
        { name: 'B', quantity: 1, unitPriceCents: null, totalCents: 2000 },
        { name: 'C', quantity: 1, unitPriceCents: null, totalCents: 333 },
      ],
      discountCents: 500,
    }), base);
    expect(s.items.reduce((t, i) => t + i.priceCents, 0)).toBe(3333 - 500);
    expect(s.items[1].priceCents).toBeGreaterThan(s.items[0].priceCents);
  });

  it("a quantity whose price doesn't divide evenly becomes one named line", () => {
    const s = itemizedFromScan(scan({ items: [{ name: 'Naan', quantity: 3, unitPriceCents: 333, totalCents: 1000 }] }), base);
    expect(s.items[0]).toMatchObject({ name: '3 × Naan', priceCents: 1000 });
    expect(s.items[0].quantity).toBeUndefined();
  });

  it('fees are a line everyone shares', () => {
    const s = itemizedFromScan(scan({ items: [{ name: 'A', quantity: 1, unitPriceCents: null, totalCents: 1000 }], feesCents: 300 }), base);
    expect(s.items[1]).toMatchObject({ name: 'Service & fees', priceCents: 300 });
    expect(s.items[1].assignments.map(a => a.personId)).toEqual([ME, 'm', 'p']);
  });

  it('once everyone claims their lines, the split totals exactly what the receipt says', () => {
    const receipt = scan({
      items: [{ name: 'Mandi', quantity: 2, unitPriceCents: 2500, totalCents: 5000 }, { name: 'Chai', quantity: 1, unitPriceCents: null, totalCents: 300 }],
      discountCents: 300, feesCents: 200, taxCents: 416, tipCents: 800, totalCents: 6416,
    });
    const s = itemizedFromScan(receipt, base);
    const claimed = { ...s, items: s.items.map(i => i.assignments.length ? i : { ...i, assignments: [{ personId: ME, weight: 1 }, { personId: 'm', weight: 1 }] }) };
    const split = buildItemizedSplit(claimed, 6416);
    expect(split.source).toBe('receipt');
    expect(calculateSplit(toBill(split)).totalCents).toBe(6416);
  });

  it('nothing readable: one blank line to start from', () => {
    expect(itemizedFromScan(scan(), base).items).toHaveLength(1);
  });
});
