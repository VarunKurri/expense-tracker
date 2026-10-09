import { Component, input, output, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { RouterTestingHarness } from '@angular/router/testing';
import { provideLocationMocks } from '@angular/common/testing';
import { Location } from '@angular/common';
import { Budgets } from './budgets';
import { BudgetDetail } from './budget-detail/budget-detail';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { Budget, Category, Transaction } from '../../models';
import { MoneyBackLedger } from '../../utils/money-back';
import { PersonService } from '../../services/person.service';
import { personName } from '../../utils/splits';
import { addMonths, monthKeyOf } from '../../utils/calendar';

/**
 * Drives the real Budgets and budget-detail pages through the router.
 * Firestore is replaced by in-memory lists that serialise like the real
 * services (undefined fields are dropped).
 */
class FakeBudgets {
  budgets = signal<Budget[]>([]);
  error = signal<string | null>(null);
  private n = 0;
  getBudgetForCategory(categoryId: string, month: string) {
    const all = this.budgets();
    return all.find(b => b.categoryId === categoryId && !b.isDefault && b.month === month)
      ?? all.find(b => b.categoryId === categoryId && b.isDefault) ?? null;
  }
  async add(b: Omit<Budget, 'id' | 'createdAt'>) {
    this.budgets.update(all => [...all, { ...b, id: `new-${++this.n}`, createdAt: Date.now() }]);
  }
  async update(id: string, patch: Partial<Budget>) {
    this.budgets.update(all => all.map(b => b.id === id ? JSON.parse(JSON.stringify({ ...b, ...patch })) : b));
  }
  async remove(id: string) {
    this.budgets.update(all => all.filter(b => b.id !== id));
  }
}

/** Just enough of TransactionService. Money back (refunds, reimbursements) is the
 *  real logic, inherited, not a copy that could drift from what the app does. */
class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
  async update() {}
  async remove() {}
}

/** The real form pulls in Firestore-backed services; it is closed in these tests anyway. */
@Component({ selector: 'app-transaction-form', standalone: true, template: '' })
class StubTransactionForm {
  open = input(false);
  transaction = input<Transaction | null>(null);
  closed = output<void>();
  saved = output<unknown>();
  deleteRequested = output<void>();
}

const subs: Category = { id: 'subs', name: 'Subscriptions', kind: 'expense', icon: '📺', createdAt: 0 };
const dining: Category = { id: 'dining', name: 'Dining', kind: 'expense', icon: '🍽️', createdAt: 0 };
const thisMonth = monthKeyOf();
const lastMonth = addMonths(thisMonth, -1);

