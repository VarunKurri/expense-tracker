// Ported from VarunKurri/split-the-bill src/domain/split.ts @ cc6a8db, with one
// deliberate change (Trackr Part 105): a person's share is rounded once for the
// whole bill, not item by item. See "Rounding" below. Otherwise keep it in sync
// with Split by copying: its invariants (integer cents, every cent allocated,
// reconciliation) are what make it trustworthy.

import { allocate, allocateExact, percentOf, sum } from './money';
import { settle } from './settle';
import type {
  Bill,
  BillSummary,
  Charges,
  ID,
  Item,
  PersonBreakdown,
  PersonLine,
  SplitMode,
} from './types';

/**
 * The whole calculation, as one pure function of the bill.
 *
 * Three decisions are encoded here, and they are the ones that make or break
 * whether the answer feels fair at the table:
 *
 * 1. Items are split by weight, then by whole cents via largest-remainder
 *    allocation, so a $10 plate shared three ways is 3.34 / 3.33 / 3.33 and
 *    never 3.33 x 3 with a cent quietly vanishing.
 *
 * 2. Tax and tip are allocated in proportion to each person's item subtotal,
 *    not per head. The friend who only had a salad pays tip on a salad.
 *
 * 3. Unassigned items participate in that proportional allocation as a
 *    phantom claimant. Their tax and tip stay unclaimed rather than being
 *    silently redistributed onto the people who have already been assigned,
 *    so nobody is quietly overcharged for a plate nobody has owned up to.
 *
 * An item's split mode (equal, shares, percent) does not appear here on
 * purpose: all three are just ways of arriving at the weight vector, and the
 * arithmetic below is identical whichever was used.
 *
 * Rounding (Trackr): everyone's share is first worked out exactly (fractions
 * of a cent and all), then each figure (items, tax, tip, total) is turned into
 * whole cents once for the whole bill. Rounding each item separately let the
 * odd cents pile up: two people sharing three odd-priced items came out
 * $24.54 and $24.51 instead of $24.53 and $24.52, because the same person got
 * the spare cent every time. Now nobody's total is more than a cent from
 * exact, and equal shares are never more than a cent apart. When a cent can't
 * be split, whoever paid takes it first, then people in the bill's order.
 * Item lines (`lines`) are still each item's own split, for the breakdown;
 * `roundingCents` is whatever the total differs from items + tax + tip.
 */
