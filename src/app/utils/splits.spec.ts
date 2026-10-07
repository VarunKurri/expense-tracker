import { describe, it, expect } from 'vitest';
import { ME, MoneyBackEntry, TransactionSplit } from '../models';
import { outOfPocketCents, surplusCents } from './money-back';
import { owedToMeByPerson, quickSplit, splitProblems, splitStatus } from './splits';

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
