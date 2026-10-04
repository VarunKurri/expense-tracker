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
  });

  it('a loan row on Net worth opens its page', async () => {
    await setup([carLoan()], [], '/net-worth');
    const row = [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('Corolla loan')) as HTMLButtonElement;
    expect(row.textContent).toContain('0 of 60 payments');
    row.click();
    await settle();
    expect(TestBed.inject(Router).url).toBe('/net-worth/loans/loan');
  });
});
