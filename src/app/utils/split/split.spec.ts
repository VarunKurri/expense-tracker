// Ported verbatim from VarunKurri/split-the-bill src/domain/split.test.ts @ cc6a8db, plus
// one Trackr block at the end (rounding once per bill, Part 105).

import { describe, expect, it } from 'vitest';
import {
  activeAssignments,
  amountGapCents,
  calculateSplit,
  perShareCents,
  splitIsBalanced,
} from './split';
import { sum } from './money';
import type { Bill, Charges, Item, Payment, Person } from './types';

const NO_CHARGES: Charges = {
  taxMode: 'percent',
  taxPercent: 0,
  taxCents: 0,
  tipMode: 'percent',
  tipPercent: 0,
  tipCents: 0,
  tipBasis: 'preTax',
};

function person(id: string, name: string, colorIndex = 1): Person {
  return { id, name, colorIndex };
}

function item(id: string, name: string, priceCents: number, ...owners: string[]): Item {
  return {
    id,
    name,
    priceCents,
    splitMode: 'equal',
    assignments: owners.map((personId) => ({ personId, weight: 1 })),
  };
}

function bill(
  people: Person[],
  items: Item[],
  charges: Charges = NO_CHARGES,
  payments: Payment[] = [],
): Bill {
  return {
    name: 'Test bill',
    createdAt: '2026-09-08T00:00:00.000Z',
    people,
    items,
    charges,
    payments,
    settledPersonIds: [],
  };
}

describe('calculateSplit: item assignment', () => {
  it('gives a solely-owned item entirely to its owner', () => {
    const result = calculateSplit(
      bill([person('a', 'Alex'), person('b', 'Bri')], [item('i1', 'Steak', 4200, 'a')]),
    );
    expect(result.perPerson[0].totalCents).toBe(4200);
    expect(result.perPerson[1].totalCents).toBe(0);
  });

  it('splits a shared item evenly and keeps the cents', () => {
    const result = calculateSplit(
      bill(
        [person('a', 'Alex'), person('b', 'Bri'), person('c', 'Chidi')],
        [item('i1', 'Burrata', 1000, 'a', 'b', 'c')],
      ),
    );
    expect(result.perPerson.map((p) => p.subtotalCents)).toEqual([334, 333, 333]);
    expect(sum(result.perPerson.map((p) => p.subtotalCents))).toBe(1000);
  });

  it('honours uneven share weights', () => {
    const shared: Item = {
      id: 'i1',
      name: 'Whole fish',
      priceCents: 3000,
      splitMode: 'shares',
      assignments: [
        { personId: 'a', weight: 2 },
        { personId: 'b', weight: 1 },
      ],
    };
    const result = calculateSplit(bill([person('a', 'Alex'), person('b', 'Bri')], [shared]));
    expect(result.perPerson[0].subtotalCents).toBe(2000);
    expect(result.perPerson[1].subtotalCents).toBe(1000);
  });

  it('labels each line with the share it represents', () => {
    const result = calculateSplit(
      bill([person('a', 'Alex'), person('b', 'Bri')], [item('i1', 'Burrata', 1000, 'a', 'b')]),
    );
    expect(result.perPerson[0].lines[0].shareLabel).toBe('1/2');
  });
});

describe('calculateSplit: the friend who only had a salad', () => {
  it('charges tax and tip in proportion to what each person ordered', () => {
    // Alex: $60 steak. Bri: $12 salad. 10% tax, 20% tip on pre-tax subtotal.
    const charges: Charges = {
      ...NO_CHARGES,
      taxPercent: 10,
      tipPercent: 20,
    };
    const result = calculateSplit(
      bill(
        [person('a', 'Alex'), person('b', 'Bri')],
        [item('i1', 'Steak', 6000, 'a'), item('i2', 'Salad', 1200, 'b')],
        charges,
      ),
    );

    expect(result.subtotalCents).toBe(7200);
    expect(result.taxCents).toBe(720);
    expect(result.tipCents).toBe(1440);

    // Alex ordered 60/72 of the food, so pays 60/72 of tax and tip.
    expect(result.perPerson[0].taxCents).toBe(600);
    expect(result.perPerson[0].tipCents).toBe(1200);
    expect(result.perPerson[0].totalCents).toBe(7800);

    // Bri pays tip on a salad, not on a steak.
    expect(result.perPerson[1].taxCents).toBe(120);
    expect(result.perPerson[1].tipCents).toBe(240);
    expect(result.perPerson[1].totalCents).toBe(1560);

    expect(result.reconciles).toBe(true);
  });

  it('is meaningfully cheaper for the salad-eater than an even split would be', () => {
    const charges: Charges = { ...NO_CHARGES, taxPercent: 10, tipPercent: 20 };
    const result = calculateSplit(
      bill(
        [person('a', 'Alex'), person('b', 'Bri')],
        [item('i1', 'Steak', 6000, 'a'), item('i2', 'Salad', 1200, 'b')],
        charges,
      ),
    );
    const evenSplit = result.totalCents / 2;
    expect(result.perPerson[1].totalCents).toBeLessThan(evenSplit);
  });
});

