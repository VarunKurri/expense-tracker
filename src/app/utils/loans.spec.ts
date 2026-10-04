import { describe, it, expect } from 'vitest';
import { LoanTerms, ManualAsset, Transaction } from '../models';
import {
  monthlyPayment, flatInterest, equivalentReducingRate, dueDate, schedule,
  loanPayments, candidatePayments, loanState, loanOutlook, loanOwedOn,
  estimatedValue, countsInNetWorth, loanDirection,
} from './loans';

/** The worked example from the plan: $18,000 at 4.2% for 60 months, first payment Aug 5. */
const terms = (over: Partial<LoanTerms> = {}): LoanTerms => ({
  method: 'reducing', startDate: '2026-07-05', amountFinanced: 18000, rate: 4.2, termMonths: 60,
  firstPaymentDate: '2026-08-05', payment: monthlyPayment(18000, 4.2, 60, 'reducing'),
  match: { text: 'toyota financial' }, paymentIds: [], ignoredIds: [], ...over,
});
const loan = (over: Partial<LoanTerms> = {}, type: ManualAsset['type'] = 'auto-loan'): ManualAsset => ({
  id: 'loan', name: 'Car loan', type, valuations: [], createdAt: 0, updatedAt: 0, loan: terms(over),
});
let seq = 0;
const tx = (over: Partial<Transaction>): Transaction =>
  ({ id: `t${++seq}`, type: 'expense', amount: 333.12, date: '2026-08-05', merchant: 'TOYOTA FINANCIAL SVCS', createdAt: seq, updatedAt: 0, ...over } as Transaction);

describe('the formulas', () => {
  it('EMI matches the textbook formula, worked independently', () => {
    // r = 0.042/12 = 0.0035; (1.0035)^60 = 1.233232…; EMI = 18000·0.0035·1.233232/0.233232
    const f = Math.pow(1.0035, 60);
    expect(monthlyPayment(18000, 4.2, 60, 'reducing')).toBeCloseTo(18000 * 0.0035 * f / (f - 1), 2);
    expect(monthlyPayment(18000, 4.2, 60, 'reducing')).toBe(333.12);
  });

  it('a 30-year mortgage comes out at the familiar figure', () => {
    // $300,000 at 6% for 30 years is the classic $1,798.65.
    expect(monthlyPayment(300000, 6, 360, 'reducing')).toBe(1798.65);
  });

  it('flat rate charges interest on the original amount for the whole term', () => {
    expect(flatInterest(18000, 4.2, 60)).toBe(3780);
    expect(monthlyPayment(18000, 4.2, 60, 'flat')).toBe(363);
  });

  it('no interest just divides', () => {
    expect(monthlyPayment(2400, 0, 24, 'none')).toBe(100);
    expect(monthlyPayment(2400, 5, 24, 'none')).toBe(100);
  });

  it('says what a flat rate really costs', () => {
    const eq = equivalentReducingRate(4.2, 60);
    expect(eq).toBeGreaterThan(7.6);
    expect(eq).toBeLessThan(8);
    expect(monthlyPayment(18000, eq, 60, 'reducing')).toBeCloseTo(363, 0);
  });
});

describe('the planned schedule', () => {
  it('pays off exactly, with interest shrinking and principal growing', () => {
    const rows = schedule(terms());
    expect(rows).toHaveLength(60);
    expect(rows[0]).toMatchObject({ n: 1, date: '2026-08-05', interest: 63, principal: 270.12 });
    expect(rows[59].balance).toBe(0);
    expect(rows[59].interest).toBeLessThan(rows[0].interest);
    const interest = rows.reduce((s, r) => s + r.interest, 0);
    // 60 × $333.12 − $18,000 = $1,987.20; the final payment absorbs a few cents of rounding.
    expect(Math.abs(interest - 1987.2)).toBeLessThan(1);
  });

  it('flat-rate schedule carries the same interest every month', () => {
    const rows = schedule(terms({ method: 'flat', payment: 363 }));
    expect(rows).toHaveLength(60);
    expect(new Set(rows.map(r => r.interest))).toEqual(new Set([63]));
    expect(rows[59].balance).toBe(0);
  });

  it('due dates keep their day and clamp to month end', () => {
    expect(dueDate('2026-01-31', 1)).toBe('2026-02-28');
    expect(dueDate('2026-01-31', 2)).toBe('2026-03-31');
  });
});

