import { describe, it, expect } from 'vitest';
import { Account, Bill, ManualAsset, Transaction } from '../models';
import {
  billCategory, billIsLoanPayment, billItems, cashOn, forecast, forecastBasis, pastMonths, projectNetWorth,
} from './forecast';
import { MoneyRules } from './reporting';
import { estimatedValue, monthlyPayment } from './loans';

const today = '2026-10-06';
const rules: MoneyRules = { netting: true, effectiveExpense: t => t.amount, reimbursementSurplus: () => 0 };
const checking: Account = { id: 'chk', name: 'Checking', type: 'checking', openingBalance: 5000, currency: 'USD', createdAt: 0 };
const card: Account = { id: 'card', name: 'Card', type: 'credit', openingBalance: 0, currency: 'USD', createdAt: 0 };

let seq = 0;
const tx = (over: Partial<Transaction>): Transaction =>
  ({ id: `t${++seq}`, type: 'expense', amount: 100, date: '2026-09-10', accountId: 'chk', createdAt: seq, updatedAt: 0, ...over } as Transaction);
const bill = (over: Partial<Bill>): Bill =>
  ({ id: `b${++seq}`, name: 'Netflix', amount: 20, frequency: 'monthly', nextDueDate: '2026-10-15', autopayEnabled: true, active: true, createdAt: 0, ...over });

/** Three ordinary months: $4,000 pay, $2,500 spent each (Jul–Sep 2026). */
function history(): Transaction[] {
  const out: Transaction[] = [];
  for (const m of ['07', '08', '09']) {
    out.push(tx({ type: 'income', amount: 4000, date: `2026-${m}-01`, merchant: 'Payroll' }));
    out.push(tx({ amount: 2500, date: `2026-${m}-12`, merchant: 'Groceries etc' }));
  }
  return out;
}

const carLoan = (): ManualAsset => ({
  id: 'car', name: 'Car loan', type: 'auto-loan', valuations: [], createdAt: 0, updatedAt: 0,
  loan: {
    method: 'reducing', startDate: '2026-06-01', amountFinanced: 12000, rate: 6, termMonths: 24,
    firstPaymentDate: '2026-07-20', payment: monthlyPayment(12000, 6, 24, 'reducing'),
    match: { text: 'auto finance' }, paymentIds: [], ignoredIds: [],
  },
});

describe('the months it is based on', () => {
  it('are the last complete months — never the one in progress', () => {
    expect(pastMonths(today, 3)).toEqual(['2026-07', '2026-08', '2026-09']);
    expect(pastMonths('2027-01-15', 2)).toEqual(['2026-11', '2026-12']);
  });

  it('averages income and spending the way Analysis counts them', () => {
    const txs = [
      ...history(),
      tx({ amount: 900, date: '2026-09-20', isInternalTransfer: true }),  // card payment: not spending
      tx({ amount: 300, date: '2026-09-21', refunded: true }),            // refunded: not spending
    ];
    const b = forecastBasis(txs, [], [], rules, pastMonths(today, 3));
    expect(b.income).toBe(4000);
    expect(b.everyday).toBe(2500);
  });

  it('a one-off month can be left out', () => {
    const txs = [...history(), tx({ amount: 3000, date: '2026-08-15', merchant: 'Laptop' })];
    const all = forecastBasis(txs, [], [], rules, pastMonths(today, 3));
    const without = forecastBasis(txs, [], [], rules, pastMonths(today, 3), ['2026-08']);
    expect(all.everyday).toBe(3500);
    expect(without.everyday).toBe(2500);
    expect(without.months.find(m => m.month === '2026-08')!.included).toBe(false);
  });

  it('everyday spending leaves out bills (by their monthly cost) and loan payments', () => {
    const loan = carLoan();
    const pays = ['2026-07-20', '2026-08-20', '2026-09-20'].map(d =>
      tx({ amount: loan.loan!.payment, date: d, merchant: 'AUTO FINANCE CO' }));
    const b = forecastBasis([...history(), ...pays], [loan], [bill({ amount: 120, frequency: 'quarterly' })], rules, pastMonths(today, 3));
    expect(b.billsMonthly).toBe(40);
    expect(b.everyday).toBe(2460);  // 2500 − 40; the loan payments aren't in it at all
  });
});

