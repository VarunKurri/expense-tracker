import { MoneyBackEntry, Transaction } from '../models';
import { formatCurrency } from './format';
import { fromCents } from './money';
import type { SplitTotals } from './reporting';
import { sum } from './split/money';
import { PersonSplitStatus, splitStatus } from './splits';

/**
 * Everyone who owes you, across every split bill — the Shared page.
 *
 * Per-bill arithmetic is `splitStatus` (Split's engine plus refunds and
 * repayments); this only gathers it by person, and spreads one repayment
 * over several bills. Integer cents throughout.
 */

export interface SharedBill {
  tx: Transaction;
  status: PersonSplitStatus;
}

export interface PersonBalance {
  personId: string;
  /** Still owed to you, across bills not marked "won't be repaid". */
  owedCents: number;
  /** Bills they still owe on, oldest first — the order a repayment pays them off. */
  openBills: SharedBill[];
  /** Every split bill they were on, newest first. */
  allBills: SharedBill[];
}

/** Each person you split with, most owed first. */
export function balancesByPerson(
  txs: Transaction[], moneyBackFor: (t: Transaction) => MoneyBackEntry[],
): PersonBalance[] {
  const byPerson = new Map<string, SharedBill[]>();
  for (const tx of txs) {
    if (tx.type !== 'expense' || !tx.split) continue;
    for (const status of splitStatus(tx.split, moneyBackFor(tx)).people) {
      byPerson.set(status.personId, [...(byPerson.get(status.personId) ?? []), { tx, status }]);
    }
  }
  const byDate = (a: SharedBill, b: SharedBill) => a.tx.date.localeCompare(b.tx.date) || a.tx.createdAt - b.tx.createdAt;
  return [...byPerson.entries()]
    .map(([personId, bills]) => {
      const openBills = bills
        .filter(b => b.status.outstandingCents > 0 && b.status.state !== 'closed')
        .sort(byDate);
      return {
        personId,
        owedCents: sum(openBills.map(b => b.status.outstandingCents)),
        openBills,
        allBills: [...bills].sort(byDate).reverse(),
      };
    })
    .sort((a, b) => b.owedCents - a.owedCents);
}

export interface RepaymentPart {
  expenseId: string;
  amountCents: number;
}

/**
 * Spread one repayment over someone's open bills, oldest first, each up to
 * what's still owed on it. Anything beyond everything owed goes on the
 * newest bill (where it shows as a surplus, and counts as income), so the
 * parts always add up to exactly what was paid.
 */
export function spreadRepayment(openBills: SharedBill[], amountCents: number): RepaymentPart[] {
  if (amountCents <= 0 || openBills.length === 0) return [];
  const parts: RepaymentPart[] = [];
  let left = amountCents;
  for (const bill of openBills) {
    if (left <= 0) break;
    const take = Math.min(left, bill.status.outstandingCents);
    if (take > 0) parts.push({ expenseId: bill.tx.id!, amountCents: take });
    left -= take;
  }
  if (left > 0) {
    const last = openBills[openBills.length - 1].tx.id!;
    const existing = parts.find(p => p.expenseId === last);
    if (existing) existing.amountCents += left;
    else parts.push({ expenseId: last, amountCents: left });
  }
  return parts;
}

/** Everything still owed to you, across everyone. */
export function totalOwedCents(balances: PersonBalance[]): number {
  return sum(balances.map(b => b.owedCents));
}

const usd = (cents: number) => formatCurrency(fromCents(cents));

/**
 * The sentence under "Owed to you" on Analysis: what you covered for other
 * people on a period's split bills, and what that means for your spending.
 * `period` reads after the bill count — "this month", "in this period", or ''.
 */
export function splitSentence(t: SplitTotals, period: string): string {
  const bills = `${t.bills} split bill${t.bills === 1 ? '' : 's'}${period ? ' ' + period : ''}`;
  if (t.forOthersCents === 0) return `Nobody owes you on your ${bills} — everyone paid their own way.`;

  const covered = `You covered ${usd(t.forOthersCents)} of other people's shares on ${bills}`;
  const wont = t.wontBeRepaidCents > 0
    ? ` ${usd(t.wontBeRepaidCents)} won't be repaid, so it stays in your spending.`
    : '';
  if (t.owedCents === 0) {
    return t.wontBeRepaidCents === 0
      ? `${covered}, and all of it came back — only your share counts as spending.`
      : `${covered}.${wont}`;
  }
  const back = t.repaidCents > 0
    ? `, and ${usd(t.repaidCents)} has come back. Until the other ${usd(t.owedCents)} does, it counts in your spending.`
    : '. Until it comes back, it counts in your spending.';
  return `${covered}${back}${wont}`;
}
