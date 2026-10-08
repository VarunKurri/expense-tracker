import { describe, it, expect } from 'vitest';
import { ME, MoneyBackEntry, TransactionSplit } from '../models';
import { outOfPocketCents, surplusCents } from './money-back';
import {
  ItemizedSplitState, QuickSplitState, assignUnclaimedTo, outstandingFor, setClosed, itemQuantity, itemUnitPriceCents, setItemQuantity, setItemUnitPrice, buildItemizedSplit, buildQuickSplit, emptyItemizedState,
  emptyQuickState, itemizedBillCents, itemizedStateFrom, myPaymentToCoverCents, newItem, owedToMeByPerson,
  quickAssignedCents, quickBillCents, quickSplit, quickStateFrom, removeFromItemized, restateWeights, setItemMode, setItemWeight,
  splitProblems, splitStatus, toggleAssignee,
} from './splits';

const repay = (amountCents: number, fromPersonId: string, coversPersonIds?: string[], date = '2026-10-01'): MoneyBackEntry =>
  ({ source: 'repayment', amountCents, date, fromPersonId, coversPersonIds });
const refund = (amountCents: number, date = '2026-10-01'): MoneyBackEntry =>
  ({ source: 'refund', amountCents, date });

const person = (status: ReturnType<typeof splitStatus>, id: string) =>
  status.people.find(p => p.personId === id)!;

describe('scenario 1: even split, you paid', () => {
  // $180 dinner, you + Alex + Ben, $60 each.
  const split = quickSplit(18000, [ME, 'alex', 'ben']);

  it('your share is a third; the rest is owed to you', () => {
    const s = splitStatus(split);
    expect(s.billTotalCents).toBe(18000);
    expect(s.myShareCents).toBe(6000);
    expect(s.myPaidCents).toBe(18000);
    expect(s.owedToMeCents).toBe(12000);
    expect(person(s, 'alex')).toMatchObject({ dueToMeCents: 6000, outstandingCents: 6000, state: 'owed' });
  });

  it('you are out of pocket the full amount until repaid', () => {
    expect(outOfPocketCents(18000, [])).toBe(18000);
  });

  it('one repayment moves that person to repaid, and out of pocket drops', () => {
    const back = [repay(6000, 'alex')];
    const s = splitStatus(split, back);
    expect(person(s, 'alex').state).toBe('repaid');
    expect(person(s, 'ben').state).toBe('owed');
    expect(s.owedToMeCents).toBe(6000);
    expect(outOfPocketCents(18000, back)).toBe(12000);
  });

  it('a part repayment is partial', () => {
    const s = splitStatus(split, [repay(2500, 'ben')]);
    expect(person(s, 'ben')).toMatchObject({ repaidCents: 2500, outstandingCents: 3500, state: 'partial' });
  });

  it('splits a bill that does not divide evenly without losing a cent', () => {
    const s = splitStatus(quickSplit(10000, [ME, 'alex', 'ben']));
    expect(s.myShareCents + s.people.reduce((t, p) => t + p.shareCents, 0)).toBe(10000);
    expect(s.owedToMeCents).toBe(10000 - s.myShareCents);
  });
});

describe('scenario 2: partly paid — you paid $180 of a $240 bill, Alex paid $60', () => {
  const split: TransactionSplit = {
    ...quickSplit(24000, [ME, 'alex', 'ben', 'cara']),
    payments: [{ personId: ME, amountCents: 18000 }, { personId: 'alex', amountCents: 6000 }],
  };

  it('Alex paid his own way; Ben and Cara owe you', () => {
    const s = splitStatus(split);
    expect(s.myShareCents).toBe(6000);
    expect(s.myPaidCents).toBe(18000);
    expect(person(s, 'alex')).toMatchObject({ paidCents: 6000, dueToMeCents: 0, state: 'none' });
    expect(person(s, 'ben').dueToMeCents).toBe(6000);
    expect(person(s, 'cara').dueToMeCents).toBe(6000);
    expect(s.owedToMeCents).toBe(12000);
  });

  it('is valid when your payment equals the transaction amount', () => {
    expect(splitProblems(split, 18000)).toEqual([]);
    expect(splitProblems(split, 24000)).toEqual(['my-payment-mismatch']);
  });
});