export function calculateSplit(bill: Bill): BillSummary {
  const { people, items, charges } = bill;

  const subtotalCents = sum(items.map((item) => item.priceCents));

  // ---- 1. Item shares -------------------------------------------------
  // `lines` keep each item's own split for the breakdown; the exact share is
  // what the rounding at the end is based on.
  const exactSubtotals = new Map<ID, number>(people.map((p) => [p.id, 0]));
  const personLines = new Map<ID, PersonLine[]>(people.map((p) => [p.id, []]));
  const unassignedItemIds: ID[] = [];
  let unassignedCents = 0;

  for (const item of items) {
    const claims = activeAssignments(item, people);

    if (claims.length === 0) {
      unassignedItemIds.push(item.id);
      unassignedCents += item.priceCents;
      continue;
    }

    const weights = claims.map((c) => c.weight);
    const totalWeight = sum(weights);
    const shares = allocate(item.priceCents, weights);

    claims.forEach((claim, index) => {
      exactSubtotals.set(
        claim.personId,
        (exactSubtotals.get(claim.personId) ?? 0) + (item.priceCents * claim.weight) / totalWeight,
      );
      personLines.get(claim.personId)?.push({
        itemId: item.id,
        itemName: item.name,
        shareLabel: shareLabel(item.splitMode, claims.length, claim.weight, totalWeight),
        amountCents: shares[index],
      });
    });
  }

  // ---- 2. Tax and tip totals -----------------------------------------
  const taxCents = resolveTax(charges, subtotalCents);
  const tipCents = resolveTip(charges, subtotalCents, taxCents);
  const totalCents = subtotalCents + taxCents + tipCents;

  // ---- 3. What each person paid ---------------------------------------
  // Payments naming somebody who has since left the bill are dropped, for the
  // same reason stale assignments are: the engine must not be the thing that
  // turns an old localStorage payload into a wrong total.
  const known = new Set(people.map((p) => p.id));
  const paidByPerson = new Map<ID, number>();
  for (const payment of bill.payments) {
    if (!known.has(payment.personId)) continue;
    paidByPerson.set(
      payment.personId,
      (paidByPerson.get(payment.personId) ?? 0) + payment.amountCents,
    );
  }

  // A cent that can't be split goes to whoever paid first, then in bill order.
  const priority = [
    ...people.map((p, i) => i).filter((i) => (paidByPerson.get(people[i].id) ?? 0) > 0),
    ...people.map((p, i) => i).filter((i) => (paidByPerson.get(people[i].id) ?? 0) <= 0),
  ];

  // ---- 4. Exact shares, rounded once ----------------------------------
  // Tax and tip follow each person's item subtotal. The unassigned value is
  // the final, phantom claimant: its slice is reported as unclaimed rather
  // than handed to anybody. With nothing priced yet, keep every cent of a
  // flat charge unclaimed instead of charging the people at the table.
  const exactSubs = [...people.map((p) => exactSubtotals.get(p.id) ?? 0), unassignedCents];
  const chargeBase = sum(exactSubs);
  const chargeShare = (charge: number) =>
    chargeBase > 0
      ? exactSubs.map((s) => (charge * s) / chargeBase)
      : [...people.map(() => 0), charge];

  const phantom = people.length;
  const exactTax = chargeShare(taxCents);
  const exactTip = chargeShare(tipCents);
  const subShares = allocateExact(subtotalCents, exactSubs, [...priority, phantom]);
  const taxShares = allocateExact(taxCents, exactTax, [...priority, phantom]);
  const tipShares = allocateExact(tipCents, exactTip, [...priority, phantom]);

  // Totals are rounded from the exact totals (not by adding rounded parts), so
  // two equal shares can't drift apart by a cent per part. Whatever the
  // phantom holds stays unclaimed exactly as in the parts above.
  // Odd cents go to the people chosen for this bill first, if any.
  const unclaimedCents = subShares[phantom] + taxShares[phantom] + tipShares[phantom];
  const exactTotals = people.map((p, i) => exactSubs[i] + exactTax[i] + exactTip[i]);
  const claimedCents = totalCents - unclaimedCents;
  const preferred = (bill.roundUpIds ?? []).map((id) => people.findIndex((p) => p.id === id)).filter((i) => i >= 0);
  const totals = allocateExact(claimedCents, exactTotals, priority, preferred);
  const exactSum = sum(exactTotals);
  const scaledTotal = (i: number) =>
    exactSum === 0 ? 0 : Math.round(((Math.abs(claimedCents) * exactTotals[i]) / exactSum) * 1e6) / 1e6;
  const roundable = people.filter((p, i) => scaledTotal(i) !== Math.floor(scaledTotal(i)));
  const roundableIds = roundable.map((p) => p.id);
  const roundedUpIds = roundable
    .filter((p) => {
      const i = people.indexOf(p);
      return Math.abs(totals[i]) > Math.floor(scaledTotal(i));
    })
    .map((p) => p.id);

  const perPerson: PersonBreakdown[] = people.map((person, index) => {
    const subtotal = subShares[index];
    const tax = taxShares[index];
    const tip = tipShares[index];
    const owed = totals[index];
    const paid = paidByPerson.get(person.id) ?? 0;

    return {
      personId: person.id,
      lines: personLines.get(person.id) ?? [],
      subtotalCents: subtotal,
      taxCents: tax,
      tipCents: tip,
      roundingCents: owed - (subtotal + tax + tip),
      totalCents: owed,
      paidCents: paid,
      netCents: paid - owed,
    };
  });

  const unclaimedTaxCents = taxShares[people.length];
  const unclaimedTipCents = tipShares[people.length];
  const unclaimedChargesCents = unclaimedTaxCents + unclaimedTipCents;
  const claimed = sum(perPerson.map((p) => p.totalCents));
  const reconciles = claimed + unassignedCents + unclaimedChargesCents === totalCents;

  // ---- 5. Settle up ------------------------------------------------------
  const paidCents = sum(perPerson.map((p) => p.paidCents));

  return {
    subtotalCents,
    unassignedCents,
    unassignedItemIds,
    taxCents,
    tipCents,
    totalCents,
    unclaimedChargesCents,
    unclaimedTaxCents,
    unclaimedTipCents,
    perPerson,
    roundedUpIds,
    roundableIds,
    reconciles,
    paidCents,
    unpaidCents: totalCents - paidCents,
    transfers: settle(perPerson.map((p) => ({ personId: p.personId, netCents: p.netCents }))),
  };
}

