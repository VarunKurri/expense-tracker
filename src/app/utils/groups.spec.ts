import { describe, it, expect } from 'vitest';
import { Group, ME, MoneyBackEntry, SharedBill, Transaction, TransactionSplit } from '../models';
import { MoneyBackLedger } from './money-back';
import { fromCents } from './money';
import { sum } from './split/money';
import { groupLedger, myPlan, spreadReceived } from './groups';
import { quickSplit, splitStatus } from './splits';

class Ledger extends MoneyBackLedger {
  constructor(public transactions: () => Transaction[]) { super(); }
}

const TRIP = 'tahoe';
const group = (over: Partial<Group> = {}): Group & { id: string } => ({
  id: TRIP, name: 'Tahoe Trip', memberIds: ['alex', 'ben', 'cara'], simplify: true, payments: [],
  createdAt: 1, updatedAt: 1, ...over,
});

let n = 0;
const expense = (amountCents: number, over: Partial<Transaction> = {}): Transaction => ({
  id: `t${++n}`, type: 'expense', amount: fromCents(amountCents), date: '2026-09-12', accountId: 'chk',
  merchant: 'Somewhere', createdAt: n, updatedAt: n, ...over,
} as Transaction);

const inGroup = (split: TransactionSplit): TransactionSplit => ({ ...split, groupId: TRIP });

/** A bill a friend paid, split with `quickSplit`'s modes. */
const theirs = (payer: string, cents: number, people: string[], date = '2026-09-12',
                mode: 'equal' | 'shares' = 'equal', weights: number[] = []): SharedBill => ({
  id: `b${++n}`, date, merchant: `${payer}'s bill`, createdAt: n, updatedAt: n,
  split: { ...inGroup(quickSplit(cents, people, mode, weights)), payments: [{ personId: payer, amountCents: cents }] },
});

/**
 * The Tahoe trip: different people paying, different people on each bill.
 *  - Food  $120, you paid, all four share it.
 *  - Gas   $80, Alex paid, Cara wasn't in the car.
 *  - Tents $200, Ben paid, all four.
 *  - Utilities $45, Cara paid, you had two shares and Cara one.
 */
function tahoe() {
  const food = expense(12000, { merchant: 'Safeway', split: inGroup(quickSplit(12000, [ME, 'alex', 'ben', 'cara'])) });
  const gas = theirs('alex', 8000, [ME, 'alex', 'ben']);
  const tents = theirs('ben', 20000, [ME, 'alex', 'ben', 'cara']);
  const utilities = theirs('cara', 4500, [ME, 'cara'], '2026-09-13', 'shares', [2, 1]);
  return { food, shared: [gas, tents, utilities] };
}

function ledgerFor(txs: Transaction[], shared: SharedBill[], g = group()) {
  const money = new Ledger(() => txs);
  return { ledger: groupLedger(g, txs, shared, t => money.moneyBackEntriesFor(t)), money };
}

/** What you're out of pocket across the group's expenses: what Analysis counts. */
const spendingCents = (txs: Transaction[]) => {
  const money = new Ledger(() => txs);
  return sum(txs.filter(t => t.type === 'expense').map(t => Math.round(money.effectiveExpenseAmount(t) * 100)));
};

const balanceOf = (l: ReturnType<typeof groupLedger>, id: string) => l.balances.find(b => b.personId === id)!.netCents;