describe('scenario 3: paid for others, no share yourself', () => {
  // Your original example: "I paid $180 and three friends owe $60 each".
  const split = quickSplit(18000, ['alex', 'ben', 'cara']);

  it('your share is zero and everything is owed to you', () => {
    const s = splitStatus(split);
    expect(s.myShareCents).toBe(0);
    expect(s.myPaidCents).toBe(18000);
    expect(s.people.map(p => p.dueToMeCents)).toEqual([6000, 6000, 6000]);
    expect(s.owedToMeCents).toBe(18000);
    expect(splitProblems(split, 18000)).toEqual([]);
  });
});

describe('scenario 4: one friend repays for several', () => {
  const split = quickSplit(24000, [ME, 'alex', 'ben', 'cara']);

  it('Alex sending $180 for Alex, Ben and Cara settles all three', () => {
    const s = splitStatus(split, [repay(18000, 'alex', ['alex', 'ben', 'cara'])]);
    expect(s.people.map(p => p.state)).toEqual(['repaid', 'repaid', 'repaid']);
    expect(s.owedToMeCents).toBe(0);
    expect(s.unappliedRepaymentCents).toBe(0);
    // Credited to the people it covered, not to Alex alone.
    expect(person(s, 'ben').repaidCents).toBe(6000);
  });

  it('pays off covered people in the order listed when it falls short', () => {
    const s = splitStatus(split, [repay(9000, 'alex', ['alex', 'ben', 'cara'])]);
    expect(person(s, 'alex').state).toBe('repaid');
    expect(person(s, 'ben')).toMatchObject({ repaidCents: 3000, state: 'partial' });
    expect(person(s, 'cara').state).toBe('owed');
  });

  it('applies repayments oldest first', () => {
    const s = splitStatus(split, [
      repay(6000, 'ben', ['ben', 'cara'], '2026-10-05'),
      repay(6000, 'alex', ['ben'], '2026-10-02'),
    ]);
    // Alex's earlier payment cleared Ben, so Ben's later one went to Cara.
    expect(person(s, 'ben').state).toBe('repaid');
    expect(person(s, 'cara').state).toBe('repaid');
    expect(person(s, 'alex').state).toBe('owed');
  });

  it('a repayment naming nobody pays off whoever still owes', () => {
    const s = splitStatus(split, [{ source: 'repayment', amountCents: 9000, date: '2026-10-01' }]);
    expect(s.owedToMeCents).toBe(9000);
  });
});

describe('scenario 5: a friend covers everyone, including you', () => {
  const split = quickSplit(24000, [ME, 'alex', 'ben', 'cara']);

  it('the extra beyond what others owed covers your share: out of pocket $0', () => {
    const back = [repay(24000, 'alex', ['alex', 'ben', 'cara', ME])];
    const s = splitStatus(split, back);
    expect(s.owedToMeCents).toBe(0);
    expect(s.unappliedRepaymentCents).toBe(6000);
    expect(outOfPocketCents(24000, back)).toBe(0);
    expect(surplusCents(24000, back)).toBe(0);
  });

  it('anything beyond the whole bill is surplus', () => {
    const back = [repay(25000, 'alex', ['alex', 'ben', 'cara', ME])];
    expect(surplusCents(24000, back)).toBe(1000);
  });
});

describe('scenario 6: never repaid', () => {
  const split: TransactionSplit = { ...quickSplit(18000, [ME, 'alex', 'ben']), closedPersonIds: ['ben'] };

  it('"won\'t be repaid" leaves "owed to you" but not your spending', () => {
    const s = splitStatus(split);
    expect(person(s, 'ben')).toMatchObject({ outstandingCents: 6000, state: 'closed' });
    expect(s.owedToMeCents).toBe(6000); // Alex only
    expect(outOfPocketCents(18000, [])).toBe(18000);
  });

  it('a person closed after paying in full still reads as repaid', () => {
    const s = splitStatus(split, [repay(6000, 'ben')]);
    expect(person(s, 'ben').state).toBe('repaid');
  });
});