describe('everyday spending, by category', () => {
  const months = pastMonths(today, 3);
  const spend = (cat: string | undefined, amount: number, m: string, merchant = 'Shop') =>
    tx({ amount, date: `2026-${m}-10`, categoryId: cat, merchant });

  /** Groceries $400–$500 a month, dining $150, and $90 nobody filed. */
  function life(): Transaction[] {
    return [
      spend('groceries', 400, '07'), spend('groceries', 500, '08'), spend('groceries', 450, '09'),
      spend('dining', 150, '07'), spend('dining', 150, '08'), spend('dining', 150, '09'),
      spend(undefined, 90, '07'), spend(undefined, 90, '08'), spend(undefined, 90, '09'),
    ];
  }

  it('averages each category, largest first, and they add up to the everyday figure', () => {
    const b = forecastBasis(life(), [], [], rules, months);
    expect(b.categories.map(c => [c.categoryId, c.everyday])).toEqual([['groceries', 450], ['dining', 150], ['__none__', 90]]);
    expect(b.everyday).toBe(690);
    expect(b.categories.reduce((s, c) => s + c.everyday, 0) - b.unfiledBills).toBe(b.everyday);
  });

  it('a bill comes out of its own category — a quarterly one nets to nothing, not a third', () => {
    const txs = [...life(), spend('insurance', 360, '08', 'GEICO')];   // paid once a quarter
    const geico = bill({ name: 'Geico', amount: 360, frequency: 'quarterly', categoryId: 'insurance' });
    const b = forecastBasis(txs, [], [geico], rules, months);
    const ins = b.categories.find(c => c.categoryId === 'insurance')!;
    expect(ins).toMatchObject({ spent: 120, bills: 120, everyday: 0, billNames: ['Geico'] });
    expect(b.everyday).toBe(690);  // insurance adds nothing: it's in the Bills column on its date
  });

  it('a bill with no category takes the one its payments are filed under', () => {
    const txs = [...life(), ...['07', '08', '09'].map(m => spend('entertainment', 20, m, 'NETFLIX.COM'))];
    const netflix = bill({ name: 'Netflix', amount: 20 });
    expect(billCategory(netflix, txs)).toBe('entertainment');
    const b = forecastBasis(txs, [], [netflix], rules, months);
    expect(b.categories.find(c => c.categoryId === 'entertainment')).toMatchObject({ spent: 20, bills: 20, everyday: 0 });
    expect(b.unfiledBills).toBe(0);
    expect(b.everyday).toBe(690);
  });

  it('a bill with no category and no payments to go by is shown on its own line', () => {
    const gym = bill({ name: 'Gym', amount: 40 });
    const b = forecastBasis(life(), [], [gym], rules, months);
    expect(b.unfiledBills).toBe(40);
    expect(b.unfiledBillNames).toEqual(['Gym']);
    expect(b.everyday).toBe(650);
  });

  it('leaving a month out changes the categories too', () => {
    const b = forecastBasis(life(), [], [], rules, months, ['2026-08']);
    expect(b.categories.find(c => c.categoryId === 'groceries')!.everyday).toBe(425);
  });
});