describe('groupLedger: where everyone stands', () => {
  it('works out the trip from every bill, whoever paid it', () => {
    const { food, shared } = tahoe();
    const { ledger } = ledgerFor([food], shared);
    expect(ledger.bills.map(b => b.kind).sort()).toEqual(['mine', 'theirs', 'theirs', 'theirs']);
    expect(ledger.totalCents).toBe(12000 + 8000 + 20000 + 4500);
    // Your shares: 30.00 food, a third of the gas, 50.00 tents, 30.00 utilities.
    const gasShare = ledger.bills.find(b => b.merchant === "alex's bill")!.myShareCents;
    expect([2666, 2667]).toContain(gasShare);
    expect(ledger.myShareCents).toBe(3000 + gasShare + 5000 + 3000);
    // You paid 120.00 of it.
    expect(ledger.myBalanceCents).toBe(12000 - ledger.myShareCents);
    expect(sum(ledger.balances.map(b => b.netCents))).toBe(0);
  });

  it('simplify debts: the fewest payments, and they clear everyone', () => {
    const { food, shared } = tahoe();
    const { ledger } = ledgerFor([food], shared);
    // Ben is owed; Cara, Alex and you owe. Three people owing one: three payments.
    expect(ledger.plan.length).toBeLessThanOrEqual(3);
    expect(ledger.plan.every(t => t.toPersonId === 'ben')).toBe(true);
    const after = new Map(ledger.balances.map(b => [b.personId, b.netCents]));
    for (const t of ledger.plan) {
      after.set(t.fromPersonId, after.get(t.fromPersonId)! + t.amountCents);
      after.set(t.toPersonId, after.get(t.toPersonId)! - t.amountCents);
    }
    expect([...after.values()].every(v => v === 0)).toBe(true);
    expect(myPlan(ledger).to).toEqual([{ fromPersonId: ME, toPersonId: 'ben', amountCents: -ledger.myBalanceCents }]);
  });

  it("without simplifying: everyone pays back whoever paid, two people's debts netted", () => {
    const { food, shared } = tahoe();
    const { ledger } = ledgerFor([food], shared, group({ simplify: false }));
    const mine = myPlan(ledger);
    // Alex owes you 30.00 for food; you owe Alex your third of the gas.
    const gasShare = ledger.bills.find(b => b.merchant === "alex's bill")!.myShareCents;
    expect(mine.from).toEqual([{ fromPersonId: 'alex', toPersonId: ME, amountCents: 3000 - gasShare }]);
    // Ben: you owe 50.00 for tents, he owes you 30.00 for food.
    expect(mine.to).toContainEqual({ fromPersonId: ME, toPersonId: 'ben', amountCents: 2000 });
    // Cara: 30.00 each way, so nothing between you.
    expect(ledger.plan.some(t => [t.fromPersonId, t.toPersonId].includes('cara') && [t.fromPersonId, t.toPersonId].includes(ME))).toBe(false);
    // However it's paid, your balance is the same.
    expect(sum(mine.from.map(t => t.amountCents)) - sum(mine.to.map(t => t.amountCents))).toBe(ledger.myBalanceCents);
  });
});