describe('calculateSplit: tax and tip', () => {
  it('supports a flat tax amount instead of a percentage', () => {
    const charges: Charges = { ...NO_CHARGES, taxMode: 'amount', taxCents: 513 };
    const result = calculateSplit(
      bill([person('a', 'Alex')], [item('i1', 'Dinner', 5000, 'a')], charges),
    );
    expect(result.taxCents).toBe(513);
    expect(result.perPerson[0].totalCents).toBe(5513);
  });

  it('tips on the post-tax total when asked to', () => {
    const preTax = calculateSplit(
      bill([person('a', 'Alex')], [item('i1', 'Dinner', 10000, 'a')], {
        ...NO_CHARGES,
        taxPercent: 10,
        tipPercent: 20,
        tipBasis: 'preTax',
      }),
    );
    const postTax = calculateSplit(
      bill([person('a', 'Alex')], [item('i1', 'Dinner', 10000, 'a')], {
        ...NO_CHARGES,
        taxPercent: 10,
        tipPercent: 20,
        tipBasis: 'postTax',
      }),
    );
    expect(preTax.tipCents).toBe(2000);
    expect(postTax.tipCents).toBe(2200);
  });
});

describe('calculateSplit: unassigned items', () => {
  it('reports unassigned value instead of spreading it silently', () => {
    const result = calculateSplit(
      bill(
        [person('a', 'Alex'), person('b', 'Bri')],
        [item('i1', 'Steak', 6000, 'a'), item('i2', 'Mystery side', 900)],
      ),
    );
    expect(result.unassignedCents).toBe(900);
    expect(result.unassignedItemIds).toEqual(['i2']);
    expect(sum(result.perPerson.map((p) => p.subtotalCents))).toBe(6000);
  });

  it('leaves the unassigned item’s tax and tip unclaimed', () => {
    const charges: Charges = { ...NO_CHARGES, taxPercent: 10, tipPercent: 20 };
    const result = calculateSplit(
      bill(
        [person('a', 'Alex')],
        [item('i1', 'Steak', 6000, 'a'), item('i2', 'Mystery side', 4000)],
        charges,
      ),
    );
    // Alex ordered 60% of the food and is charged 60% of the charges, not 100%.
    expect(result.perPerson[0].taxCents).toBe(600);
    expect(result.perPerson[0].tipCents).toBe(1200);
    expect(result.unclaimedChargesCents).toBe(400 + 800);
    expect(result.reconciles).toBe(true);
  });
});

