import { describe, it, expect } from 'vitest';
import { ME } from '../models';
import { calculateSplit } from './split/split';
import { buildItemizedSplit, emptyItemizedState, toBill } from './splits';
import {
  ReceiptScan, cleanScan, itemizedFromScan, scanAmountCents, scanBillCents, scanMismatchCents, scanTaxAndFeesCents, scanTaxParts,
} from './receipt';

const scan = (over: Partial<ReceiptScan> = {}): ReceiptScan => ({
  isReceipt: true, merchant: 'Hashtag India', date: '2026-09-29', items: [], subtotalCents: null,
  fees: [], discounts: [], taxCents: 0, tipCents: 0, totalCents: null, confidence: 0.9, ...over,
});

describe('cleanScan: nothing the model says is trusted as given', () => {
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

  it('keeps fees and discounts by name, dropping empty ones', () => {
    const s = cleanScan({
      fees: [{ name: 'Service fee', cents: 315 }, { name: '', cents: 199 }, { name: 'Bag fee', cents: 0 }],
      discounts: [{ name: 'DoorDash Credits', cents: 625 }],
    });
    expect(s.fees).toEqual([{ name: 'Service fee', cents: 315 }, { name: 'Fee', cents: 199 }]);
    expect(s.discounts).toEqual([{ name: 'DoorDash Credits', cents: 625 }]);
  });

  it('reads a scan from before fees and discounts were listed by name', () => {
    const s = cleanScan({ feesCents: 300, discountCents: 835 });
    expect(s.fees).toEqual([{ name: 'Fees', cents: 300 }]);
    expect(s.discounts).toEqual([{ name: 'Discount', cents: 835 }]);
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

// The DoorDash receipt that started this: 3× Vijayawada Style Chicken Biryani
// $41.97, Estimated Tax $3.64, Discount −$2.10, DoorDash Credits −$6.25, Total $37.26.
const doordash = () => scan({
  merchant: 'IGrill Indian Cuisine', date: '2026-07-19',
  items: [{ name: 'Vijayawada Style Chicken Biryani', quantity: 3, unitPriceCents: 1399, totalCents: 4197 }],
  subtotalCents: 4197,
  discounts: [{ name: 'Discount', cents: 210 }, { name: 'DoorDash Credits', cents: 625 }],
  taxCents: 364, totalCents: 3726,
});

describe('Tax & fees: tax, plus fees, less discounts and credits', () => {
  it('the DoorDash receipt: −$4.71, and the lines add up to the total', () => {
    expect(scanTaxAndFeesCents(doordash())).toBe(364 - 210 - 625);
    expect(scanBillCents(doordash())).toBe(3726);
    expect(scanMismatchCents(doordash())).toBe(0);
    expect(scanTaxParts(doordash())).toEqual([
      { name: 'Tax', cents: 364 }, { name: 'Discount', cents: -210 }, { name: 'DoorDash Credits', cents: -625 },
    ]);
  });

  it('delivery and service fees add to it', () => {
    const order = scan({
      items: [{ name: 'Pad Thai', quantity: 1, unitPriceCents: null, totalCents: 1600 }],
      fees: [{ name: 'Delivery fee', cents: 299 }, { name: 'Service fee', cents: 240 }, { name: 'Long distance fee', cents: 150 }],
      discounts: [{ name: 'Promotion', cents: 300 }],
      taxCents: 142, tipCents: 400, totalCents: 2531,
    });
    expect(scanTaxAndFeesCents(order)).toBe(142 + 299 + 240 + 150 - 300);
    expect(scanMismatchCents(order)).toBe(0);
  });

  it('never takes off more than the items cost', () => {
    const free = scan({ items: [{ name: 'A', quantity: 1, unitPriceCents: null, totalCents: 500 }], discounts: [{ name: 'Gift card', cents: 900 }] });
    expect(scanTaxAndFeesCents(free)).toBe(-500);
    expect(scanBillCents(free)).toBe(0);
  });

  it('a missed line shows as the total being more than the lines', () => {
    expect(scanMismatchCents({ ...doordash(), totalCents: 4226 })).toBe(500);
  });

  it('no printed total: nothing to check, and the amount is the lines', () => {
    expect(scanMismatchCents({ ...doordash(), totalCents: null })).toBe(0);
    expect(scanAmountCents({ ...doordash(), totalCents: null })).toBe(3726);
  });
});

describe('itemizedFromScan: the scan as an item-by-item split', () => {
  const base = { ...emptyItemizedState(), participantIds: [ME, 'm', 'p'] };

  it('items exactly as printed: 3 × $13.99 stays one line of three, discounts and all', () => {
    const s = itemizedFromScan(doordash(), base);
    expect(s.items).toHaveLength(1);
    expect(s.items[0]).toMatchObject({ name: 'Vijayawada Style Chicken Biryani', quantity: 3, unitPriceCents: 1399, priceCents: 4197 });
    expect(s.items[0].assignments).toEqual([]); // unclaimed: tap who had it
    expect(s.charges).toMatchObject({ taxMode: 'amount', taxCents: -471, tipMode: 'amount', tipCents: 0 });
    expect(s.participantIds).toEqual([ME, 'm', 'p']);
    expect(s.source).toBe('receipt');
  });

  it('three friends share the DoorDash order to the cent, discounts in proportion', () => {
    const s = itemizedFromScan(doordash(), base);
    // One biryani each.
    const claimed = { ...s, items: s.items.map(i => ({ ...i, assignments: [ME, 'm', 'p'].map(personId => ({ personId, weight: 1 })) })) };
    const split = buildItemizedSplit(claimed, 3726);
    const summary = calculateSplit(toBill(split));
    expect(summary.totalCents).toBe(3726);
    expect(summary.perPerson.map(p => p.totalCents)).toEqual([1242, 1242, 1242]);
    expect(summary.perPerson.reduce((t, p) => t + p.taxCents, 0)).toBe(-471);
  });

  it('someone who had more gets more of the discount', () => {
    const two = scan({
      items: [{ name: 'Big', quantity: 1, unitPriceCents: null, totalCents: 3000 }, { name: 'Small', quantity: 1, unitPriceCents: null, totalCents: 1000 }],
      discounts: [{ name: 'Promo', cents: 800 }], totalCents: 3200,
    });
    const s = itemizedFromScan(two, base);
    const claimed = { ...s, items: [{ ...s.items[0], assignments: [{ personId: ME, weight: 1 }] }, { ...s.items[1], assignments: [{ personId: 'm', weight: 1 }] }] };
    const per = calculateSplit(toBill(buildItemizedSplit(claimed, 3200))).perPerson;
    expect(per.map(p => p.totalCents)).toEqual([2400, 800, 0]); // Priya's on the bill, but had nothing
  });

  it("a quantity whose total doesn't divide evenly becomes one named line", () => {
    const s = itemizedFromScan(scan({ items: [{ name: 'Naan', quantity: 3, unitPriceCents: 333, totalCents: 1000 }] }), base);
    expect(s.items[0]).toMatchObject({ name: '3 × Naan', priceCents: 1000 });
    expect(s.items[0].quantity).toBeUndefined();
  });

  it('nothing readable: one blank line to start from', () => {
    expect(itemizedFromScan(scan(), base).items).toHaveLength(1);
  });
});
