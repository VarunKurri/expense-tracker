import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { NetWorth } from './net-worth';
import { LoanDetail } from './loan-detail/loan-detail';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { CategoryService } from '../../services/category.service';
import { Account, ManualAsset, Transaction } from '../../models';
import { localDateString } from '../../utils/date';
import { schedule } from '../../utils/loans';

/** In-memory stand-in that serialises like the encrypted Firestore service. */
class FakeManual {
  items = signal<ManualAsset[]>([]);
  error = signal<string | null>(null);
  private n = 0;
  async add(m: Omit<ManualAsset, 'id' | 'createdAt' | 'updatedAt'>) {
    const id = `m${++this.n}`;
    this.items.update(all => [...all, JSON.parse(JSON.stringify({ ...m, id, createdAt: 1, updatedAt: 1 }))]);
    return id;
  }
  async update(id: string, patch: Partial<ManualAsset>) {
    this.items.update(all => all.map(m => m.id === id ? JSON.parse(JSON.stringify({ ...m, ...patch })) : m));
  }
  async remove(id: string) { this.items.update(all => all.filter(m => m.id !== id)); }
}

class FakeTransactions {
  transactions = signal<Transaction[]>([]);
  reimbursementsFor() { return []; }
  reimbursedAmountFor() { return 0; }
  effectiveExpenseAmount(t: Transaction) { return t.amount; }
  reimbursementSurplus() { return 0; }
  async update() {}
}

@Component({ selector: 'app-transaction-form', standalone: true, template: '' })
class StubTransactionForm {
  open = input(false);
  transaction = input<Transaction | null>(null);
  closed = output<void>();
  saved = output<unknown>();
  deleteRequested = output<void>();
}

const today = localDateString();
const checking: Account = { id: 'chk', name: 'Chase College', type: 'checking', openingBalance: 5000, currency: 'USD', createdAt: 0 };

/** A car loan that started 3 months before `today`, first payment a month later. */
function monthsAgo(n: number, day = 5): string {
  const d = new Date();
  const t = new Date(d.getFullYear(), d.getMonth() - n, day);
  return localDateString(t);
}
const carLoan = (over: Partial<ManualAsset> = {}): ManualAsset => ({
  id: 'loan', name: 'Corolla loan', type: 'auto-loan', valuations: [], createdAt: 1, updatedAt: 1,
  loan: {
    method: 'reducing', startDate: monthsAgo(3), amountFinanced: 18000, rate: 4.2, termMonths: 60,
    firstPaymentDate: monthsAgo(2), payment: 333.12, counterparty: 'Toyota Financial',
    match: { text: 'toyota financial' }, paymentIds: [], ignoredIds: [],
  },
  ...over,
});
const pay = (id: string, date: string, amount = 333.12): Transaction =>
  ({ id, type: 'expense', amount, date, merchant: 'TOYOTA FINANCIAL SVCS', accountId: 'chk', createdAt: 0, updatedAt: 0 } as Transaction);

