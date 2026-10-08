import { describe, it, expect } from 'vitest';
import { ME, Transaction } from '../models';
import { MoneyBackLedger } from './money-back';
import { balancesByPerson, spreadRepayment, totalOwedCents } from './shared';
import { quickSplit, setClosed } from './splits';

class Ledger extends MoneyBackLedger {
  constructor(public transactions: () => Transaction[]) { super(); }
}

let n = 0;
const bill = (date: string, cents: number, people: string[], extra: Partial<Transaction> = {}): Transaction => ({
  id: `b${++n}`, type: 'expense', amount: cents / 100, date, createdAt: n, updatedAt: 0, accountId: 'a',
  split: quickSplit(cents, [ME, ...people]), ...extra,
});

describe('balancesByPerson', () => {
  const dinner = bill('2026-09-01', 9000, ['m', 'p']);   // $30 each
  const pizza = bill('2026-09-10', 5000, ['m']);         // $25 each
  const tacos = bill('2026-09-20', 9000, ['m', 'p']);    // $30 each
  const txs = [tacos, dinner, pizza];
  const ledger = new Ledger(() => txs);
  const balances = () => balancesByPerson(txs, t => ledger.moneyBackEntriesFor(t));

  it('adds up what each person owes across bills, most owed first', () => {
    const [m, p] = balances();
    expect(m.personId).toBe('m');
    expect(m.owedCents).toBe(3000 + 2500 + 3000);
    expect(p.owedCents).toBe(6000);
    expect(totalOwedCents(balances())).toBe(8500 + 6000);
  });

  it('lists open bills oldest first — the order a repayment pays them off', () => {
    expect(balances()[0].openBills.map(b => b.tx.id)).toEqual([dinner.id, pizza.id, tacos.id]);
    expect(balances()[0].allBills.map(b => b.tx.id)).toEqual([tacos.id, pizza.id, dinner.id]);
  });

  it("leaves out bills that are repaid or marked won't be repaid", () => {
    const repaid = { ...dinner, moneyBack: [{ id: 'r', source: 'repayment' as const, amountCents: 3000, date: '2026-09-02', fromPersonId: 'm' }] };
    const closed = { ...tacos, split: setClosed(tacos.split!, 'm', true) };
    const l = new Ledger(() => [repaid, pizza, closed]);
    const m = balancesByPerson([repaid, pizza, closed], t => l.moneyBackEntriesFor(t)).find(b => b.personId === 'm')!;
    expect(m.owedCents).toBe(2500);
    expect(m.openBills.map(b => b.tx.id)).toEqual([pizza.id]);
    expect(m.allBills).toHaveLength(3);
  });
});

describe('spreadRepayment', () => {
  const dinner = bill('2026-09-01', 9000, ['m']);   // m owes $45
  const pizza = bill('2026-09-10', 5000, ['m']);    // m owes $25
  const ledger = new Ledger(() => [dinner, pizza]);
  const open = () => balancesByPerson([dinner, pizza], t => ledger.moneyBackEntriesFor(t))[0].openBills;

  it('pays off the oldest bill first', () => {
    expect(spreadRepayment(open(), 5000)).toEqual([
      { expenseId: dinner.id, amountCents: 4500 },
      { expenseId: pizza.id, amountCents: 500 },
    ]);
  });

  it('clears everything with exactly what is owed', () => {
    const parts = spreadRepayment(open(), 7000);
    expect(parts.map(p => p.amountCents)).toEqual([4500, 2500]);
  });

  it('puts anything beyond what is owed on the newest bill, so the parts add up to what was paid', () => {
    const parts = spreadRepayment(open(), 8000);
    expect(parts).toEqual([{ expenseId: dinner.id, amountCents: 4500 }, { expenseId: pizza.id, amountCents: 3500 }]);
    expect(parts.reduce((t, p) => t + p.amountCents, 0)).toBe(8000);
  });

  it('nothing to spread', () => {
    expect(spreadRepayment(open(), 0)).toEqual([]);
    expect(spreadRepayment([], 5000)).toEqual([]);
  });
});