describe('calculateSplit: reconciliation', () => {
  const charges: Charges = { ...NO_CHARGES, taxPercent: 8.5, tipPercent: 18 };

  it('always adds back up to the bill total', () => {
    const people = [
      person('a', 'Alex'),
      person('b', 'Bri'),
      person('c', 'Chidi'),
      person('d', 'Dana'),
    ];
    const items = [
      item('i1', 'Branzino', 4200, 'a'),
      item('i2', 'Burrata', 1700, 'a', 'b', 'c'),
      item('i3', 'Cacio e pepe', 2600, 'b'),
      item('i4', 'Negroni', 1900, 'c', 'd'),
      item('i5', 'Tiramisu', 1400, 'a', 'b', 'c', 'd'),
      item('i6', 'Sparkling water', 900, 'a', 'b', 'c', 'd'),
    ];
    const result = calculateSplit(bill(people, items, charges));

    expect(result.reconciles).toBe(true);
    expect(sum(result.perPerson.map((p) => p.totalCents))).toBe(result.totalCents);
  });

  it('reconciles across a wide sweep of awkward prices and party sizes', () => {
    for (let price = 101; price < 4000; price += 137) {
      for (let headcount = 2; headcount <= 7; headcount += 1) {
        const people = Array.from({ length: headcount }, (_, i) => person(`p${i}`, `P${i}`));
        const shared = item('shared', 'Shared plate', price, ...people.map((p) => p.id));
        const solo = item('solo', 'Solo plate', price * 2, people[0].id);
        const result = calculateSplit(bill(people, [shared, solo], charges));

        expect(result.reconciles).toBe(true);
        expect(sum(result.perPerson.map((p) => p.totalCents))).toBe(result.totalCents);
      }
    }
  });

  it('records the rounding adjustment it applied', () => {
    const people = [person('a', 'A'), person('b', 'B'), person('c', 'C')];
    const result = calculateSplit(
      bill(people, [item('i1', 'Shared', 1000, 'a', 'b', 'c')], {
        ...NO_CHARGES,
        taxPercent: 8.5,
        tipPercent: 18,
      }),
    );
    // Whatever the adjustments are, they cancel out across the party.
    expect(sum(result.perPerson.map((p) => p.roundingCents))).toBe(0);
  });
});

describe('calculateSplit: degenerate input', () => {
  it.each(['empty', 'people only', 'free assigned item', 'free unassigned item'])(
    'keeps flat charges unclaimed with a zero subtotal: %s',
    (scenario) => {
      const people = scenario === 'empty' ? [] : [person('a', 'Alex')];
      const items =
        scenario === 'free assigned item'
          ? [item('free', 'Comped dessert', 0, 'a')]
          : scenario === 'free unassigned item'
            ? [item('free', 'Comped dessert', 0)]
            : [];
      const result = calculateSplit(
        bill(people, items, {
          ...NO_CHARGES,
          taxMode: 'amount',
          taxCents: 125,
          tipMode: 'amount',
          tipCents: 375,
        }),
      );
      expect(result.totalCents).toBe(500);
      expect(result.unclaimedTaxCents).toBe(125);
      expect(result.unclaimedTipCents).toBe(375);
      expect(result.unclaimedChargesCents).toBe(500);
      expect(result.perPerson.every((p) => p.totalCents === 0)).toBe(true);
      expect(result.unpaidCents).toBe(500);
      expect(result.reconciles).toBe(true);
    },
  );

  it('keeps post-tax percentage tip unclaimed when only flat tax supplies its base', () => {
    const result = calculateSplit(
      bill([person('a', 'Alex')], [], {
        ...NO_CHARGES,
        taxMode: 'amount',
        taxCents: 125,
        tipPercent: 20,
        tipBasis: 'postTax',
      }),
    );
    expect(result.tipCents).toBe(25);
    expect(result.unclaimedChargesCents).toBe(150);
    expect(result.reconciles).toBe(true);
  });

  it('allocates previously unclaimed flat charges once a priced item is assigned', () => {
    const people = [person('a', 'Alex'), person('b', 'Bri')];
    const charges: Charges = {
      ...NO_CHARGES,
      taxMode: 'amount',
      taxCents: 125,
      tipMode: 'amount',
      tipCents: 375,
    };
    const result = calculateSplit(bill(people, [item('meal', 'Dinner', 1000, 'a')], charges));
    expect(result.unclaimedChargesCents).toBe(0);
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([1500, 0]);
    expect(result.reconciles).toBe(true);
  });

  it('handles an empty bill', () => {
    const result = calculateSplit(bill([], []));
    expect(result.totalCents).toBe(0);
    expect(result.perPerson).toEqual([]);
    expect(result.reconciles).toBe(true);
  });

  it('handles people with no items', () => {
    const result = calculateSplit(bill([person('a', 'Alex')], []));
    expect(result.perPerson[0].totalCents).toBe(0);
    expect(result.reconciles).toBe(true);
  });

  it('handles a zero-value item without dividing by zero', () => {
    const result = calculateSplit(
      bill([person('a', 'Alex'), person('b', 'Bri')], [item('i1', 'Comped dessert', 0, 'a', 'b')], {
        ...NO_CHARGES,
        taxPercent: 8.5,
        tipPercent: 20,
      }),
    );
    expect(result.perPerson.every((p) => p.totalCents === 0)).toBe(true);
    expect(result.reconciles).toBe(true);
  });

  it('ignores assignments pointing at a person who has been removed', () => {
    const stale = bill([person('a', 'Alex')], [item('i1', 'Shared', 1000, 'a', 'ghost')]);
    const result = calculateSplit(stale);
    expect(result.perPerson[0].subtotalCents).toBe(1000);
    expect(result.reconciles).toBe(true);
  });
});