describe('bills on their real dates', () => {
  it('a monthly bill each month, a yearly one only in its month', () => {
    const items = billItems([bill({}), bill({ name: 'Car insurance', amount: 1140, frequency: 'yearly', nextDueDate: '2027-03-02' })], [], today, '2027-04-30');
    expect(items.filter(i => i.name === 'Netflix').map(i => i.date)).toEqual(
      ['2026-10-15', '2026-11-15', '2026-12-15', '2027-01-15', '2027-02-15', '2027-03-15', '2027-04-15']);
    expect(items.filter(i => i.name === 'Car insurance').map(i => i.date)).toEqual(['2027-03-02']);
  });

  it('a quarterly bill lands every third month', () => {
    const items = billItems([bill({ frequency: 'quarterly', nextDueDate: '2026-11-01' })], [], today, '2027-06-30');
    expect(items.map(i => i.date)).toEqual(['2026-11-01', '2027-02-01', '2027-05-01']);
  });

  it('an overdue bill counts once, today, then carries on', () => {
    const items = billItems([bill({ nextDueDate: '2026-08-15' })], [], today, '2026-11-30');
    expect(items.map(i => [i.date, !!i.overdue])).toEqual([['2026-10-06', true], ['2026-10-15', false], ['2026-11-15', false]]);
  });

  it('inactive bills are left out', () => {
    expect(billItems([bill({ active: false })], [], today, '2026-12-31')).toEqual([]);
  });

  it('a bill that is really the car payment isn\'t counted twice', () => {
    const loan = carLoan();
    const carBill = bill({ name: 'Auto Finance', amount: loan.loan!.payment });
    expect(billIsLoanPayment(carBill, [loan])).toBe(true);
    expect(billIsLoanPayment(bill({}), [loan])).toBe(false);
    expect(billItems([carBill], [loan], today, '2026-12-31')).toEqual([]);
  });
});

describe('the forecast', () => {
  const base = { accounts: [checking, card], manual: [] as ManualAsset[], bills: [] as Bill[], rules, today, horizon: 7, baseMonths: 3 };

  it('starts from cash: checking and savings, less what is owed on cards', () => {
    const txs = [...history(), tx({ amount: 400, date: '2026-10-02', accountId: 'card' })];
    expect(cashOn([checking, card], txs, today)).toBe(5000 + 3 * 1500 - 400);
  });

  it('adds what you usually save each month, and only the rest of this one', () => {
    const f = forecast({ ...base, txs: history() });
    expect(f.startCash).toBe(9500);
    expect(f.months).toHaveLength(7);
    expect(f.months[0].partial).toBe(true);
    // Oct 6: 25 of 31 days still to come.
    expect(f.months[0].net).toBeCloseTo(1500 * 25 / 31, 1);
    expect(f.months[1]).toMatchObject({ month: '2026-11', income: 4000, everyday: 2500, net: 1500 });
    expect(f.monthlyNet).toBe(1500);
    expect(f.endCash).toBeCloseTo(9500 + 1500 * 25 / 31 + 6 * 1500, 0);
  });

  it('a yearly bill is a dip in its own month', () => {
    const f = forecast({ ...base, txs: history(), bills: [bill({ name: 'Car insurance', amount: 1140, frequency: 'yearly', nextDueDate: '2027-03-02' })] });
    const march = f.months.find(m => m.month === '2027-03')!;
    const feb = f.months.find(m => m.month === '2027-02')!;
    expect(march.bills).toBe(1140);
    expect(feb.bills).toBe(0);
    expect(f.biggest?.name).toBe('Car insurance');
  });

  it('loan payments come from the schedule and stop when the loan ends', () => {
    const loan = carLoan();
    loan.loan = { ...loan.loan!, amountFinanced: 1000, termMonths: 6, payment: monthlyPayment(1000, 6, 6, 'reducing') };
    const pays = ['2026-07-20', '2026-08-20', '2026-09-20'].map(d =>
      tx({ amount: loan.loan!.payment, date: d, merchant: 'AUTO FINANCE CO' }));
    const f = forecast({ ...base, manual: [loan], txs: [...history(), ...pays], horizon: 4 });
    // Payments 4–6 in Oct, Nov and Dec (the last settles the rounding), then nothing.
    expect(f.months[0].loans).toBe(loan.loan.payment);
    expect(f.months[1].loans).toBe(loan.loan.payment);
    expect(Math.abs(f.months[2].loans - loan.loan.payment)).toBeLessThan(1);
    expect(f.months[3].loans).toBe(0);
    // The history's loan payments aren't also in everyday spending.
    expect(f.basis.everyday).toBe(2500);
  });

  it('money lent comes back as repayments — not counted again from the income history', () => {
    const lent: ManualAsset = {
      id: 'ravi', name: 'Loan to Ravi', type: 'loan-given', valuations: [], createdAt: 0, updatedAt: 0,
      loan: {
        owedTo: 'me', method: 'none', startDate: '2026-06-01', amountFinanced: 600, rate: 0, termMonths: 6,
        firstPaymentDate: '2026-07-25', payment: 100, match: { text: 'ravi' }, paymentIds: [], ignoredIds: [],
      },
    };
    const repaid = ['2026-07-25', '2026-08-25', '2026-09-25'].map(d =>
      tx({ type: 'income', amount: 100, date: d, merchant: 'Zelle from Ravi' }));
    const f = forecast({ ...base, manual: [lent], txs: [...history(), ...repaid], horizon: 4 });
    expect(f.basis.income).toBe(4000);   // Ravi's $100 isn't "pay"
    expect(f.months.map(m => m.repayments)).toEqual([100, 100, 100, 0]);
  });

  it('with no history yet, it says so rather than guessing', () => {
    expect(forecast({ ...base, txs: [] }).thin).toBe(true);
    expect(forecast({ ...base, txs: history() }).thin).toBe(false);
  });
});