/**
 * How a person's slice of an item is described in their breakdown.
 *
 * Percent mode reports the *effective* percentage rather than the number that
 * was typed. When the entered percentages don't add up to 100 the money is
 * still divided proportionally, so saying "40%" when the split actually works
 * out to 44.4% would be a lie about where the money went.
 */
function shareLabel(
  mode: SplitMode,
  claimCount: number,
  weight: number,
  totalWeight: number,
): string {
  if (claimCount === 1) return 'full';
  if (mode === 'percent' || mode === 'amount') {
    const effective = totalWeight > 0 ? (weight / totalWeight) * 100 : 0;
    return `${trimZeros(effective.toFixed(1))}%`;
  }
  return `${weight}/${totalWeight}`;
}

function trimZeros(value: string): string {
  return value.replace(/\.0$/, '');
}

/**
 * Zero weights stay editable but claim no money. Use the same claimant list
 * for the calculation and ownership labels so the UI never contradicts the totals.
 * Assignments pointing at a person who has since been removed are ignored
 * rather than trusted. The reducer prunes them, but the engine must not
 * produce a wrong total if it is ever handed stale state (an old localStorage
 * payload, say).
 */
export function activeAssignments(item: Item, people: { id: ID }[]) {
  const known = new Set(people.map((p) => p.id));
  return item.assignments.filter((a) => known.has(a.personId) && a.weight > 0);
}

function resolveTax(charges: Charges, subtotalCents: number): number {
  return charges.taxMode === 'percent'
    ? percentOf(subtotalCents, charges.taxPercent)
    : charges.taxCents;
}

function resolveTip(charges: Charges, subtotalCents: number, taxCents: number): number {
  if (charges.tipMode === 'amount') return charges.tipCents;
  const base = charges.tipBasis === 'postTax' ? subtotalCents + taxCents : subtotalCents;
  return percentOf(base, charges.tipPercent);
}

/* ------------------------------------------------------------------ */
/* Small selectors used by the UI                                      */
/* ------------------------------------------------------------------ */

/** Per-share amount for an evenly shared item, for the "$14.00 each" hint. */
export function perShareCents(item: Item, people?: { id: ID }[]): number | null {
  const claims = people
    ? activeAssignments(item, people)
    : item.assignments.filter((a) => a.weight > 0);
  if (claims.length < 2) return null;
  const weights = claims.map((a) => a.weight);
  const uneven = weights.some((w) => w !== weights[0]);
  if (uneven) return null;
  return allocate(item.priceCents, weights)[0];
}

/**
 * Sum of an item's weights. Meaningless in `equal` and `shares` mode, but in
 * `percent` it's the percentage total and in `amount` it's the cents assigned.
 */
export function weightTotal(item: Item): number {
  return sum(item.assignments.map((a) => a.weight));
}

/**
 * Whether the numbers the user typed actually add up: to 100 for percentages,
 * to the item's price for amounts.
 *
 * When they don't, the money is still divided proportionally and the item is
 * still fully allocated; this only drives the warning. Getting the arithmetic
 * right is not conditional on the user getting their input right.
 */
export function splitIsBalanced(item: Item): boolean {
  if (item.assignments.length === 0) return true;
  if (item.splitMode === 'percent') return Math.abs(weightTotal(item) - 100) < 0.005;
  if (item.splitMode === 'amount') return Math.round(weightTotal(item)) === item.priceCents;
  return true;
}

/**
 * How far an `amount` split is from covering the item, in cents. Positive means
 * there is still money to hand out, negative means it has been over-assigned.
 */
export function amountGapCents(item: Item): number {
  return item.priceCents - Math.round(weightTotal(item));
}