describe('recognising payments', () => {
  it('matches by merchant text and amount, and respects links and un-links', () => {
    const a = tx({ date: '2026-08-05' });
    const b = tx({ date: '2026-09-05', merchant: 'Toyota Financial', amount: 333.12 });
    const notMe = tx({ date: '2026-09-07', merchant: 'Toyota of Fremont', amount: 333.12 }); // dealer, not lender
    const tooBig = tx({ date: '2026-09-10', amount: 1200 });                               // not the payment amount
    const before = tx({ date: '2026-06-01' });                                            // before the loan
    const income = tx({ type: 'income', date: '2026-09-12' });
    const ignored = tx({ date: '2026-10-05' });
    const handLinked = tx({ date: '2026-10-20', merchant: 'Zelle', amount: 500 });
    const l = loan({ ignoredIds: [ignored.id!], paymentIds: [handLinked.id!] });
    const found = loanPayments(l, [a, b, notMe, tooBig, before, income, ignored, handLinked]);
    expect(found.map(p => p.tx.id)).toEqual([a.id, b.id, handLinked.id]);
    expect(found[2].how).toBe('linked');
  });

  it('suggests likely payments that aren\'t linked yet', () => {
    const zelle = tx({ merchant: 'Zelle to Mom', amount: 330, date: '2026-09-04' });
    const coffee = tx({ merchant: 'Blue Bottle', amount: 6, date: '2026-09-04' });
    expect(candidatePayments(loan(), [zelle, coffee]).map(t => t.id)).toEqual([zelle.id]);
  });
});

describe('the running balance', () => {
  const pay = (date: string, amount = 333.12) => tx({ date, amount });

  it('on schedule, it follows the planned schedule exactly', () => {
    const txs = ['2026-08-05', '2026-09-05', '2026-10-05'].map(d => pay(d));
    const s = loanState(loan(), txs, '2026-10-05');
    expect(s.paymentsMade).toBe(3);
    expect(s.principalLeft).toBe(schedule(terms())[2].balance);
    expect(s.interestDue).toBe(0);
    expect(s.splits[0]).toMatchObject({ n: 1, interest: 63, principal: 270.12 });
  });

  it('a missed month leaves interest owing; a double payment catches up', () => {
    const l = loan();
    const missed = loanState(l, [pay('2026-08-05')], '2026-09-30');
    expect(missed.interestDue).toBeGreaterThan(0);
    expect(missed.owed).toBe(round(missed.principalLeft + missed.interestDue));
    expect(loanOutlook(l, [pay('2026-08-05')], '2026-09-30').behindBy).toBe(1);

    // A double payment is far from the usual amount, so you link it by hand.
    const double = pay('2026-10-05', 666.24);
    const linked = loan({ paymentIds: [double.id!] });
    const caughtUp = loanState(linked, [pay('2026-08-05'), double], '2026-10-05');
    expect(caughtUp.interestDue).toBe(0);
    // Close to on-time, and never better than paying on time would have been.
    const onTime = loanState(l, ['2026-08-05', '2026-09-05', '2026-10-05'].map(d => pay(d)), '2026-10-05');
    expect(caughtUp.principalLeft).toBeGreaterThanOrEqual(onTime.principalLeft);
    expect(caughtUp.principalLeft - onTime.principalLeft).toBeLessThan(2);
  });

  it('an extra payment goes straight to principal and brings the payoff forward', () => {
    const l = loan();
    const normal = loanOutlook(l, [pay('2026-08-05')], '2026-08-10');
    const lump = pay('2026-08-06', 2000);
    const extra = loanOutlook(loan({ paymentIds: [lump.id!] }), [pay('2026-08-05'), lump], '2026-08-10');
    expect(extra.paymentsLeft).toBeLessThan(normal.paymentsLeft);
    expect(extra.futureInterest).toBeLessThan(normal.futureInterest);
  });

  it('a statement balance replaces the running figure', () => {
    const l = loan({ corrections: [{ date: '2026-09-20', value: 17000 }] });
    expect(loanState(l, [pay('2026-08-05'), pay('2026-09-05')], '2026-09-25').principalLeft).toBe(17000);
    const after = loanState(l, [pay('2026-08-05'), pay('2026-09-05'), pay('2026-10-05')], '2026-10-05');
    expect(after.principalLeft).toBe(round(17000 - (333.12 - 17000 * 0.0035)));
  });

  it('counts the down payment separately from the monthly payments', () => {
    const down = tx({ date: '2026-07-05', merchant: 'Toyota of Fremont', amount: 1000 });
    const l = loan({ downPaymentId: down.id, price: 19000, downPayment: 1000 });
    const s = loanState(l, [down, pay('2026-08-05')], '2026-08-05');
    expect(s.downPayment).toBe(1000);
    expect(s.paymentsMade).toBe(1);
    expect(s.principalPaid).toBe(270.12); // the down payment isn't a repayment of the $18,000
  });

  it('is nothing before the loan began', () => {
    expect(loanOwedOn(loan(), [], '2026-07-04')).toBeNull();
    expect(loanOwedOn(loan(), [], '2026-07-05')).toBe(18000);
  });

  it('a flat-rate loan reaches zero on schedule', () => {
    const l = loan({ method: 'flat', payment: 363 });
    const txs = schedule(l.loan!).map(r => pay(r.date, r.payment));
    const s = loanState(l, txs, '2031-12-31');
    expect(s.owed).toBe(0);
    expect(s.interestPaid).toBe(3780);
  });
});

