import { allocate, sum } from './split/money';
import { ItemizedSplitState, newItem } from './splits';
import { SplitItem } from '../models';

/**
 * A scanned receipt, and how it becomes an item-by-item split.
 *
 * The `scanReceipt` Cloud Function sends the photo to the model and returns
 * what it read; everything here is plain arithmetic on that, in integer cents,
 * so it can be tested without a network. Nothing is trusted as given: a model
 * can return a negative price, a 400-character name or a date like "Tuesday",
 * and `cleanScan` turns all of that into something the editor can show.
 */

export interface ScannedItem {
  name: string;
  /** How many; 1 when the receipt doesn't say. */
  quantity: number;
  /** The price of one, when printed. */
  unitPriceCents: number | null;
  /** The line's total. */
  totalCents: number;
}

export interface ReceiptScan {
  isReceipt: boolean;
  merchant: string | null;
  /** YYYY-MM-DD, or null when it couldn't be read. */
  date: string | null;
  items: ScannedItem[];
  subtotalCents: number | null;
  /** Order-level discounts and coupons, as a positive amount. */
  discountCents: number;
  /** Service charges, delivery and other fees. */
  feesCents: number;
  taxCents: number;
  tipCents: number;
  /** What was paid, as printed (including a written-in tip). */
  totalCents: number | null;
  /** 0–1: how sure the model is that it read the numbers right. */
  confidence: number;
}

const MAX_CENTS = 10_000_000; // $100,000 — no receipt line is bigger
const MAX_ITEMS = 60;

const cents = (v: unknown): number => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(MAX_CENTS, Math.max(0, n)) : 0;
};
const centsOrNull = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : cents(v));
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : '');

function validDate(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
  const d = new Date(`${v}T00:00:00`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v ? null : v;
}

/** Whatever came back, as a well-formed scan. */
export function cleanScan(raw: unknown): ReceiptScan {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const items = (Array.isArray(r['items']) ? r['items'] : [])
    .slice(0, MAX_ITEMS)
    .map((i: Record<string, unknown>): ScannedItem => {
      const quantity = Math.min(99, Math.max(1, Math.round(Number(i?.['quantity'])) || 1));
      return {
        name: text(i?.['name'], 80) || 'Item',
        quantity,
        unitPriceCents: centsOrNull(i?.['unitPriceCents']),
        totalCents: cents(i?.['totalCents']),
      };
    })
    .filter(i => i.totalCents > 0);
  const confidence = Number(r['confidence']);
  return {
    isReceipt: r['isReceipt'] !== false,
    merchant: text(r['merchant'], 80) || null,
    date: validDate(r['date']),
    items,
    subtotalCents: centsOrNull(r['subtotalCents']),
    discountCents: cents(r['discountCents']),
    feesCents: cents(r['feesCents']),
    taxCents: cents(r['taxCents']),
    tipCents: cents(r['tipCents']),
    totalCents: centsOrNull(r['totalCents']),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

/** The items after any order-level discount, plus fees — what tax and tip sit on top of. */
export function scanItemsCents(scan: ReceiptScan): number {
  return Math.max(0, sum(scan.items.map(i => i.totalCents)) - scan.discountCents) + scan.feesCents;
}

/** The bill as the lines add up: items, less discount, plus fees, tax and tip. */
export function scanBillCents(scan: ReceiptScan): number {
  return scanItemsCents(scan) + scan.taxCents + scan.tipCents;
}

/**
 * How far the lines are from the printed total (positive: the total is more,
 * so a line was probably missed). 0 when there's no total to check against.
 */
export function scanMismatchCents(scan: ReceiptScan): number {
  return scan.totalCents === null ? 0 : scan.totalCents - scanBillCents(scan);
}

/** What the transaction amount should be: the printed total, or the lines' sum. */
export function scanAmountCents(scan: ReceiptScan): number {
  return scan.totalCents ?? scanBillCents(scan);
}

/**
 * The scan as an item-by-item split. Keeps who's on the bill and who else paid;
 * replaces the items, tax and tip.
 *
 * - Lines start unclaimed — tapping who had what is the point of splitting by item.
 * - An order-level discount comes off the lines in proportion to their price
 *   (Split's `allocate`, so not a cent goes missing).
 * - "2 × Mandi" stays one line with a quantity when the price divides evenly;
 *   otherwise it's one line, named "2 × Mandi", at its total.
 * - Fees (service charge, delivery) are a line shared by everyone on the bill.
 * - Tax and tip are fixed amounts, exactly as printed.
 */
export function itemizedFromScan(scan: ReceiptScan, base: ItemizedSplitState): ItemizedSplitState {
  const lineTotals = scan.items.map(i => i.totalCents);
  const linesCents = sum(lineTotals);
  const discounted = scan.discountCents > 0 && linesCents > 0
    ? allocate(Math.max(0, linesCents - scan.discountCents), lineTotals)
    : lineTotals;

  const items: SplitItem[] = scan.items.map((line, i) => {
    const total = discounted[i];
    if (line.quantity > 1 && total % line.quantity === 0) {
      return newItem([], line.name, total / line.quantity, line.quantity);
    }
    return newItem([], line.quantity > 1 ? `${line.quantity} × ${line.name}` : line.name, total);
  });
  if (scan.feesCents > 0) items.push(newItem(base.participantIds, 'Service & fees', scan.feesCents));

  return {
    ...base,
    items: items.length ? items : [newItem()],
    charges: {
      ...base.charges,
      taxMode: 'amount', taxCents: scan.taxCents, taxPercent: 0,
      tipMode: 'amount', tipCents: scan.tipCents, tipPercent: 0,
    },
    source: 'receipt',
  };
}