describe('perShareCents', () => {
  it('does not describe all-zero assignments as an even split', () => {
    expect(perShareCents(percentItem(1000, { a: 0, b: 0 }))).toBeNull();
  });

  it('uses the same positive, current claimants as the calculation', () => {
    const shared = percentItem(1000, { a: 50, b: 50, c: 0, gone: 100 });
    const people = [person('a', 'Alex'), person('b', 'Bri'), person('c', 'Chidi')];
    expect(activeAssignments(shared, people).map((a) => a.personId)).toEqual(['a', 'b']);
    expect(perShareCents(shared, people)).toBe(500);
    expect(perShareCents(percentItem(1000, { a: 100, b: 0 }))).toBeNull();
    expect(calculateSplit(bill(people, [shared])).perPerson.map((p) => p.subtotalCents)).toEqual([
      500, 500, 0,
    ]);
  });

  it('reports the per-head amount for an evenly shared item', () => {
    expect(perShareCents(item('i1', 'Burrata', 4200, 'a', 'b', 'c'))).toBe(1400);
  });

  it('returns null when the item is not evenly shared', () => {
    expect(perShareCents(item('i1', 'Solo', 4200, 'a'))).toBeNull();
    expect(
      perShareCents({
        id: 'i1',
        name: 'Uneven',
        priceCents: 3000,
        splitMode: 'shares',
        assignments: [
          { personId: 'a', weight: 2 },
          { personId: 'b', weight: 1 },
        ],
      }),
    ).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Percent splits                                                      */
/* ------------------------------------------------------------------ */

function percentItem(priceCents: number, percents: Record<string, number>, id = 'i1'): Item {
  return {
    id,
    name: 'Percent item',
    priceCents,
    splitMode: 'percent',
    assignments: Object.entries(percents).map(([personId, weight]) => ({ personId, weight })),
  };
}

describe('calculateSplit: percent splits', () => {
  const three = [person('a', 'Alex'), person('b', 'Bri'), person('c', 'Chidi')];

  it('divides by the percentages given', () => {
    const result = calculateSplit(bill(three, [percentItem(10000, { a: 50, b: 30, c: 20 })]));
    expect(result.perPerson.map((p) => p.subtotalCents)).toEqual([5000, 3000, 2000]);
  });

  it('keeps every cent when the percentages do not divide evenly', () => {
    const result = calculateSplit(
      bill(three, [percentItem(1000, { a: 33.34, b: 33.33, c: 33.33 })]),
    );
    expect(sum(result.perPerson.map((p) => p.subtotalCents))).toBe(1000);
  });

  it('still allocates the exact item total when percentages do not sum to 100', () => {
    // Someone typed 40/40/40. The split stays proportional and the item is
    // fully allocated rather than over- or under-charging the table.
    const result = calculateSplit(bill(three, [percentItem(9000, { a: 40, b: 40, c: 40 })]));
    expect(sum(result.perPerson.map((p) => p.subtotalCents))).toBe(9000);
    expect(result.perPerson.map((p) => p.subtotalCents)).toEqual([3000, 3000, 3000]);
    expect(result.reconciles).toBe(true);
  });

  it('drops a zero-percent claimant instead of charging them nothing forever', () => {
    const result = calculateSplit(bill(three, [percentItem(1000, { a: 60, b: 40, c: 0 })]));
    expect(result.perPerson[2].subtotalCents).toBe(0);
    expect(result.perPerson[2].lines).toHaveLength(0);
  });

  it('treats an all-zero percent item as unassigned', () => {
    const result = calculateSplit(bill(three, [percentItem(1000, { a: 0, b: 0, c: 0 })]));
    expect(result.unassignedCents).toBe(1000);
    expect(result.reconciles).toBe(true);
  });

  it('labels the share as the effective percentage', () => {
    const result = calculateSplit(bill(three, [percentItem(10000, { a: 50, b: 30, c: 20 })]));
    expect(result.perPerson[0].lines[0].shareLabel).toBe('50%');
    expect(result.perPerson[2].lines[0].shareLabel).toBe('20%');
  });

  it('labels the effective share, not the typed one, when percentages are off', () => {
    // 40/40/40 really means a third each.
    const result = calculateSplit(bill(three, [percentItem(9000, { a: 40, b: 40, c: 40 })]));
    expect(result.perPerson[0].lines[0].shareLabel).toBe('33.3%');
  });
});

describe('calculateSplit: amount splits', () => {
  const three = [person('a', 'Alex'), person('b', 'Bri'), person('c', 'Chidi')];

  function amountItem(priceCents: number, cents: Record<string, number>): Item {
    return {
      id: 'i1',
      name: 'Amount item',
      priceCents,
      splitMode: 'amount',
      assignments: Object.entries(cents).map(([personId, weight]) => ({ personId, weight })),
    };
  }

  it('charges each person exactly the amount entered when they add up', () => {
    const result = calculateSplit(bill(three, [amountItem(3000, { a: 1500, b: 1000, c: 500 })]));
    expect(result.perPerson.map((p) => p.subtotalCents)).toEqual([1500, 1000, 500]);
  });

  it('still allocates the whole item when the amounts fall short', () => {
    // $10 + $10 entered against a $30 plate.
    const result = calculateSplit(
      bill(three.slice(0, 2), [amountItem(3000, { a: 1000, b: 1000 })]),
    );
    expect(sum(result.perPerson.map((p) => p.subtotalCents))).toBe(3000);
    expect(result.reconciles).toBe(true);
  });

  it('reports how far an amount split is from covering the item', () => {
    expect(amountGapCents(amountItem(3000, { a: 1000, b: 1000 }))).toBe(1000);
    expect(amountGapCents(amountItem(3000, { a: 2000, b: 2000 }))).toBe(-1000);
    expect(amountGapCents(amountItem(3000, { a: 1500, b: 1500 }))).toBe(0);
  });

  it('knows when a split balances', () => {
    expect(splitIsBalanced(amountItem(3000, { a: 1500, b: 1500 }))).toBe(true);
    expect(splitIsBalanced(amountItem(3000, { a: 1000, b: 1000 }))).toBe(false);
    expect(splitIsBalanced(percentItem(3000, { a: 50, b: 50 }))).toBe(true);
    expect(splitIsBalanced(percentItem(3000, { a: 40, b: 40 }))).toBe(false);
    // Equal and shares have no target to miss.
    expect(splitIsBalanced(item('i1', 'Even', 3000, 'a', 'b'))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Payments and settling up                                            */
/* ------------------------------------------------------------------ */

describe('calculateSplit: payments', () => {
  const two = [person('a', 'Alex'), person('b', 'Bri')];
  const items = [item('i1', 'Steak', 4000, 'a'), item('i2', 'Pasta', 2000, 'b')];

  it('reports nobody as having paid when no payments are recorded', () => {
    const result = calculateSplit(bill(two, items));
    expect(result.paidCents).toBe(0);
    expect(result.unpaidCents).toBe(6000);
    expect(result.transfers).toEqual([]);
    expect(result.perPerson.every((p) => p.paidCents === 0)).toBe(true);
  });

  it('nets what a person paid against what they owe', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [{ personId: 'a', amountCents: 6000 }]),
    );

    expect(result.perPerson[0].paidCents).toBe(6000);
    expect(result.perPerson[0].netCents).toBe(2000); // paid 60, owed 40
    expect(result.perPerson[1].netCents).toBe(-2000);
    expect(result.unpaidCents).toBe(0);
  });

  it('produces the transfer that squares the table up', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [{ personId: 'a', amountCents: 6000 }]),
    );

    expect(result.transfers).toEqual([{ fromPersonId: 'b', toPersonId: 'a', amountCents: 2000 }]);
  });

  it('needs no transfers when everyone paid their own way', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [
        { personId: 'a', amountCents: 4000 },
        { personId: 'b', amountCents: 2000 },
      ]),
    );

    expect(result.transfers).toEqual([]);
    expect(result.unpaidCents).toBe(0);
  });

  it('reports a shortfall rather than absorbing it into someone else', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [{ personId: 'a', amountCents: 5000 }]),
    );

    expect(result.unpaidCents).toBe(1000);
    // Alex covered 10 of Bri's 20, so Bri owes Alex 10 and the restaurant 10.
    expect(sum(result.transfers.map((t) => t.amountCents))).toBe(1000);
  });

  it('reports an overpayment as a negative shortfall', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [{ personId: 'a', amountCents: 8000 }]),
    );
    expect(result.unpaidCents).toBe(-2000);
  });

  it('ignores payments from someone no longer on the bill', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [{ personId: 'ghost', amountCents: 9999 }]),
    );
    expect(result.paidCents).toBe(0);
    expect(result.unpaidCents).toBe(6000);
  });

  it('sums repeat payments from the same person', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [
        { personId: 'a', amountCents: 1000 },
        { personId: 'a', amountCents: 2500 },
      ]),
    );
    expect(result.perPerson[0].paidCents).toBe(3500);
  });

  it('nets to zero across everyone once the bill is covered', () => {
    const result = calculateSplit(
      bill(two, items, NO_CHARGES, [
        { personId: 'a', amountCents: 3000 },
        { personId: 'b', amountCents: 3000 },
      ]),
    );
    expect(sum(result.perPerson.map((p) => p.netCents))).toBe(0);
  });
});