describe('Loans', () => {
  let harness: RouterTestingHarness;
  let manual: FakeManual;
  let txs: FakeTransactions;
  let el: HTMLElement;

  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
    el = harness.routeNativeElement as HTMLElement;
  }

  function button(text: string, root: ParentNode = document.body): HTMLButtonElement {
    const b = [...root.querySelectorAll('button')].find(x => x.textContent!.trim().startsWith(text));
    if (!b) throw new Error(`No button "${text}"`);
    return b as HTMLButtonElement;
  }

  function fill(selector: string, value: string) {
    const input = document.querySelector(`app-asset-form ${selector}`) as HTMLInputElement | HTMLSelectElement;
    if (!input) throw new Error(`No field ${selector}`);
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
  }

  async function setup(items: ManualAsset[], transactions: Transaction[], url: string) {
    manual = new FakeManual();
    manual.items.set(items);
    txs = new FakeTransactions();
    txs.transactions.set(transactions);
    TestBed.overrideComponent(LoanDetail, { remove: { imports: [TransactionForm] }, add: { imports: [StubTransactionForm] } });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'net-worth', component: NetWorth },
          { path: 'net-worth/loans/:id', component: LoanDetail },
        ]),
        provideLocationMocks(),
        { provide: AccountService, useValue: { accounts: signal([checking]) } },
        { provide: TransactionService, useValue: txs },
        { provide: ManualAssetService, useValue: manual },
        { provide: CategoryService, useValue: { categories: signal([]), error: signal(null) } },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    await settle();
  }

  const figure = () => el.querySelector('.hero-figure .num-display')!.textContent!.trim();

  it('adding a car loan adds the car too, so buying on finance doesn\'t look like a loss', async () => {
    await setup([], [], '/net-worth');
    button('+ Add asset or debt').click();
    await settle();
    fill('select[name=type]', 'auto-loan');
    await settle();
    fill('input[name=name]', 'Corolla loan');
    fill('input[name=price]', '18000');
    fill('input[name=rate]', '4.2');
    fill('input[name=startDate]', today);
    fill('input[name=matchText]', 'Toyota Financial');
    await settle();
    // The live summary: EMI, interest, total.
    expect(document.querySelector('app-asset-form')!.textContent).toContain('$333.12/month');
    button('Add', document.querySelector('app-asset-form')!).click();
    await settle();

    const [loan, car] = manual.items();
    expect(loan.loan).toMatchObject({ amountFinanced: 18000, rate: 4.2, termMonths: 60, payment: 333.12, method: 'reducing' });
    expect(car).toMatchObject({ type: 'vehicle', name: 'Corolla', purchase: { price: 18000, date: today }, depreciationRate: 0.15, linkedId: loan.id });
    expect(loan.linkedId).toBe(car.id);
    // Cash $5,000 + car $18,000 − loan $18,000.
    expect(figure()).toBe('$5,000.00');
  });

  it('a flat rate shows what it really costs', async () => {
    await setup([], [], '/net-worth');
    button('+ Add asset or debt').click();
    await settle();
    fill('select[name=type]', 'personal-loan');
    await settle();
    button('Flat rate', document.querySelector('app-asset-form')!).click();
    fill('input[name=amount]', '18000');
    fill('input[name=rate]', '4.2');
    await settle();
    const text = document.querySelector('app-asset-form')!.textContent!;
    expect(text).toContain('$363.00/month');
    expect(text).toMatch(/about the same as 7\.\d+%/);
  });

  it('the loan page counts payments and splits them into interest and principal', async () => {
    await setup([carLoan()], [pay('p1', monthsAgo(2)), pay('p2', monthsAgo(1))], '/net-worth/loans/loan');
    expect(el.querySelector('.bar-labels')!.textContent).toContain('2 of 60 payments');
    expect(el.querySelector('.card-label')!.textContent).toContain('Owed to Toyota Financial');
    const first = [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('#1'))!;
    expect(first.textContent).toContain('$63.00 interest');
    expect(first.textContent).toContain('$270.12 principal');
    expect(el.querySelector('.stats')!.textContent).toContain('Left to pay');
  });

  it('a missing month shows up, and linking a payment by hand fills it', async () => {
    const odd = { ...pay('zelle', monthsAgo(1, 6), 340), merchant: 'Online payment' };
    await setup([carLoan()], [pay('p1', monthsAgo(2)), odd], '/net-worth/loans/loan');
    expect(el.querySelector('.hero-sentence')!.textContent).toContain("hasn't shown up yet");
    expect(el.querySelector('.row.missed')).not.toBeNull();

    button('Link it', el).click();
    await settle();
    button('Online payment').click();
    await settle();
    expect(manual.items()[0].loan!.paymentIds).toEqual(['zelle']);
    expect(el.querySelector('.row.missed')).toBeNull();
    expect(el.querySelector('.bar-labels')!.textContent).toContain('2 of 60 payments');
  });

  it('opens the shared transaction view, which shows the loan split and can unlink it', async () => {
    await setup([carLoan()], [pay('p1', monthsAgo(2))], '/net-worth/loans/loan');
    (el.querySelector('.row-open') as HTMLButtonElement).click();
    await settle();
    const view = document.querySelector('app-transaction-view')!;
    expect(view.textContent).toContain('Corolla loan');
    expect(view.textContent).toContain('payment 1 of 60');
    expect(view.textContent).toContain('$63.00 interest');
    button('Unlink', view).click();
    await settle();
    // It was matched automatically, so un-linking remembers to ignore it.
    expect(manual.items()[0].loan!.ignoredIds).toEqual(['p1']);
  });

  it('Dad\'s loan repaid to you is tracked but leaves your net worth alone', async () => {
    const dads: ManualAsset = {
      id: 'dad', name: "Ravi's loan (Dad's)", type: 'loan-given', valuations: [], createdAt: 1, updatedAt: 1,
      loan: {
        owedTo: 'someone-else', method: 'none', startDate: monthsAgo(3), amountFinanced: 2400, rate: 0,
        termMonths: 24, firstPaymentDate: monthsAgo(2), payment: 100, match: { text: 'ravi' },
        paymentIds: [], ignoredIds: [],
      },
    };
    const pocketMoney = { id: 'r1', type: 'income', amount: 100, date: monthsAgo(2), merchant: 'Zelle from Ravi', accountId: 'chk', createdAt: 0, updatedAt: 0 } as Transaction;
    await setup([dads], [pocketMoney], '/net-worth');
    // Cash went up by the $100 pocket money; nothing else changes.
    expect(figure()).toBe('$5,100.00');
    expect(el.querySelector('.tracked')!.textContent).toContain('1 of 24 payments');
    expect(el.querySelector('.tracked')!.textContent).toContain('$2,300.00 to go');

    await harness.navigateByUrl('/net-worth/loans/dad');
    await settle();
    expect(el.textContent).toContain('Tracked, not counted');
    expect(el.querySelector('.bar-labels')!.textContent).toContain('1 of 24 payments');
    // No cost card for money lent: the balance button sits with the payments, not on its own.
    expect(el.querySelector('.list-head')!.textContent).toContain('Enter the balance');
    expect(el.querySelector('.cost-actions')).toBeNull();
  });

  it('a loan row on Net worth opens its page', async () => {
    await setup([carLoan()], [], '/net-worth');
    const row = [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('Corolla loan')) as HTMLButtonElement;
    expect(row.textContent).toContain('0 of 60 payments');
    row.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/net-worth/loans/loan');
  });

  // ── Payments that don't land on the same day ───────────────
  /** A due date a few days ago (day ≤ 28, so "a month earlier" always exists). */
  function recentDue(): { due: string; first: string } {
    const d = new Date();
    d.setDate(d.getDate() - 3);
    while (d.getDate() > 28) d.setDate(d.getDate() - 1);
    const first = new Date(d.getFullYear(), d.getMonth() - 1, d.getDate());
    return { due: localDateString(d), first: localDateString(first) };
  }
  const lent = (over: Partial<NonNullable<ManualAsset['loan']>>): ManualAsset => ({
    id: 'lent', name: 'Loan to Ravi', type: 'loan-given', valuations: [], createdAt: 1, updatedAt: 1,
    loan: {
      owedTo: 'me', method: 'none', startDate: monthsAgo(3), amountFinanced: 2400, rate: 0, termMonths: 24,
      firstPaymentDate: monthsAgo(1), payment: 100, match: { text: 'ravi' }, paymentIds: [], ignoredIds: [],
      ...over,
    },
  });
  const fromRavi = (id: string, date: string): Transaction =>
    ({ id, type: 'income', amount: 100, date, merchant: 'Zelle from Ravi', accountId: 'chk', createdAt: 0, updatedAt: 0 } as Transaction);

  it('a payment a few days past its date is "on its way", not missed, when dates vary', async () => {
    const { first } = recentDue();
    await setup([lent({ firstPaymentDate: first, startDate: monthsAgo(3), dueMode: 'flexible', lateDays: 10 })],
      [fromRavi('r1', first)], '/net-worth/loans/lent');
    expect(el.querySelector('.row.missed')).toBeNull();
    expect(el.querySelector('.hero-sentence')!.textContent).toContain('is on its way');
    expect(el.querySelector('.bar-labels')!.textContent).toContain('Varies (up to 10 days late)');
    const firstUpcoming = el.querySelector('.ahead .row-name')!.textContent!;
    expect(firstUpcoming).toContain('Around');
    expect(firstUpcoming).toContain('on its way');
  });

  it('the same payment on an exact-day loan is flagged once its 5 days pass', async () => {
    const d = new Date(); d.setDate(d.getDate() - 8);
    while (d.getDate() > 28) d.setDate(d.getDate() - 1);
    const first = localDateString(new Date(d.getFullYear(), d.getMonth() - 1, d.getDate()));
    await setup([lent({ firstPaymentDate: first, dueMode: 'exact' })], [fromRavi('r1', first)], '/net-worth/loans/lent');
    expect(el.querySelector('.row.missed')).not.toBeNull();
  });

  it('with no set day, nothing is ever flagged', async () => {
    await setup([lent({ firstPaymentDate: monthsAgo(6), startDate: monthsAgo(7), dueMode: 'none' })],
      [fromRavi('r1', monthsAgo(5))], '/net-worth/loans/lent');
    expect(el.querySelector('.row.missed')).toBeNull();
    expect(el.querySelector('.hero-sentence')!.textContent).toContain('1 of 24 payments in so far, roughly monthly');
  });

  it('money lent defaults to "Varies", and the form saves the window', async () => {
    await setup([], [], '/net-worth');
    button('+ Add asset or debt').click();
    await settle();
    fill('select[name=type]', 'loan-given');
    await settle();
    fill('input[name=name]', 'Loan to Ravi');
    button('No interest', document.querySelector('app-asset-form')!).click();
    fill('input[name=amount]', '2400');
    fill('input[name=startDate]', monthsAgo(1));
    await settle();
    fill('input[name=lateDays]', '8');
    await settle();
    button('Add', document.querySelector('app-asset-form')!).click();
    await settle();
    expect(manual.items()[0].loan).toMatchObject({ dueMode: 'flexible', lateDays: 8, method: 'none', amountFinanced: 2400 });
  });

  // ── A loan that began before Trackr could see it (the Vishal case) ──
  const vishal = (over: Partial<NonNullable<ManualAsset['loan']>> = {}): ManualAsset => ({
    id: 'v', name: 'Loan to Vishal', type: 'loan-given', valuations: [], createdAt: 1, updatedAt: 1,
    loan: {
      owedTo: 'someone-else', method: 'reducing', startDate: monthsAgo(15, 24), amountFinanced: 17095.42, rate: 5,
      termMonths: 24, firstPaymentDate: monthsAgo(14, 24), payment: 750, counterparty: 'Vishal',
      match: { text: 'vishal' }, paymentIds: [], ignoredIds: [], dueMode: 'flexible', lateDays: 10, ...over,
    },
  });

  it('with nothing linked, it offers to mark the past as paid on schedule, and folds the missing months', async () => {
    await setup([vishal()], [], '/net-worth/loans/v');
    expect(el.querySelector('.settle-prompt')!.textContent).toContain("payments aren't linked");
    expect(el.querySelectorAll('.row.missed').length).toBe(3);
    expect(el.querySelector('.list .show-all')!.textContent).toContain('missing');
    // The owed figure explains why it's above the amount lent.
    expect(el.querySelector('.hero-note')!.textContent).toContain('interest that has built up');
    // No giant final payment.
    const amounts = [...el.querySelectorAll('.ahead .row-amount')].map(e => Number(e.textContent!.replace(/[$,]/g, '')));
    expect(Math.max(...amounts)).toBeLessThanOrEqual(750);
  });

  it('"received on schedule up to today" lines the page up with the plan', async () => {
    await setup([vishal()], [], '/net-worth/loans/v');
    button('Received on schedule up to today', el).click();
    await settle();
    expect(manual.items()[0].loan!.settledThrough).toBe(today);
    expect(el.querySelector('.row.missed')).toBeNull();
    expect(el.querySelector('.settle-prompt')).toBeNull();
    expect(el.querySelector('.hero-note')).toBeNull();
    expect(el.querySelector('.bar-labels')!.textContent).toMatch(/1[34] of 24 payments/);
    expect(el.querySelector('.list')!.textContent).toContain('received on schedule');
    // Interest in all now matches what the form promised.
    const planInterest = schedule(vishal().loan!).reduce((sum, r) => sum + r.interest, 0);
    const shown = Number(el.querySelectorAll('.stat .stat-value')[2].textContent!.replace(/[$,]/g, ''));
    expect(Math.abs(shown - planInterest)).toBeLessThan(1);

    button('Undo', el).click();
    await settle();
    expect(manual.items()[0].loan!.settledThrough).toBeUndefined();
  });

  // ── Lump sums and the penalty waiver ───────────────────────
  const lumpModal = () => [...document.querySelectorAll('app-modal')].find(m => m.textContent!.includes('Lower the monthly payment'))!;

  async function linkBigPayment() {
    const big = { ...pay('big', monthsAgo(1, 15), 3000), merchant: 'Online payment' };
    await setup([carLoan()], [pay('p1', monthsAgo(2)), pay('p2', monthsAgo(1)), big], '/net-worth/loans/loan');
    button('+ Link a payment', el).click();
    await settle();
    const search = document.querySelector('app-modal input[type=search]') as HTMLInputElement;
    search.value = '3000';
    search.dispatchEvent(new Event('input'));
    await settle();
    button('Online payment').click();
    await settle();
  }

  it('linking a payment well above the usual asks what the lump sum should change', async () => {
    await linkBigPayment();
    const modal = lumpModal();
    expect(modal).toBeTruthy();
    expect(modal.textContent).toContain('Finish sooner');
    // Paid in the same month as the regular payment, so it starts as "on top".
    expect(modal.querySelector('.toggle')!.classList).toContain('on');

    button('Lower the monthly payment', modal).click();
    await settle();
    button('Save', modal).click();
    await settle();
    const loan = manual.items()[0].loan!;
    expect(loan.lumpSums).toEqual([{ txId: 'big', mode: 'reduce-emi', onTop: true }]);
    expect(loan.paymentIds).toContain('big');
    // Still 60 payments; each one smaller now.
    const labels = el.querySelector('.bar-labels')!.textContent!;
    expect(labels).toContain('2 of 60 payments');
    expect(labels).not.toContain('$333.12/mo');
    const row = [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('Online payment'))!;
    expect(row.textContent).toContain('Extra');
    expect(row.textContent).toContain('Lump sum · payment lowered to');
  });

  it('or keeps the payment and finishes sooner', async () => {
    await linkBigPayment();
    const modal = lumpModal();
    button('Finish sooner', modal).click();
    await settle();
    button('Save', modal).click();
    await settle();
    const labels = el.querySelector('.bar-labels')!.textContent!;
    expect(labels).toContain('$333.12/mo');
    const total = Number(labels.match(/2 of (\d+) payments/)![1]);
    expect(total).toBeLessThan(60);
    expect(total).toBeGreaterThan(45);

    // Changing your mind: back to an ordinary payment.
    const row = [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('Online payment'))!;
    button('Change', row).click();
    await settle();
    button('Not a lump sum', lumpModal()).click();
    await settle();
    expect(manual.items()[0].loan!.lumpSums).toEqual([]);
  });

  it('the penalty waiver is a choice in the form, and shows on the loan page', async () => {
    await setup([vishal({ owedTo: 'me' })], [], '/net-worth/loans/v');
    button('Edit loan', el).click();
    await settle();
    const form = document.querySelector('app-asset-form')!;
    expect(form.textContent).toContain('Penalty waiver');
    (form.querySelector('[aria-label="Count every payment as on time"]') as HTMLButtonElement).click();
    await settle();
    button('Save changes', form).click();
    await settle();
    expect(manual.items()[0].loan!.onSchedule).toBe(true);
    expect(el.querySelector('.hero-top')!.textContent).toContain('Penalty waived');
    // Nothing builds up between payments while it's waived.
    expect(el.querySelector('.hero-note')).toBeNull();
  });
});
