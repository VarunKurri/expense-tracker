import { sum } from './split/money';
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

/** A fee or a discount, by the name it has on the receipt. Always positive. */
export interface NamedAmount {
  name: string;
  cents: number;
}

export interface ReceiptScan {
  isReceipt: boolean;
  merchant: string | null;
  /** YYYY-MM-DD, or null when it couldn't be read. */
  date: string | null;
  items: ScannedItem[];
  subtotalCents: number | null;
  /** Delivery, service and other fees: everything that isn't an item, tax or tip. */
  fees: NamedAmount[];
  /** Discounts, promotions, credits and gift cards: everything that lowers the total. */
  discounts: NamedAmount[];
  taxCents: number;
  tipCents: number;
  /** What was paid, as printed (including a written-in tip). */
  totalCents: number | null;
  /** 0–1: how sure the model is that it read the numbers right. */
  confidence: number;
}

const MAX_CENTS = 10_000_000; // $100,000; no receipt line is bigger
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

function namedAmounts(v: unknown, fallbackName: string): NamedAmount[] {
  return (Array.isArray(v) ? v : [])
    .slice(0, 20)
    .map((a: Record<string, unknown>) => ({ name: text(a?.['name'], 60) || fallbackName, cents: cents(a?.['cents']) }))
    .filter(a => a.cents > 0);
}

/** One lump sum from a scan made before fees and discounts were listed by name. */
const legacy = (v: unknown, name: string): NamedAmount[] => (cents(v) > 0 ? [{ name, cents: cents(v) }] : []);

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
    fees: Array.isArray(r['fees']) ? namedAmounts(r['fees'], 'Fee') : legacy(r['feesCents'], 'Fees'),
    discounts: Array.isArray(r['discounts']) ? namedAmounts(r['discounts'], 'Discount') : legacy(r['discountCents'], 'Discount'),
    taxCents: cents(r['taxCents']),
    tipCents: cents(r['tipCents']),
    totalCents: centsOrNull(r['totalCents']),
    confidence: Number.isFinite(confidence) ? Math.min(1, Math.max(0, confidence)) : 0,
  };
}

/** The items as printed. */
export function scanItemsCents(scan: ReceiptScan): number {
  return sum(scan.items.map(i => i.totalCents));
}

/**
 * What goes in "Tax & fees": tax, plus every fee, less every discount and
 * credit. Negative when the discounts are bigger; it then takes money off
 * everyone's share, in proportion, exactly as a discount would. Never more
 * negative than the items themselves.
 */
export function scanTaxAndFeesCents(scan: ReceiptScan): number {
  const net = scan.taxCents + sum(scan.fees.map(f => f.cents)) - sum(scan.discounts.map(d => d.cents));
  return Math.max(-scanItemsCents(scan), net);
}

/** The bill as the lines add up: items, tax and fees less discounts, and tip. */
export function scanBillCents(scan: ReceiptScan): number {
  return scanItemsCents(scan) + scanTaxAndFeesCents(scan) + scan.tipCents;
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

/** One part of "Tax & fees", for the note under a scan: "DoorDash Credits", −625. */
export interface TaxPart { name: string; cents: number; }

/** What "Tax & fees" is made of, in receipt order: tax, then fees, then discounts (negative). */
export function scanTaxParts(scan: ReceiptScan): TaxPart[] {
  return [
    ...(scan.taxCents ? [{ name: 'Tax', cents: scan.taxCents }] : []),
    ...scan.fees.map(f => ({ name: f.name, cents: f.cents })),
    ...scan.discounts.map(d => ({ name: d.name, cents: -d.cents })),
  ];
}

/**
 * The scan as an item-by-item split. Keeps who's on the bill and who else paid;
 * replaces the items, tax and tip.
 *
 * - Items are exactly as printed, so the editor can be checked line by line
 *   against the receipt: "3 × Biryani at $13.99" stays one line of three.
 * - Lines start unclaimed, since tapping who had what is the point of splitting by item.
 * - Fees, discounts and credits go into "Tax & fees" with the tax (the model
 *   has only tax and tip), so they're shared like tax: in proportion to what
 *   each person had. A delivery-app order with big credits can make it negative.
 * - Tip is the tip, as printed.
 */
export function itemizedFromScan(scan: ReceiptScan, base: ItemizedSplitState): ItemizedSplitState {
  const items: SplitItem[] = scan.items.map(line => {
    if (line.quantity > 1 && line.totalCents % line.quantity === 0) {
      return newItem([], line.name, line.totalCents / line.quantity, line.quantity);
    }
    // A quantity whose total doesn't divide evenly (a rounded unit price): one line at its total.
    return newItem([], line.quantity > 1 ? `${line.quantity} × ${line.name}` : line.name, line.totalCents);
  });

  return {
    ...base,
    items: items.length ? items : [newItem()],
    charges: {
      ...base.charges,
      taxMode: 'amount', taxCents: scanTaxAndFeesCents(scan), taxPercent: 0,
      tipMode: 'amount', tipCents: scan.tipCents, tipPercent: 0,
    },
    source: 'receipt',
  };
}