describe('Budgets', () => {
  let harness: RouterTestingHarness;
  let budgets: FakeBudgets;
  let txs: FakeTransactions;
  let el: HTMLElement;

  async function settle() {
    harness.detectChanges();
    await harness.fixture.whenStable();
    harness.detectChanges();
  }

  function button(text: string, root: ParentNode = el): HTMLButtonElement {
    const b = [...root.querySelectorAll('button')].find(x => x.textContent!.trim().startsWith(text));
    if (!b) throw new Error(`No button "${text}"`);
    return b as HTMLButtonElement;
  }

  async function setAmount(v: number) {
    const input = el.querySelector('app-budget-form input[type=number]') as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function setup(initial: Budget[], transactions: Transaction[] = [], url = '/budgets') {
    budgets = new FakeBudgets();
    budgets.budgets.set(initial);
    txs = new FakeTransactions();
    txs.transactions.set(transactions);
    TestBed.overrideComponent(BudgetDetail, {
      remove: { imports: [TransactionForm] },
      add: { imports: [StubTransactionForm] },
    });
    TestBed.configureTestingModule({
      providers: [
        provideRouter([
          { path: 'budgets', component: Budgets },
          { path: 'budgets/:categoryId/:month', component: BudgetDetail },
        ]),
        provideLocationMocks(),
        { provide: BudgetService, useValue: budgets },
        { provide: CategoryService, useValue: { categories: signal([subs, dining]), error: signal(null) } },
        { provide: TransactionService, useValue: txs },
        { provide: PersonService, useValue: { people: signal([]), nameOf: (id: string) => personName([], id) } },
        { provide: AccountService, useValue: { accounts: signal([]) } },
        { provide: ManualAssetService, useValue: { items: signal([]), error: signal(null) } },
      ],
    });
    harness = await RouterTestingHarness.create();
    await harness.navigateByUrl(url);
    el = harness.routeNativeElement as HTMLElement;
    await settle();
  }

  function url() { return TestBed.inject(Router).url; }

  // ── The override bug (part 72) ─────────────────────────────

  it('overriding this month keeps the every-month budget for every other month', async () => {
    await setup([{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }]);

    button('Override').click();
    await settle();
    expect((el.querySelector('app-budget-form input[type=number]') as HTMLInputElement).value).toBe('50');
    await setAmount(80);
    button('Add budget').click();
    await settle();

    const all = budgets.budgets();
    expect(all.find(b => b.id === 'subs-d')).toMatchObject({ isDefault: true, amount: 50 });
    expect(all.find(b => !b.isDefault)).toMatchObject({ month: thisMonth, amount: 80 });
    expect(el.querySelector('.card-of')!.textContent).toContain('$80.00');
    expect(el.querySelector('.card-freq')!.textContent).toContain('usually $50');

    for (const m of [lastMonth, addMonths(thisMonth, 1)]) {
      await harness.navigateByUrl(`/budgets?month=${m}`);
      await settle();
      expect(el.querySelector('.card-of')!.textContent).toContain('$50.00');
      expect(el.querySelector('.card-freq')!.textContent).toContain('Every month');
    }
  });

  it('removing the one-off puts the month back on the every-month limit', async () => {
    await setup([
      { id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 },
      { id: 'subs-o', categoryId: 'subs', amount: 80, isDefault: false, month: thisMonth, createdAt: 2 },
    ]);
    button('Edit').click();
    await settle();
    button('Remove').click();
    await settle();
    expect(el.textContent).toContain('goes back to the every-month limit of $50.00');
    button('Remove').click(); // the confirm dialog's button
    await settle();
    expect(budgets.budgets().map(b => b.id)).toEqual(['subs-d']);
  });

  it('a budget the old bug left as a one-off shows up and can be made every-month again', async () => {
    const stranded = addMonths(thisMonth, 1);
    await setup([{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: false, month: stranded, createdAt: 1 }]);

    expect(el.querySelector('.budget-card')).toBeNull();
    expect(el.querySelector('.elsewhere')!.textContent).toContain('Subscriptions has a limit only in');
    (el.querySelector('.elsewhere .link-btn') as HTMLButtonElement).click();
    await settle();
    expect(url()).toContain(`month=${stranded}`);
    expect(el.querySelector('.card-freq')!.textContent).toContain('only');

    button('Edit').click();
    await settle();
    button('Every month').click();
    await settle();
    button('Save changes').click();
    await settle();

    expect(budgets.budgets()).toEqual([expect.objectContaining({ id: 'subs-d', isDefault: true, amount: 50 })]);
    expect(budgets.budgets()[0].month).toBeUndefined();
  });

  it('+ New budget on an already-budgeted category edits it instead of duplicating', async () => {
    await setup([{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }]);
    button('+ New budget').click();
    await settle();
    const select = el.querySelector('app-budget-form select') as HTMLSelectElement;
    select.value = [...select.options].find(o => o.textContent!.includes('Subscriptions'))!.value;
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(el.textContent).toContain('already has an every-month budget of $50.00');
    await setAmount(65);
    button('Save changes').click();
    await settle();
    expect(budgets.budgets()).toEqual([expect.objectContaining({ id: 'subs-d', amount: 65 })]);
  });

  // ── Month picker and coming back ───────────────────────────

  it('reaches any earlier month and keeps it in the URL', async () => {
    const longAgo = addMonths(thisMonth, -14);
    await setup(
      [{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }],
      [{ id: 'old', type: 'expense', amount: 9, date: `${longAgo}-03`, categoryId: 'subs', createdAt: 0 } as Transaction],
    );
    // Open the grid, go back a year, pick the month.
    (el.querySelector('app-month-picker .label-btn') as HTMLButtonElement).click();
    await settle();
    el.querySelector<HTMLButtonElement>('app-month-picker [aria-label="Previous year"]')!.click();
    await settle();
    if (longAgo.slice(0, 4) !== String(Number(thisMonth.slice(0, 4)) - 1)) {
      el.querySelector<HTMLButtonElement>('app-month-picker [aria-label="Previous year"]')!.click();
      await settle();
    }
    const name = new Date(longAgo + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short' });
    button(name, el.querySelector('app-month-picker .grid')!).click();
    await settle();

    expect(url()).toContain(`month=${longAgo}`);
    expect(el.querySelector('.card-spent')!.textContent).toContain('$9.00');
  });

  it('"← Budgets" on a budget returns to the month you were viewing', async () => {
    await setup(
      [{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }],
      [], `/budgets?month=${lastMonth}`,
    );
    (el.querySelector('.budget-card') as HTMLElement).click();
    await settle();
    expect(url()).toContain(`/budgets/subs/${lastMonth}`);

    el = harness.routeNativeElement as HTMLElement;
    const loc = TestBed.inject(Location);
    button('← Budgets').click();
    await settle();
    // It steps back in history, to the same entry the browser's Back returns to.
    // (The mock location doesn't fire popstate, so load that entry by hand.)
    expect(loc.path()).toBe(`/budgets?month=${lastMonth}`);
    await harness.navigateByUrl(loc.path());
    await settle();
    el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('app-month-picker .label-btn')!.textContent).toContain(
      new Date(lastMonth + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }));
  });

  it('"← Budgets" from a link elsewhere still opens Budgets on that month', async () => {
    await setup([{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }],
      [], `/budgets/subs/${lastMonth}`);
    button('← Budgets').click();
    await settle();
    expect(url()).toBe(`/budgets?month=${lastMonth}`);
  });

  // ── Detail: net amounts and the shared transaction view ────

  const dinner: Transaction = {
    id: 'dinner', type: 'expense', amount: 120, date: `${thisMonth}-02`, categoryId: 'dining',
    merchant: 'Ramen Bar', createdAt: 0,
  } as Transaction;
  const payback: Transaction = {
    id: 'payback', type: 'income', amount: 80, date: `${thisMonth}-03`, reimbursesId: 'dinner',
    merchant: 'Venmo', createdAt: 0,
  } as Transaction;
  const refunded: Transaction = {
    id: 'tent', type: 'expense', amount: 176.84, date: `${thisMonth}-04`, categoryId: 'dining',
    merchant: 'Walmart', refunded: true, createdAt: 0,
  } as Transaction;
  const diningBudget: Budget = { id: 'd', categoryId: 'dining', amount: 300, isDefault: true, createdAt: 1 };

  it('excluding refunded counts reimbursed purchases at their net amount, on the card and inside', async () => {
    await setup([diningBudget], [dinner, payback, refunded]);
    expect(el.querySelector('.card-spent')!.textContent).toContain('$40.00');

    (el.querySelector('.budget-card') as HTMLElement).click();
    await settle();
    el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('.hero-figure')!.textContent).toContain('$40.00');
    const row = [...el.querySelectorAll('.tx-row')].find(r => r.textContent!.includes('Ramen Bar'))!;
    expect(row.querySelector('.tx-amount')!.textContent).toContain('$40.00');
    expect(row.textContent).toContain('$80.00 back');
    expect(el.querySelector('.hero-note')!.textContent).toContain('$80.00 was paid back');
    // Refunded: listed but not counted.
    const tent = [...el.querySelectorAll('.tx-row')].find(r => r.textContent!.includes('Walmart'))!;
    expect(tent.classList).toContain('excluded');
    expect(el.querySelector('.stats-row')!.textContent).toContain('1'); // one counted transaction
  });

  it('including refunded counts everything at full price', async () => {
    await setup([diningBudget], [dinner, payback, refunded], '/budgets?excludeRefunded=false');
    expect(el.querySelector('.card-spent')!.textContent).toContain('$296.84');
    (el.querySelector('.budget-card') as HTMLElement).click();
    await settle();
    el = harness.routeNativeElement as HTMLElement;
    expect(el.querySelector('.hero-figure')!.textContent).toContain('$296.84');
  });

  it('opens the shared transaction view, with reimbursements', async () => {
    await setup([diningBudget], [dinner, payback], `/budgets/dining/${thisMonth}`);
    (el.querySelector('.tx-row') as HTMLElement).click();
    await settle();
    const view = el.querySelector('app-transaction-view')!;
    expect(view.textContent).toContain('Ramen Bar');
    expect(view.textContent).toContain('Money back');
    expect(view.textContent).toContain('Out of pocket $40.00');
    expect(view.textContent).toContain('$80.00');
    expect(view.textContent).toContain('Link income');
    // The old hand-built panel is gone: the only view is the shared one.
    expect([...el.querySelectorAll('.view-panel')].every(p => p.closest('app-transaction-view'))).toBe(true);
  });
});