describe('scenario 7: itemized with tax and tip', () => {
  // Alex had a $10 salad, you had a $30 steak, you shared a $20 bottle.
  const split: TransactionSplit = {
    mode: 'itemized',
    participantIds: [ME, 'alex'],
    items: [
      { id: 'salad', name: 'Salad', priceCents: 1000, splitMode: 'equal', assignments: [{ personId: 'alex', weight: 1 }] },
      { id: 'steak', name: 'Steak', priceCents: 3000, splitMode: 'equal', assignments: [{ personId: ME, weight: 1 }] },
      { id: 'wine', name: 'Wine', priceCents: 2000, splitMode: 'equal', assignments: [{ personId: ME, weight: 1 }, { personId: 'alex', weight: 1 }] },
    ],
    charges: { taxMode: 'percent', taxPercent: 8.875, taxCents: 0, tipMode: 'percent', tipPercent: 20, tipCents: 0, tipBasis: 'preTax' },
    payments: [],
    source: 'receipt',
  };

  it('tax and tip follow what each person had, and it reconciles to the cent', () => {
    const total = splitStatus({ ...split, payments: [{ personId: ME, amountCents: 1 }] }).billTotalCents;
    const s = splitStatus({ ...split, payments: [{ personId: ME, amountCents: total }] });
    // Subtotals: you $40, Alex $20 → you carry two thirds of tax and tip.
    const alex = s.summary.perPerson.find(p => p.personId === 'alex')!;
    const me = s.summary.perPerson.find(p => p.personId === ME)!;
    expect(me.subtotalCents).toBe(4000);
    expect(alex.subtotalCents).toBe(2000);
    expect(me.tipCents).toBe(800);
    expect(alex.tipCents).toBe(400);
    expect(s.summary.reconciles).toBe(true);
    expect(s.myShareCents + person(s, 'alex').shareCents).toBe(s.billTotalCents);
    expect(s.owedToMeCents).toBe(alex.totalCents);
  });

  it('refuses to save while an item belongs to nobody', () => {
    const unclaimed = { ...split, items: [...split.items, { id: 'dessert', name: 'Dessert', priceCents: 900, splitMode: 'equal' as const, assignments: [] }] };
    expect(splitProblems(unclaimed, 0)).toContain('unassigned');
  });
});

describe('scenario 8: refund on a split bill', () => {
  const split = quickSplit(24000, [ME, 'alex', 'ben', 'cara']);

  it('a $40 refund on $240 four ways makes every share $50', () => {
    const s = splitStatus(split, [refund(4000)]);
    expect(s.refundedCents).toBe(4000);
    expect(s.myShareCents).toBe(5000);
    expect(s.people.map(p => p.shareCents)).toEqual([5000, 5000, 5000]);
    expect(s.owedToMeCents).toBe(15000);
  });

  it('shares stay exact when the refund does not divide evenly', () => {
    const s = splitStatus(quickSplit(10000, [ME, 'alex', 'ben']), [refund(1000)]);
    expect(s.myShareCents + s.people.reduce((t, p) => t + p.shareCents, 0)).toBe(9000);
  });

  it('a refund larger than the bill is capped at the bill', () => {
    const s = splitStatus(split, [refund(30000)]);
    expect(s.refundedCents).toBe(24000);
    expect(s.owedToMeCents).toBe(0);
  });

  it('refund and repayments together', () => {
    const s = splitStatus(split, [refund(4000), repay(5000, 'alex')]);
    expect(person(s, 'alex').state).toBe('repaid');
    expect(s.owedToMeCents).toBe(10000);
  });
});

