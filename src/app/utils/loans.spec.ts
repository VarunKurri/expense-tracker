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

describe('payments that don\'t arrive on a fixed day', () => {
  // Lent $2,400, no interest, $100 a month "around the 25th" — sometimes the 24th,
  // sometimes the 26th, sometimes the 1st or 2nd of the next month.
  const lending = (over: Partial<LoanTerms> = {}) => loan({
    method: 'none', rate: 0, amountFinanced: 2400, termMonths: 24, payment: 100,
    startDate: '2026-08-20', firstPaymentDate: '2026-09-25', match: { text: 'ravi' },
    dueMode: 'flexible', lateDays: 10, ...over,
  }, 'loan-given');
  const repay = (date: string) => tx({ type: 'income', merchant: 'Zelle from Ravi', amount: 100, date });

  it('a payment on the 2nd still counts for the 25th before it', () => {
    const txs = [repay('2026-09-24'), repay('2026-10-26'), repay('2026-12-02')];
    for (const day of ['2026-10-28', '2026-11-30', '2026-12-06']) {
      const o = loanOutlook(lending(), txs.filter(t => t.date <= day), day);
      expect(o.behindBy).toBe(0);
    }
  });

  it('waits for the window before calling a payment missed', () => {
    const txs = [repay('2026-09-24'), repay('2026-10-26')];
    // November's is due around Nov 25, and may arrive up to Dec 5.
    expect(loanOutlook(lending(), txs, '2026-12-05').behindBy).toBe(0);
    const missed = loanOutlook(lending(), txs, '2026-12-06');
    expect(missed.behindBy).toBe(1);
    expect(missed.missedDates).toEqual(['2026-11-25']);
  });

  it('on its way: the next payment is the unpaid one, not next month\'s', () => {
    const o = loanOutlook(lending(), [repay('2026-09-24')], '2026-10-28');
    expect(o.nextDue).toBe('2026-10-25');
    expect(o.nextDueBy).toBe('2026-11-04');
    expect(o.nextIsLate).toBe(true);
    expect(o.upcoming[0].date).toBe('2026-10-25');
  });

  it('two payments in one month cover two due dates', () => {
    // October's arrives Nov 1, November's on Nov 26.
    const txs = [repay('2026-09-24'), repay('2026-11-01'), repay('2026-11-26')];
    const o = loanOutlook(lending(), txs, '2026-12-01');
    expect(o.behindBy).toBe(0);
    expect(o.nextDue).toBe('2026-12-25');
    expect(o.nextIsLate).toBe(false);
  });

  it('the same dates on an exact-day loan flag the late one until it arrives', () => {
    const exact = lending({ dueMode: 'exact' });
    const txs = [repay('2026-09-24'), repay('2026-10-26')];
    expect(loanOutlook(exact, txs, '2026-12-01').missedDates).toEqual(['2026-11-25']);
    expect(loanOutlook(exact, [...txs, repay('2026-12-02')], '2026-12-02').behindBy).toBe(0);
  });

  it('with no set day, nothing is ever missed', () => {
    const o = loanOutlook(lending({ dueMode: 'none' }), [repay('2026-09-24')], '2027-03-01');
    expect(o.behindBy).toBe(0);
    expect(o.nextDueBy).toBeNull();
    expect(o.upcoming).toHaveLength(23); // still projected monthly
  });

  it('the payments still to come always add up to the rest of the term', () => {
    for (const day of ['2026-09-01', '2026-10-28', '2026-11-30']) {
      const txs = [repay('2026-09-24'), repay('2026-10-26')].filter(t => t.date <= day);
      const o = loanOutlook(lending(), txs, day);
      const made = loanState(lending(), txs, day).paymentsMade;
      expect(made + o.paymentsLeft).toBe(24);
      expect(o.leftToPay).toBe(2400 - made * 100);
    }
  });

  it('paying ahead still charges the interest of the months covered', () => {
    // An interest loan, November paid early on Oct 30.
    const l = loan({ dueMode: 'flexible' });
    const txs = [tx({ date: '2026-08-05' }), tx({ date: '2026-09-05' }), tx({ date: '2026-10-05' }), tx({ date: '2026-10-30' })];
    const ahead = loanOutlook(l, txs, '2026-10-31');
    const onTime = loanOutlook(l, txs.slice(0, 3), '2026-10-31');
    expect(ahead.nextDue).toBe('2026-12-05');
    expect(ahead.paymentsLeft).toBe(onTime.paymentsLeft - 1);
    // Same loan, same payments in the end — the lifetime interest barely moves.
    expect(Math.abs(ahead.lifetimeInterest - onTime.lifetimeInterest)).toBeLessThan(5);
  });
});

