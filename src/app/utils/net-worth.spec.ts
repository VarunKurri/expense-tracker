import { describe, it, expect } from 'vitest';
import { Account, ManualAsset, Transaction } from '../models';
import { accountBalance } from './finance';
import {
  balanceOn, valueOn, withValuation, holdingsOn, composition, netWorthSeries,
  rangeDates, changeOver, earliestDate, manualType,
} from './net-worth';

const acct = (over: Partial<Account> & { id: string }): Account =>
  ({ name: over.id, type: 'checking', openingBalance: 0, currency: 'USD', createdAt: 0, ...over });
const tx = (over: Partial<Transaction>): Transaction =>
  ({ type: 'expense', amount: 0, date: '2026-09-01', createdAt: 0, updatedAt: 0, ...over } as Transaction);

const checking = acct({ id: 'chk', openingBalance: 1000 });
const card = acct({ id: 'card', type: 'credit', openingBalance: 200 }); // owes $200 at the start
const txs: Transaction[] = [
  tx({ type: 'income', accountId: 'chk', amount: 3000, date: '2026-09-01' }),   // paycheck
  tx({ type: 'expense', accountId: 'card', amount: 150, date: '2026-09-10' }),  // card purchase
  tx({ type: 'expense', accountId: 'chk', amount: 1200, date: '2026-09-15' }),  // rent
  tx({ type: 'transfer', fromAccountId: 'chk', toAccountId: 'card', amount: 350, date: '2026-09-20' }), // pay card off
];

const house: ManualAsset = {
  id: 'house', name: 'House', type: 'property', createdAt: 0, updatedAt: 0,
  valuations: [{ date: '2026-09-12', value: 400000 }, { date: '2026-06-01', value: 390000 }],
};
const mortgage: ManualAsset = {
  id: 'mort', name: 'Mortgage', type: 'mortgage', createdAt: 0, updatedAt: 0,
  valuations: [{ date: '2026-06-01', value: 310000 }],
};

describe('balanceOn', () => {
  it('matches the app\'s current balance when asked about today', () => {
    for (const a of [checking, card]) {
      expect(balanceOn(a, txs, '2099-01-01')).toBe(accountBalance(a, txs));
    }
  });

  it('only counts transactions up to and including the date', () => {
    expect(balanceOn(checking, txs, '2026-08-31')).toBe(1000);
    expect(balanceOn(checking, txs, '2026-09-15')).toBe(2800);
    expect(balanceOn(card, txs, '2026-09-10')).toBe(350);   // owes more after the purchase
    expect(balanceOn(card, txs, '2026-09-20')).toBe(0);     // paid off
  });
});

describe('manual valuations', () => {
  it('uses the latest valuation on or before the date, and nothing before the first', () => {
    expect(valueOn(house, '2026-05-31')).toBeNull();
    expect(valueOn(house, '2026-06-01')).toBe(390000);
    expect(valueOn(house, '2026-09-11')).toBe(390000);
    expect(valueOn(house, '2026-10-01')).toBe(400000);
  });

  it('records a new value without rewriting history, replacing only the same day', () => {
    const v1 = withValuation(house.valuations, '2026-10-04', 405000);
    expect(v1.map(v => v.date)).toEqual(['2026-06-01', '2026-09-12', '2026-10-04']);
    const v2 = withValuation(v1, '2026-10-04', 410000);
    expect(v2).toHaveLength(3);
    expect(v2[2].value).toBe(410000);
  });
});