describe('owedToMeByPerson', () => {
  it('adds up across bills and skips closed balances', () => {
    const totals = owedToMeByPerson([
      { split: quickSplit(18000, [ME, 'alex', 'ben']), moneyBack: [] },
      { split: quickSplit(4000, [ME, 'alex']), moneyBack: [] },
      { split: { ...quickSplit(9000, [ME, 'ben', 'cara']), closedPersonIds: ['ben'] }, moneyBack: [repay(3000, 'cara')] },
    ]);
    expect(totals.get('alex')).toBe(6000 + 2000);
    expect(totals.get('ben')).toBe(6000);
    expect(totals.has('cara')).toBe(false);
  });
});

describe('splitProblems', () => {
  it('needs someone other than you', () => {
    expect(splitProblems(quickSplit(1000, [ME]), 1000)).toContain('no-one-else');
  });

  it('flags payments that do not cover the bill', () => {
    const short = { ...quickSplit(1000, [ME, 'alex']), payments: [{ personId: ME, amountCents: 800 }] };
    expect(splitProblems(short, 800)).toEqual(['not-covered']);
  });
});

describe('quick split editing', () => {
  const four = (over: Partial<QuickSplitState> = {}): QuickSplitState =>
    ({ ...emptyQuickState(), participantIds: [ME, 'alex', 'ben', 'cara'], ...over });

  it('starts with just you, equally', () => {
    expect(emptyQuickState()).toEqual({ participantIds: [ME], mode: 'equal', weights: {}, otherPayments: [] });
  });

  it('builds an equal split you paid in full, ready to save', () => {
    const split = buildQuickSplit(four(), 24000);
    expect(split.mode).toBe('quick');
    expect(split.payments).toEqual([{ personId: ME, amountCents: 24000 }]);
    expect(splitProblems(split, 24000)).toEqual([]);
    expect(splitStatus(split).owedToMeCents).toBe(18000);
  });

  it('others who paid part of it make the bill bigger than your transaction (scenario 2)', () => {
    const state = four({ otherPayments: [{ personId: 'alex', amountCents: 6000 }] });
    expect(quickBillCents(state, 18000)).toBe(24000);
    const split = buildQuickSplit(state, 18000);
    expect(splitProblems(split, 18000)).toEqual([]);
    const s = splitStatus(split);
    expect(s.myShareCents).toBe(6000);
    expect(s.owedToMeCents).toBe(12000);
  });

  it('ignores empty payer rows', () => {
    const split = buildQuickSplit(four({ otherPayments: [{ personId: 'alex', amountCents: 0 }] }), 24000);
    expect(split.payments).toHaveLength(1);
  });

  it('uses the amount at save time, so editing it never leaves the split stale', () => {
    const state = four();
    expect(splitStatus(buildQuickSplit(state, 24000)).myShareCents).toBe(6000);
    expect(splitStatus(buildQuickSplit(state, 20000)).myShareCents).toBe(5000);
  });

  it('round-trips through a saved split, keeping "won\'t be repaid"', () => {
    const state = four({ mode: 'shares', weights: { [ME]: 2, alex: 1, ben: 1, cara: 0 }, otherPayments: [{ personId: 'ben', amountCents: 1000 }] });
    const saved = { ...buildQuickSplit(state, 24000), closedPersonIds: ['cara'] };
    expect(quickStateFrom(saved)).toEqual(state);
    expect(buildQuickSplit(quickStateFrom(saved), 24000, saved).closedPersonIds).toEqual(['cara']);
  });

  it('flags nobody to split with, and nobody having a share', () => {
    expect(splitProblems(buildQuickSplit(emptyQuickState(), 1000), 1000)).toEqual(['no-one-else']);
    const zero = four({ mode: 'shares', weights: {} });
    expect(splitProblems(buildQuickSplit(zero, 1000), 1000)).toContain('unassigned');
  });
});

