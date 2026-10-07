import { MoneyBackEntry } from '../models';

/**
 * Money back on an expense — refunds and repayments alike — and what it leaves
 * you out of pocket. All integer cents.
 *
 * The rule (the same one Trackr's reimbursement netting has always used):
 *
 *     out of pocket = what you paid − everything that came back, floored at 0
 *
 * and anything that came back beyond what you paid is a surplus, which counts
 * as income rather than being silently dropped.
 */

export function moneyBackTotalCents(entries: MoneyBackEntry[]): number {
  return entries.reduce((total, e) => total + e.amountCents, 0);
}

export function outOfPocketCents(paidCents: number, entries: MoneyBackEntry[]): number {
  return Math.max(0, paidCents - moneyBackTotalCents(entries));
}

export function surplusCents(paidCents: number, entries: MoneyBackEntry[]): number {
  return Math.max(0, moneyBackTotalCents(entries) - paidCents);
}