describe('net worth, projected', () => {
  it('a loan payment only costs its interest; a car keeps losing value', () => {
    const loan = carLoan();
    const car: ManualAsset = {
      id: 'civic', name: 'Civic', type: 'vehicle', valuations: [], createdAt: 0, updatedAt: 0,
      purchase: { price: 20000, date: '2026-06-01' }, depreciationRate: 0.15,
    };
    const txs = history();
    const f = forecast({ accounts: [checking], manual: [loan, car], bills: [], txs, rules, today, horizon: 3, baseMonths: 3 });
    const points = projectNetWorth(f, 10000, [loan, car], txs, today);
    expect(points.map(p => p.date)).toEqual(['2026-10-31', '2026-11-30', '2026-12-31']);

    // November: what was saved (after the whole payment), plus the principal
    // part back (it only swapped cash for less debt), less what the car lost.
    const nov = f.months[1];
    const payment = nov.items.find(i => i.kind === 'loan-out')!;
    const carLost = estimatedValue(car, '2026-10-31')! - estimatedValue(car, '2026-11-30')!;
    const step = points[1].net - points[0].net;
    expect(step).toBeCloseTo(nov.net + (payment.amount - payment.interest!) - carLost, 1);
    // So net worth grows by what you save less the interest — and less the car's ~$250 a month.
    expect(step).toBeCloseTo(1500 - payment.interest! - carLost, 1);
    expect(carLost).toBeGreaterThan(200);
  });

  it('someone else\'s loan repaid to you: all of it is your gain', () => {
    const dads: ManualAsset = {
      id: 'dad', name: "Ravi (Dad's)", type: 'loan-given', valuations: [], createdAt: 0, updatedAt: 0,
      loan: {
        owedTo: 'someone-else', method: 'none', startDate: '2026-06-01', amountFinanced: 600, rate: 0, termMonths: 6,
        firstPaymentDate: '2026-07-25', payment: 100, match: { text: 'ravi' }, paymentIds: [], ignoredIds: [],
      },
    };
    const f = forecast({ accounts: [checking], manual: [dads], bills: [], txs: [], rules, today, horizon: 2, baseMonths: 3 });
    const points = projectNetWorth(f, 5000, [dads], [], today);
    expect(points[1].net - points[0].net).toBe(100);
  });
});