describe('restateWeights: switching mode keeps the split', () => {
  const two = (mode: QuickSplitState['mode'], weights: Record<string, number> = {}): QuickSplitState =>
    ({ participantIds: [ME, 'alex'], mode, weights, otherPayments: [] });

  it('equal → shares is one each; → percent is 50/50; → amount is the cents', () => {
    expect(restateWeights(two('equal'), 'shares', 12000)).toEqual({ [ME]: 1, alex: 1 });
    expect(restateWeights(two('equal'), 'percent', 12000)).toEqual({ [ME]: 50, alex: 50 });
    expect(restateWeights(two('equal'), 'amount', 12000)).toEqual({ [ME]: 6000, alex: 6000 });
  });

  it('$80 / $40 restates as 2 : 1 and 66.67% / 33.33%', () => {
    const amounts = two('amount', { [ME]: 8000, alex: 4000 });
    expect(restateWeights(amounts, 'shares', 12000)).toEqual({ [ME]: 2, alex: 1 });
    expect(restateWeights(amounts, 'percent', 12000)).toEqual({ [ME]: 66.67, alex: 33.33 });
  });

  it('percentages always add to exactly 100', () => {
    const three: QuickSplitState = { participantIds: [ME, 'alex', 'ben'], mode: 'equal', weights: {}, otherPayments: [] };
    const pct = restateWeights(three, 'percent', 10000);
    expect(Object.values(pct).reduce((a, b) => a + b, 0)).toBeCloseTo(100, 10);
  });

  it('messy amounts start shares even rather than as giant ratios', () => {
    const messy = two('amount', { [ME]: 3334, alex: 3333 });
    expect(restateWeights(messy, 'shares', 6667)).toEqual({ [ME]: 1, alex: 1 });
  });

  it('the money split is unchanged by switching (amount → percent → amount)', () => {
    const amounts = two('amount', { [ME]: 8000, alex: 4000 });
    const pct = { ...amounts, mode: 'percent' as const, weights: restateWeights(amounts, 'percent', 12000) };
    const back = restateWeights(pct, 'amount', 12000);
    expect(back).toEqual({ [ME]: 8000, alex: 4000 });
  });
});