describe('a loan that started before Trackr could see it', () => {
  // The real case: $17,095.42 at 5% (EMI), 24 months, lent Jul 24 2025, first payment Aug 24.
  const vishal = (over: Partial<LoanTerms> = {}) => loan({
    method: 'reducing', amountFinanced: 17095.42, rate: 5, termMonths: 24, payment: 750,
    startDate: '2025-07-24', firstPaymentDate: '2025-08-24', match: { text: 'vishal' },
    dueMode: 'flexible', lateDays: 10, ...over,
  }, 'loan-given');
  const today = '2026-10-04';
  const plan = schedule(vishal().loan!);
  const planInterest = plan.reduce((s, r) => s + r.interest, 0);

  it('the form\'s figure is the plan: ~$904.55 interest over 24 payments', () => {
    expect(monthlyPayment(17095.42, 5, 24, 'reducing')).toBeCloseTo(750, 0);
    expect(planInterest).toBeCloseTo(904.55, 0);
  });

  it('with no payments linked, the interest already built up counts towards the total', () => {
    const o = loanOutlook(vishal(), [], today);
    const s = loanState(vishal(), [], today);
    expect(s.interestDue).toBeGreaterThan(0);
    expect(o.missedDates).toHaveLength(13); // Sep 24's window is still open
    // Interest in all = paid + built up + still to come. It used to leave out the middle one.
    expect(o.futureInterest).toBeGreaterThan(s.interestDue); // "to come" includes what has built up
    expect(o.lifetimeInterest).toBeCloseTo(s.interestPaid + o.futureInterest, 2);
    expect(o.lifetimeInterest).toBeGreaterThan(planInterest); // being behind costs more
  });

  it('no giant final payment: a backlog carries on at the regular amount', () => {
    const o = loanOutlook(vishal(), [], today);
    expect(Math.max(...o.upcoming.map(r => r.payment))).toBeLessThanOrEqual(750);
    expect(o.paymentsLeft).toBeGreaterThan(10);
    expect(o.upcoming.reduce((s, r) => s + r.payment, 0)).toBeCloseTo(o.leftToPay, 2);
  });

  it('"paid on schedule up to today" picks up where the plan says, with nothing missed', () => {
    const l = vishal({ settledThrough: today });
    const s = loanState(l, [], today);
    const o = loanOutlook(l, [], today);
    expect(s.paymentsMade).toBe(14);
    expect(s.assumedPayments).toBe(14);
    expect(s.owed).toBe(plan[13].balance);
    expect(o.behindBy).toBe(0);
    expect(o.nextDue).toBe('2026-10-24');
    expect(o.paymentsLeft).toBe(10);
    expect(Math.abs(o.lifetimeInterest - planInterest)).toBeLessThan(1); // same as the form
  });

  it('payments after that date are tracked; ones before it aren\'t counted twice', () => {
    const l = vishal({ settledThrough: '2026-09-30' });
    const before = tx({ type: 'income', merchant: 'Zelle from Vishal', amount: 750, date: '2026-09-25' });
    const afterwards = tx({ type: 'income', merchant: 'Zelle from Vishal', amount: 750, date: '2026-10-25' });
    const s = loanState(l, [before, afterwards], '2026-10-26');
    expect(s.paymentsMade).toBe(15);
    expect(s.splits.map(x => x.tx.id)).toEqual([afterwards.id]);
    expect(s.splits[0].n).toBe(15);
  });

  it('the net worth history before that date follows the plan too', () => {
    const l = vishal({ settledThrough: today });
    expect(loanOwedOn(l, [], '2025-12-31')).toBe(plan[4].balance); // after Aug–Dec payments
  });

  it('a statement balance settles the months before it', () => {
    const l = vishal({ corrections: [{ date: '2026-10-01', value: 7300 }] });
    const o = loanOutlook(l, [], today);
    expect(o.behindBy).toBe(0);
    expect(loanState(l, [], today).covered).toBe(14);
    expect(loanState(l, [], today).owed).toBe(7300);
  });
});