describe('settling up: once everyone is square, your spending is exactly your shares', () => {
  it('simplified: you pay Ben, Alex and Cara pay Ben, and everyone is at zero', () => {
    const { food, shared } = tahoe();
    const before = ledgerFor([food], shared).ledger;
    const owe = -before.myBalanceCents;

    // Your Venmo to Ben, linked as a settle-up payment.
    const toBen = expense(owe, { merchant: 'Venmo', settlement: { personId: 'ben', groupId: TRIP } });
    const g = group({
      payments: before.plan.filter(t => t.fromPersonId !== ME).map((t, i) => ({
        id: `p${i}`, fromPersonId: t.fromPersonId, toPersonId: t.toPersonId, amountCents: t.amountCents, date: '2026-09-20',
      })),
    });
    const txs = [food, toBen];
    const { ledger } = ledgerFor(txs, shared, g);

    expect(ledger.balances.every(b => b.netCents === 0)).toBe(true);
    expect(ledger.plan).toEqual([]);
    // Analysis counts the food you paid plus what you sent Ben: your four shares.
    expect(spendingCents(txs)).toBe(ledger.myShareCents);
  });

  it('not simplified: Alex pays you back (a linked income), you pay Ben', () => {
    const { food, shared } = tahoe();
    const g = group({ simplify: false });
    const first = ledgerFor([food], shared, g).ledger;
    const fromAlex = myPlan(first).from[0].amountCents;
    const toBen = myPlan(first).to.find(t => t.toPersonId === 'ben')!.amountCents;

    // The income from Alex goes on your group bills as money back.
    const links = spreadReceived(TRIP, [food], t => new Ledger(() => [food]).moneyBackEntriesFor(t), fromAlex);
    expect(links).toEqual([{ expenseId: food.id, amountCents: fromAlex }]);
    const income = {
      id: 'inc', type: 'income', amount: fromCents(fromAlex), date: '2026-09-20', accountId: 'chk', merchant: 'Venmo from Alex',
      moneyBackSplits: links, moneyBackInfo: { source: 'repayment', fromPersonId: 'alex' }, createdAt: 50, updatedAt: 50,
    } as Transaction;
    const paidBen = expense(toBen, { settlement: { personId: 'ben', groupId: TRIP } });
    const txs = [food, income, paidBen];
    const { ledger } = ledgerFor(txs, shared, g);

    expect(balanceOf(ledger, ME)).toBe(0);
    expect(myPlan(ledger)).toEqual({ from: [], to: [] });
    expect(ledger.moves.find(m => m.kind === 'received')).toMatchObject({ fromPersonId: 'alex', amountCents: fromAlex });
    expect(spendingCents(txs)).toBe(ledger.myShareCents);
  });

  it('Alex pays Ben for you (simplify routed it): settled with you, spending unchanged', () => {
    // Alex owes you 30.00 on food; you owe Ben 30.00 on a dinner he paid.
    const food = expense(6000, { split: inGroup(quickSplit(6000, [ME, 'alex'])) });
    const dinner = theirs('ben', 6000, [ME, 'ben']);
    const g = group({ memberIds: ['alex', 'ben'] });
    const before = ledgerFor([food], [dinner], g).ledger;
    expect(before.plan).toEqual([{ fromPersonId: 'alex', toPersonId: 'ben', amountCents: 3000 }]);

    const settled = { ...g, payments: [{ id: 'p', fromPersonId: 'alex', toPersonId: 'ben', amountCents: 3000, date: '2026-09-20' }] };
    const { ledger } = ledgerFor([food], [dinner], settled);
    expect(ledger.balances.every(b => b.netCents === 0)).toBe(true);
    // No money reached or left you, so you're out of pocket the food you paid,
    // which is your 30.00 share of it plus the 30.00 you owed Ben.
    expect(spendingCents([food])).toBe(ledger.myShareCents);
  });

  it('overpaying flips the balance rather than losing it', () => {
    const dinner = theirs('ben', 6000, [ME, 'ben']);
    const tooMuch = expense(4000, { settlement: { personId: 'ben', groupId: TRIP } });
    const { ledger } = ledgerFor([tooMuch], [dinner], group({ memberIds: ['ben'] }));
    expect(ledger.myBalanceCents).toBe(1000);
    expect(ledger.plan).toEqual([{ fromPersonId: 'ben', toPersonId: ME, amountCents: 1000 }]);
    // When Ben sends the 10.00 back, it goes on your payment to him.
    expect(spreadReceived(TRIP, [tooMuch], () => [], 1000)).toEqual([{ expenseId: tooMuch.id, amountCents: 1000 }]);
  });

  it('deleting a settle-up payment reopens what it paid', () => {
    const dinner = theirs('ben', 6000, [ME, 'ben']);
    const paid = expense(3000, { settlement: { personId: 'ben', groupId: TRIP } });
    const g = group({ memberIds: ['ben'] });
    expect(ledgerFor([paid], [dinner], g).ledger.myBalanceCents).toBe(0);
    expect(ledgerFor([], [dinner], g).ledger.myBalanceCents).toBe(-3000);
  });
});