describe('itemized split editing', () => {
  // You had the $30 steak, Alex the $10 salad, you shared the $20 wine. 8.875% tax, 20% tip on the pre-tax total.
  const dinner = (): ItemizedSplitState => ({
    participantIds: [ME, 'alex'],
    items: [
      newItem([ME], 'Steak', 3000),
      newItem(['alex'], 'Salad', 1000),
      newItem([ME, 'alex'], 'Wine', 2000),
    ],
    charges: { taxMode: 'percent', taxPercent: 8.875, taxCents: 0, tipMode: 'percent', tipPercent: 20, tipCents: 0, tipBasis: 'preTax' },
    otherPayments: [],
  });

  it('the bill is items + tax + tip, as the engine adds them up', () => {
    // $60 + $5.33 tax (8.875% of $60, rounded) + $12 tip
    expect(itemizedBillCents(dinner())).toBe(6000 + 533 + 1200);
  });

  it('builds a split that saves once your payment covers the bill', () => {
    const state = dinner();
    const total = itemizedBillCents(state);
    const split = buildItemizedSplit(state, total);
    expect(split.mode).toBe('itemized');
    expect(splitProblems(split, total)).toEqual([]);
    expect(splitProblems(buildItemizedSplit(state, 6000), 6000)).toEqual(['not-covered']);
    // Alex: $10 salad + $10 wine = $20 of $60 → a third of tax and tip.
    expect(splitStatus(split).owedToMeCents).toBe(2000 + 178 + 400);
  });

  it('what you need to have paid, when others paid some', () => {
    const state = { ...dinner(), otherPayments: [{ personId: 'alex', amountCents: 2000 }] };
    expect(myPaymentToCoverCents(state)).toBe(itemizedBillCents(state) - 2000);
  });

  it('empty rows are not part of the bill; unnamed priced rows are kept', () => {
    const state = { ...dinner(), items: [...dinner().items, newItem(), newItem([ME], '', 500)] };
    const split = buildItemizedSplit(state, 0);
    expect(split.items).toHaveLength(4);
    expect(split.items[3].name).toBe('Item');
  });

  it('round-trips through a saved split', () => {
    const state = { ...dinner(), otherPayments: [{ personId: 'alex', amountCents: 1500 }] };
    expect(itemizedStateFrom(buildItemizedSplit(state, 6000))).toEqual(state);
  });

  it('starting to itemize keeps who is on the bill and who paid', () => {
    const quick: QuickSplitState = { ...emptyQuickState(), participantIds: [ME, 'alex'], otherPayments: [{ personId: 'alex', amountCents: 500 }] };
    const state = emptyItemizedState(quick);
    expect(state.participantIds).toEqual([ME, 'alex']);
    expect(state.otherPayments).toEqual([{ personId: 'alex', amountCents: 500 }]);
    expect(state.items).toHaveLength(1);
  });

  it('flags unclaimed items, and "the rest is mine" claims them', () => {
    const state = { ...dinner(), items: [...dinner().items, newItem([], 'Dessert', 900)] };
    const total = itemizedBillCents(state);
    expect(splitProblems(buildItemizedSplit(state, total), total)).toContain('unassigned');
    const mine = assignUnclaimedTo(state, ME);
    expect(splitProblems(buildItemizedSplit(mine, total), total)).toEqual([]);
    expect(mine.items[3].assignments).toEqual([{ personId: ME, weight: 1 }]);
    // Items someone already had are left alone.
    expect(mine.items[1].assignments).toEqual([{ personId: 'alex', weight: 1 }]);
  });

  it('removing someone drops their claims and payment', () => {
    const state = removeFromItemized({ ...dinner(), otherPayments: [{ personId: 'alex', amountCents: 100 }] }, 'alex');
    expect(state.participantIds).toEqual([ME]);
    expect(state.items[2].assignments).toEqual([{ personId: ME, weight: 1 }]);
    expect(state.otherPayments).toEqual([]);
  });

  it('tapping people on and off an item', () => {
    const item = newItem([ME], 'Wine', 2000);
    const both = toggleAssignee(item, 'alex');
    expect(both.assignments.map(a => a.personId)).toEqual([ME, 'alex']);
    expect(toggleAssignee(both, ME).assignments.map(a => a.personId)).toEqual(['alex']);
  });

  it('an item restates when its mode changes: "Alex had two thirds" stays two thirds', () => {
    const wine = setItemWeight(setItemWeight(setItemMode(newItem([ME, 'alex'], 'Wine', 3000), 'shares', [ME, 'alex']), ME, 1), 'alex', 2);
    expect(setItemMode(wine, 'amount', [ME, 'alex']).assignments).toEqual([{ personId: ME, weight: 1000 }, { personId: 'alex', weight: 2000 }]);
    expect(setItemMode(wine, 'percent', [ME, 'alex']).assignments).toEqual([{ personId: ME, weight: 33.33 }, { personId: 'alex', weight: 66.67 }]);
    // Back to equal: whoever had a part is on it, equally.
    expect(setItemMode(wine, 'equal', [ME, 'alex']).assignments).toEqual([{ personId: ME, weight: 1 }, { personId: 'alex', weight: 1 }]);
  });

  it('an item only some people had restates with the others at zero', () => {
    const salad = setItemMode(newItem(['alex'], 'Salad', 1000), 'amount', [ME, 'alex']);
    expect(salad.assignments).toEqual([{ personId: ME, weight: 0 }, { personId: 'alex', weight: 1000 }]);
  });

  it('editing a weight keeps the order (the engine breaks cent ties by position)', () => {
    const item = setItemMode(newItem([ME, 'alex', 'ben'], 'Pizza', 1000), 'shares', [ME, 'alex', 'ben']);
    expect(setItemWeight(item, ME, 3).assignments.map(a => a.personId)).toEqual([ME, 'alex', 'ben']);
  });
});