describe('early, late and on-time payments split like an EMI table', () => {
  // Vishal: $17,095.42 at 5%, 24 months, first due Aug 24 2025, paid on schedule
  // through Jan 1 2026, then tracked payments of $750 from Jan 2026 to Sep 2026.
  const terms = (): LoanTerms => ({
    method: 'reducing', startDate: '2025-07-24', amountFinanced: 17095.42, rate: 5, termMonths: 24,
    firstPaymentDate: '2025-08-24', payment: 750, match: { text: 'vishal' }, paymentIds: [], ignoredIds: [],
    dueMode: 'flexible', lateDays: 10, settledThrough: '2026-01-01',
  });
  const vishal = (): ManualAsset => ({ id: 'v', name: 'Vishal', type: 'loan-given', valuations: [], createdAt: 0, updatedAt: 0, loan: terms() });
  const pay = (date: string) => tx({ type: 'income', merchant: 'Zelle from Vishal', amount: 750, date });

  /** The textbook table, worked out on its own: interest = balance × r, rounded per row. */
  function table(n: number) {
    let b = 17095.42, interest = 0;
    for (let k = 0; k < n; k++) {
      const i = Math.round(b * (0.05 / 12) * 100) / 100;
      b = Math.round((b - (750 - i)) * 100) / 100;
      interest += i;
    }
    return { balance: b, interest: Math.round(interest * 100) / 100 };
  }

  const onTime = ['2026-01-24', '2026-02-24', '2026-03-24', '2026-04-24', '2026-05-24', '2026-06-24', '2026-07-24', '2026-08-24', '2026-09-24'];
  // Same months, some early (22nd, 23rd) and some late (26th, 2nd of next month).
  const mixed = ['2026-01-22', '2026-02-26', '2026-03-23', '2026-05-02', '2026-05-24', '2026-06-21', '2026-07-26', '2026-08-23', '2026-09-28'];

  it('on time: matches the table — $7,330.92 after 14 (Gemini: $7,330.95)', () => {
    const s = loanState(vishal(), onTime.map(pay), '2026-10-04');
    expect(s.paymentsMade).toBe(14);
    expect(s.principalLeft).toBe(table(14).balance);
    expect(s.principalLeft).toBe(7330.92);
    expect(s.interestPaid).toBe(table(14).interest);
  });

  it('a payment a few days early or late changes nothing', () => {
    const a = loanState(vishal(), onTime.map(pay), '2026-10-04');
    const b = loanState(vishal(), mixed.map(pay), '2026-10-04');
    expect(b.principalLeft).toBe(a.principalLeft);
    expect(b.interestPaid).toBe(a.interestPaid);
    expect(b.splits.map(x => [x.interest, x.principal])).toEqual(a.splits.map(x => [x.interest, x.principal]));
  });

  it('payment #14 splits $33.53 interest / $716.47 principal, as in the table', () => {
    const s = loanState(vishal(), mixed.map(pay), '2026-10-04');
    expect(s.splits[s.splits.length - 1]).toMatchObject({ n: 14, interest: 33.53, principal: 716.47 });
  });

  it('the rest of the loan agrees with the table too', () => {
    const o = loanOutlook(vishal(), mixed.map(pay), '2026-10-04');
    expect(o.paymentsLeft).toBe(10);
    expect(o.nextDue).toBe('2026-10-24');
    const all = schedule(terms());
    const tableInterest = all.reduce((sum, r) => sum + r.interest, 0);
    expect(Math.abs(o.lifetimeInterest - tableInterest)).toBeLessThan(0.05);
  });

  it('a missed month still costs interest; catching up pays both installments', () => {
    const missed = onTime.filter(d => d !== '2026-03-24');
    const behind = loanState(vishal(), missed.map(pay), '2026-04-30');
    const fine = loanState(vishal(), onTime.map(pay), '2026-04-30');
    // April's payment clears March's interest and April's first, so more principal is left.
    expect(behind.principalLeft).toBeGreaterThan(fine.principalLeft);
    // March's payment arrives late, alongside April's.
    const caughtUp = loanState(vishal(), [...missed, '2026-04-28'].map(pay), '2026-10-04');
    // A whole month late costs one month's interest on March's principal (~$3) —
    // unlike a payment a few days off, which costs nothing.
    expect(caughtUp.paymentsMade).toBe(14);
    expect(caughtUp.principalLeft).toBeGreaterThan(7330.92);
    expect(caughtUp.principalLeft - 7330.92).toBeLessThan(4);
  });

  it('paying ahead counts as the next installment, charged once', () => {
    const ahead = loanState(vishal(), [...onTime, '2026-09-30'].map(pay), '2026-10-04');
    expect(ahead.paymentsMade).toBe(15);
    expect(ahead.principalLeft).toBe(table(15).balance);
    const o = loanOutlook(vishal(), [...onTime, '2026-09-30'].map(pay), '2026-10-04');
    expect(o.nextDue).toBe('2026-11-24');
  });
});