describe('payments recorded on a bill the old way still count', () => {
  it('"Alex paid for Alex and Ben" is money from Alex', () => {
    const food = expense(9000, {
      split: inGroup(quickSplit(9000, [ME, 'alex', 'ben'])),
      moneyBack: [{ id: 'r', source: 'repayment', amountCents: 6000, date: '2026-09-15', fromPersonId: 'alex', coversPersonIds: ['alex', 'ben'] }],
    });
    const { ledger } = ledgerFor([food], [], group({ memberIds: ['alex', 'ben'] }));
    // You're square; Ben now owes Alex, which is between them.
    expect(balanceOf(ledger, ME)).toBe(0);
    expect(balanceOf(ledger, 'alex')).toBe(3000);
    expect(balanceOf(ledger, 'ben')).toBe(-3000);
    expect(ledger.plan).toEqual([{ fromPersonId: 'ben', toPersonId: 'alex', amountCents: 3000 }]);
  });

  it('an unnamed repayment is credited to whoever it covers, in order', () => {
    const entry: MoneyBackEntry & { id: string } = { id: 'r', source: 'repayment', amountCents: 4000, date: '2026-09-15' };
    const food = expense(9000, { split: inGroup(quickSplit(9000, [ME, 'alex', 'ben'])), moneyBack: [entry] });
    const { ledger } = ledgerFor([food], [], group({ memberIds: ['alex', 'ben'] }));
    const status = splitStatus(food.split!, [entry]);
    for (const p of status.people) expect(balanceOf(ledger, p.personId)).toBe(-3000 + p.repaidCents);
    expect(sum(ledger.balances.map(b => b.netCents))).toBe(0);
  });
});

describe('refunds and the rest of the app', () => {
  it('a refund on a group bill shrinks everyone\'s share', () => {
    const food = expense(12000, {
      split: inGroup(quickSplit(12000, [ME, 'alex', 'ben', 'cara'])),
      moneyBack: [{ id: 'r', source: 'refund', amountCents: 4000, date: '2026-09-14' }],
    });
    const { ledger } = ledgerFor([food], []);
    expect(ledger.totalCents).toBe(8000);
    expect(ledger.myShareCents).toBe(2000);
    expect(balanceOf(ledger, 'alex')).toBe(-2000);
    expect(ledger.myBalanceCents).toBe(6000);
  });

  it('only this group: other groups and ordinary split bills are left alone', () => {
    const elsewhere = expense(5000, { split: { ...quickSplit(5000, [ME, 'alex']), groupId: 'other' } });
    const plain = expense(5000, { split: quickSplit(5000, [ME, 'alex']) });
    const { ledger } = ledgerFor([elsewhere, plain], []);
    expect(ledger.bills).toEqual([]);
    expect(ledger.balances.every(b => b.netCents === 0)).toBe(true);
  });

  it('money you got spreads over your bills, oldest first, up to the part that was other people\'s', () => {
    const older = expense(6000, { date: '2026-09-10', split: inGroup(quickSplit(6000, [ME, 'alex'])) });   // 30.00 of others'
    const newer = expense(9000, { date: '2026-09-11', split: inGroup(quickSplit(9000, [ME, 'alex', 'ben'])) }); // 60.00 of others'
    const money = new Ledger(() => [older, newer]);
    const spread = (cents: number) => spreadReceived(TRIP, [newer, older], t => money.moneyBackEntriesFor(t), cents);
    expect(spread(5000)).toEqual([{ expenseId: older.id, amountCents: 3000 }, { expenseId: newer.id, amountCents: 2000 }]);
    // Beyond everything that was other people's: the rest is a surplus on the newest.
    expect(spread(10000)).toEqual([{ expenseId: older.id, amountCents: 3000 }, { expenseId: newer.id, amountCents: 7000 }]);
    expect(spreadReceived(TRIP, [], () => [], 1000)).toEqual([]);
  });
});