describe('quickAssignedCents: the "left to assign" line', () => {
  const base: QuickSplitState = { participantIds: [ME, 'alex'], mode: 'equal', weights: {}, otherPayments: [] };
  it('equal and shares always cover the bill', () => {
    expect(quickAssignedCents(base, 1292)).toBe(1292);
    expect(quickAssignedCents({ ...base, mode: 'shares', weights: { [ME]: 2, alex: 1 } }, 1292)).toBe(1292);
  });
  it('amounts are what is typed; percentages are that share of the bill', () => {
    expect(quickAssignedCents({ ...base, mode: 'amount', weights: { [ME]: 500, alex: 300 } }, 1292)).toBe(800);
    expect(quickAssignedCents({ ...base, mode: 'percent', weights: { [ME]: 50, alex: 30 } }, 1000)).toBe(800);
  });
});

describe('item quantity', () => {
  it('a new item can be several of the same thing: the line total is price × quantity', () => {
    const mandi = newItem([ME], 'Mandi', 2599, 2);
    expect(mandi.priceCents).toBe(5198);
    expect(itemQuantity(mandi)).toBe(2);
    expect(itemUnitPriceCents(mandi)).toBe(2599);
  });

  it('a single item stores no quantity at all, so old splits read the same', () => {
    const one = newItem([ME], 'Lassi', 450);
    expect(one).not.toHaveProperty('quantity');
    expect(itemQuantity(one)).toBe(1);
  });

  it('changing the quantity keeps the price each; the total follows', () => {
    const mandi = setItemQuantity(newItem([ME], 'Mandi', 2599), 3);
    expect(mandi.priceCents).toBe(7797);
    expect(setItemQuantity(mandi, 1)).not.toHaveProperty('quantity');
    expect(setItemQuantity(mandi, 1).priceCents).toBe(2599);
  });

  it('changing the price each keeps the quantity', () => {
    expect(setItemUnitPrice(newItem([ME], 'Mandi', 2599, 2), 2400).priceCents).toBe(4800);
  });

  it('nonsense quantities become 1', () => {
    const item = newItem([ME], 'Naan', 300);
    expect(itemQuantity(setItemQuantity(item, 0))).toBe(1);
    expect(itemQuantity(setItemQuantity(item, NaN))).toBe(1);
    expect(itemQuantity(setItemQuantity(item, 2.7))).toBe(2);
  });

  it('the engine shares the line total; three people, two mandis', () => {
    const state: ItemizedSplitState = { ...emptyItemizedState(), participantIds: [ME, 'm', 'p'], items: [newItem([ME, 'm', 'p'], 'Mandi', 2599, 2)] };
    const split = buildItemizedSplit(state, 5198);
    expect(splitProblems(split, 5198)).toEqual([]);
    const s = splitStatus(split);
    expect(s.myShareCents + s.people.reduce((t, p) => t + p.shareCents, 0)).toBe(5198);
    expect(split.items[0]).toMatchObject({ quantity: 2, unitPriceCents: 2599, priceCents: 5198 });
  });
});

describe('repaying from the transaction view', () => {
  const split = quickSplit(24000, [ME, 'alex', 'ben', 'cara']);

  it('what clears the people a repayment covers', () => {
    const s = splitStatus(split, [repay(2000, 'ben')]);
    expect(outstandingFor(s, ['alex'])).toBe(6000);
    expect(outstandingFor(s, ['alex', 'ben', 'cara'])).toBe(6000 + 4000 + 6000);
  });

  it('a closed balance is not suggested', () => {
    const s = splitStatus(setClosed(split, 'cara', true));
    expect(outstandingFor(s, ['alex', 'cara'])).toBe(6000);
  });

  it('closing and reopening', () => {
    const closed = setClosed(split, 'cara', true);
    expect(closed.closedPersonIds).toEqual(['cara']);
    expect(setClosed(closed, 'cara', true).closedPersonIds).toEqual(['cara']);
    expect(setClosed(closed, 'cara', false).closedPersonIds).toEqual([]);
  });
});