describe('holdings and composition', () => {
  it('puts each thing on the right side and in the right group', () => {
    const h = holdingsOn([checking, card], [house, mortgage], txs, '2026-09-10');
    const c = composition(h);
    // checking 4000, house 390000 | card 350, mortgage 310000
    expect(c.assets).toBe(394000);
    expect(c.liabilities).toBe(310350);
    expect(c.net).toBe(83650);
    expect(c.assetGroups.map(g => g.label)).toEqual(['Cash', 'Real estate']);
    expect(c.liabilityGroups.map(g => g.label)).toEqual(['Credit cards', 'Loans']);
    expect(c.assetGroups[1].share).toBeCloseTo(390000 / 394000);
  });

  it('counts an overpaid card as an asset and an overdrawn account as a debt', () => {
    const overpaid = acct({ id: 'c2', type: 'credit', openingBalance: -40 });
    const overdrawn = acct({ id: 'c3', openingBalance: -25 });
    const c = composition(holdingsOn([overpaid, overdrawn], [], [], '2026-09-01'));
    expect(c.assets).toBe(40);
    expect(c.liabilities).toBe(25);
    expect(c.assetGroups[0].label).toBe('Other assets');
    expect(c.liabilityGroups[0].label).toBe('Other debts');
  });

  it('leaves out archived accounts and entries', () => {
    const c = composition(holdingsOn(
      [{ ...checking, archived: true }], [{ ...house, archived: true }], txs, '2026-10-01'));
    expect(c.net).toBe(0);
  });
});

describe('netWorthSeries', () => {
  const dates = ['2026-05-01', '2026-06-01', '2026-09-01', '2026-09-10', '2026-09-12', '2026-09-15', '2026-09-20', '2026-10-04'];

  it('agrees with a full recount on every date', () => {
    const series = netWorthSeries([checking, card], [house, mortgage], txs, dates);
    for (const p of series) {
      const c = composition(holdingsOn([checking, card], [house, mortgage], txs, p.date));
      expect(p).toEqual({ date: p.date, assets: c.assets, liabilities: c.liabilities, net: c.net });
    }
  });

  it('adds manual entries from their first valuation, not retroactively', () => {
    const [may, june] = netWorthSeries([checking], [house, mortgage], [], ['2026-05-01', '2026-06-01']);
    expect(may.net).toBe(1000);
    expect(june.net).toBe(1000 + 390000 - 310000);
  });

  it('a card payment moves money between accounts without changing net worth', () => {
    const [before, after] = netWorthSeries([checking, card], [], txs, ['2026-09-19', '2026-09-20']);
    expect(after.net).toBe(before.net);
    expect(after.liabilities).toBe(0);
  });
});

describe('rangeDates', () => {
  it('ends today, starts a range back, and stays under ~120 points', () => {
    for (const r of ['1M', '3M', '6M', '1Y'] as const) {
      const d = rangeDates(r, '2026-10-04', null);
      expect(d[d.length - 1]).toBe('2026-10-04');
      expect(d.length).toBeLessThanOrEqual(122);
      expect([...d].sort()).toEqual(d);
    }
    expect(rangeDates('1M', '2026-10-04', null)[0]).toBe('2026-09-04');
    expect(rangeDates('1Y', '2026-10-04', null)[0]).toBe('2025-10-04');
  });

  it('clamps month ends instead of overflowing', () => {
    expect(rangeDates('1M', '2026-03-31', null)[0]).toBe('2026-02-28');
  });

  it('"All" reaches back to the first record, but never less than a month', () => {
    expect(rangeDates('ALL', '2026-10-04', '2024-01-15')[0]).toBe('2024-01-15');
    expect(rangeDates('ALL', '2026-10-04', '2026-10-01')[0]).toBe('2026-09-04');
  });
});

describe('small pieces', () => {
  it('changeOver', () => {
    expect(changeOver([
      { date: 'a', assets: 0, liabilities: 0, net: 1000 },
      { date: 'b', assets: 0, liabilities: 0, net: 1250 },
    ])).toEqual({ amount: 250, pct: 0.25 });
    expect(changeOver([]).pct).toBeNull();
  });

  it('earliestDate looks at transactions and valuations', () => {
    expect(earliestDate(txs, [house])).toBe('2026-06-01');
    expect(earliestDate([], [])).toBeNull();
  });

  it('manualType knows every side', () => {
    expect(manualType('mortgage').side).toBe('liability');
    expect(manualType('vehicle').side).toBe('asset');
  });
});