// Trackr addition (Part 105): a share is rounded once for the whole bill, not
// item by item, so odd cents can't pile up on one person.
describe('calculateSplit: rounding once per bill (Trackr)', () => {
  const amount = (taxCents: number, tipCents = 0): Charges => ({
    ...NO_CHARGES, taxMode: 'amount', taxCents, tipMode: 'amount', tipCents,
  });

  it('two people sharing three odd-priced items are a cent apart, not three', () => {
    // You paid $49.05 for Priya and Nikhilesh: $24.525 each.
    const people = [person('me', 'You'), person('priya', 'Priya'), person('nik', 'Nikhilesh')];
    const items = [
      item('a', 'Dosa', 1999, 'priya', 'nik'),
      item('b', 'Biryani', 1503, 'priya', 'nik'),
      item('c', 'Chai', 1403, 'priya', 'nik'),
    ];
    const result = calculateSplit(bill(people, items, NO_CHARGES, [{ personId: 'me', amountCents: 4905 }]));
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([0, 2453, 2452]);
    expect(result.reconciles).toBe(true);
  });

  it('three ways with tax: the cent nobody can split goes to whoever paid first', () => {
    // $51.98 of food + $4.89 tax = $56.87 three ways, $18.9567 each; you paid.
    const people = [person('me', 'You'), person('m', 'Mrunaal'), person('p', 'Priya')];
    const result = calculateSplit(bill(people, [item('i', 'Dinner', 5198, 'me', 'm', 'p')], amount(489),
      [{ personId: 'me', amountCents: 5687 }]));
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([1896, 1896, 1895]);
    expect(result.perPerson.map((p) => p.taxCents)).toEqual([163, 163, 163]);
  });

  it('the payer takes the spare cent even when listed last', () => {
    const people = [person('a', 'Alex'), person('b', 'Bri')];
    const result = calculateSplit(bill(people, [item('i', 'Lunch', 1001, 'a', 'b')], NO_CHARGES,
      [{ personId: 'b', amountCents: 1001 }]));
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([500, 501]);
  });

  it('across many awkward bills: everyone within a cent of exact, equal shares within a cent', () => {
    let seed = 7;
    const rand = (n: number) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
    for (let run = 0; run < 400; run += 1) {
      const size = 2 + rand(5);
      const people = Array.from({ length: size }, (_, i) => person(`p${i}`, `P${i}`));
      const items = Array.from({ length: 1 + rand(8) }, (_, i) => {
        const owners = people.filter(() => rand(3) > 0).map((p) => p.id);
        return item(`i${i}`, 'Thing', 1 + rand(5000), ...(owners.length ? owners : [people[0].id]));
      });
      const tax = rand(900) - 150; // sometimes a discount
      const tip = rand(1200);
      const result = calculateSplit(bill(people, items, amount(tax, tip), [{ personId: 'p0', amountCents: 1 }]));
      expect(result.reconciles).toBe(true);

      const subtotal = sum(items.map((i) => i.priceCents));
      const exactSub = people.map((p) => sum(items.map((i) => {
        const owners = i.assignments.map((a) => a.personId);
        return owners.includes(p.id) ? i.priceCents / owners.length : 0;
      })));
      const exact = exactSub.map((s) => s + ((result.taxCents + result.tipCents) * s) / subtotal);
      result.perPerson.forEach((p, i) => expect(Math.abs(p.totalCents - exact[i])).toBeLessThan(1));

      // Anyone with the same exact share is within a cent of each other.
      for (let i = 0; i < size; i += 1) {
        for (let j = i + 1; j < size; j += 1) {
          if (Math.abs(exact[i] - exact[j]) < 1e-6) {
            expect(Math.abs(result.perPerson[i].totalCents - result.perPerson[j].totalCents)).toBeLessThanOrEqual(1);
          }
        }
      }
    }
  });
});