describe('what is left', () => {
  it('fresh loan: 60 payments, ~$19,987 still to pay, paid off in 5 years', () => {
    const o = loanOutlook(loan(), [], '2026-07-10');
    expect(o.paymentsLeft).toBe(60);
    expect(o.leftToPay).toBeCloseTo(19987, -1);
    expect(o.payoffDate).toBe('2031-07-05');
    expect(o.nextDue).toBe('2026-08-05');
  });

  it('after 3 on-time payments: 57 left, and the totals add up', () => {
    const txs = ['2026-08-05', '2026-09-05', '2026-10-05'].map(d => tx({ date: d }));
    const o = loanOutlook(loan(), txs, '2026-10-06');
    const s = loanState(loan(), txs, '2026-10-06');
    expect(o.paymentsLeft).toBe(57);
    expect(o.behindBy).toBe(0);
    // Everything ever paid + everything left = the whole cost of the loan.
    expect(s.totalPaid + o.leftToPay).toBeCloseTo(18000 + o.lifetimeInterest, 0);
  });
});

describe('who it belongs to', () => {
  it('a loan you took is borrowed; money you lent is lent', () => {
    expect(loanDirection('auto-loan')).toBe('borrowed');
    expect(loanDirection('loan-given')).toBe('lent');
  });

  it('money you lent is matched against incoming payments', () => {
    const l = loan({ match: { text: 'ravi' }, payment: 100, amountFinanced: 2400, method: 'none', rate: 0, termMonths: 24 }, 'loan-given');
    const repay = tx({ type: 'income', merchant: 'Zelle from Ravi', amount: 100, date: '2026-08-05' });
    const spend = tx({ type: 'expense', merchant: 'Ravi Sweets', amount: 100, date: '2026-08-06' });
    expect(loanPayments(l, [repay, spend]).map(p => p.tx.id)).toEqual([repay.id]);
    expect(loanState(l, [repay], '2026-08-05').owed).toBe(2300);
  });

  it('Dad\'s loan, repaid to you, is tracked but not yours', () => {
    const mine = loan({}, 'loan-given');
    const dads: ManualAsset = { ...mine, loan: { ...mine.loan!, owedTo: 'someone-else' } };
    expect(countsInNetWorth(mine)).toBe(true);
    expect(countsInNetWorth(dads)).toBe(false);
    expect(countsInNetWorth(loan())).toBe(true);
  });
});

describe('estimated value', () => {
  const car: ManualAsset = {
    id: 'car', name: 'Civic', type: 'vehicle', valuations: [], createdAt: 0, updatedAt: 0,
    purchase: { price: 20000, date: '2026-01-01' }, depreciationRate: 0.15,
  };

  it('loses about 15% a year from the price', () => {
    expect(estimatedValue(car, '2025-12-31')).toBeNull();
    expect(estimatedValue(car, '2026-01-01')).toBe(20000);
    expect(estimatedValue(car, '2027-01-01')).toBeCloseTo(17000, -1);
  });

  it('a real value you enter takes over, and the estimate continues from it', () => {
    const valued = { ...car, valuations: [{ date: '2026-07-01', value: 19500 }] };
    expect(estimatedValue(valued, '2026-07-01')).toBe(19500);
    expect(estimatedValue(valued, '2027-07-01')).toBeCloseTo(19500 * 0.85, -1);
    expect(estimatedValue(valued, '2026-03-01')).toBeLessThan(20000); // still the estimate before it
  });

  it('no rate, no estimate', () => {
    expect(estimatedValue({ ...car, depreciationRate: 0 }, '2027-01-01')).toBeNull();
  });
});

function round(n: number) { return Math.round(n * 100) / 100; }

describe('the rows ahead', () => {
  it('lists every payment still to come, ending at zero', () => {
    const o = loanOutlook(loan(), [], '2026-07-10');
    expect(o.upcoming).toHaveLength(60);
    expect(o.upcoming[0]).toMatchObject({ n: 1, date: '2026-08-05', interest: 63 });
    expect(o.upcoming[59].balance).toBe(0);
    expect(o.upcoming.reduce((s, r) => s + r.payment, 0)).toBeCloseTo(o.leftToPay, 2);
  });

  it('names the months that were missed', () => {
    const o = loanOutlook(loan(), [tx({ date: '2026-08-05' })], '2026-10-20');
    expect(o.missedDates).toEqual(['2026-09-05', '2026-10-05']);
  });
});