// Trackr addition (Part 110): who pays the odd cents can be chosen per bill,
// because Splitwise picks per bill and matching it means picking the same.
describe('calculateSplit: choosing who pays the odd cents (Trackr)', () => {
  // Taco Chapala: Nikhilesh paid $85.00 for six, $14.1666… each.
  const six = [person('nik', 'Nikhilesh'), person('lek', 'Lekhana'), person('sujai', 'Sujai'),
    person('me', 'You'), person('priya', 'Priya'), person('vyb', 'Vybhav')];
  const taco = (roundUpIds?: string[]): Bill => ({
    ...bill(six, [item('i', 'Tacos', 8500, ...six.map((p) => p.id))], NO_CHARGES, [{ personId: 'nik', amountCents: 8500 }]),
    roundUpIds,
  });

  it('by default the payer takes the first odd cent, then bill order', () => {
    const result = calculateSplit(taco());
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([1417, 1417, 1417, 1417, 1416, 1416]);
    expect(result.roundedUpIds).toEqual(['nik', 'lek', 'sujai', 'me']);
    expect(result.roundableIds).toEqual(six.map((p) => p.id));
  });

  it("the chosen people pay the extra cent, as Splitwise had it", () => {
    const result = calculateSplit(taco(['sujai', 'me', 'priya', 'vyb']));
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([1416, 1416, 1417, 1417, 1417, 1417]);
    expect(result.roundedUpIds).toEqual(['sujai', 'me', 'priya', 'vyb']);
    expect(result.reconciles).toBe(true);
  });

  it('picking fewer than the odd cents leaves the rest to the default', () => {
    const result = calculateSplit(taco(['vyb']));
    expect(result.roundedUpIds).toEqual(['nik', 'lek', 'sujai', 'vyb']);
  });

  it('picking more than the odd cents only uses as many as there are, in order', () => {
    const result = calculateSplit(taco(['vyb', 'priya', 'me', 'sujai', 'lek']));
    expect(result.roundedUpIds).toEqual(['sujai', 'me', 'priya', 'vyb']);
  });

  it('a share that is already whole never takes an extra cent', () => {
    // $10.00 two ways is $5.00 each: no odd cent to give, so the choice changes nothing.
    const people = [person('a', 'Alex'), person('b', 'Bri')];
    const lunch: Item = { id: 'i', name: 'Lunch', priceCents: 1000, splitMode: 'shares',
      assignments: [{ personId: 'a', weight: 1 }, { personId: 'b', weight: 1 }] };
    const result = calculateSplit({ ...bill(people, [lunch], NO_CHARGES, [{ personId: 'a', amountCents: 1000 }]), roundUpIds: ['b'] });
    expect(result.perPerson.map((p) => p.totalCents)).toEqual([500, 500]);
    expect(result.roundedUpIds).toEqual([]);
    expect(result.roundableIds).toEqual([]);
  });
});
