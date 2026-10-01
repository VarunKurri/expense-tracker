import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { Budgets } from './budgets';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { Budget, Category } from '../../models';
import { monthKeyOf } from '../../utils/calendar';
import { addMonths } from '../../utils/calendar';

/**
 * Drives the real Budgets page and form through the clicks that used to lose a
 * budget: Override → Save on a category with only an every-month budget.
 * Firestore is replaced by an in-memory list that serialises like the real
 * service does (undefined fields are dropped).
 */
class FakeBudgets {
  budgets = signal<Budget[]>([]);
  error = signal<string | null>(null);
  private n = 0;
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

const subs: Category = { id: 'subs', name: 'Subscriptions', kind: 'expense', icon: '📺', createdAt: 0 };
const thisMonth = monthKeyOf();

describe('Budgets page', () => {
  let fixture: ComponentFixture<Budgets>;
  let budgets: FakeBudgets;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(text: string): HTMLButtonElement {
    const b = [...el.querySelectorAll('button')].find(x => x.textContent!.trim().startsWith(text));
    if (!b) throw new Error(`No button "${text}"`);
    return b as HTMLButtonElement;
  }

  async function setAmount(v: number) {
    const input = el.querySelector('app-budget-form input[type=number]') as HTMLInputElement;
    input.value = String(v);
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  async function setup(initial: Budget[]) {
    budgets = new FakeBudgets();
    budgets.budgets.set(initial);
    await TestBed.configureTestingModule({
      imports: [Budgets],
      providers: [
        provideRouter([]),
        { provide: BudgetService, useValue: budgets },
        { provide: CategoryService, useValue: { categories: signal([subs]), error: signal(null) } },
        {
          provide: TransactionService,
          useValue: {
            transactions: signal([]),
            effectiveExpenseAmount: (t: { amount: number }) => t.amount,
            reimbursementSurplus: () => 0,
          },
        },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(Budgets);
    el = fixture.nativeElement;
    await settle();
  }

  it('overriding this month keeps the every-month budget for every other month', async () => {
    await setup([{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }]);

    button('Override').click();
    await settle();
    // Starts from the usual amount, on the month being viewed.
    expect((el.querySelector('app-budget-form input[type=number]') as HTMLInputElement).value).toBe('50');
    await setAmount(80);
    button('Add budget').click();
    await settle();

    const all = budgets.budgets();
    expect(all.find(b => b.id === 'subs-d')).toMatchObject({ isDefault: true, amount: 50 });
    expect(all.find(b => !b.isDefault)).toMatchObject({ month: thisMonth, amount: 80 });

    // This month shows the one-off; the months either side still show $50.
    expect(el.querySelector('.card-of')!.textContent).toContain('$80.00');
    expect(el.querySelector('.card-freq')!.textContent).toContain('usually $50');
    for (const m of [addMonths(thisMonth, -1), addMonths(thisMonth, 1)]) {
      fixture.componentInstance.selectedMonth.set(m);
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

    // Not in this month — the page says where it is.
    expect(el.querySelector('.budget-card')).toBeNull();
    expect(el.querySelector('.elsewhere')!.textContent).toContain('Subscriptions has a limit only in');
    (el.querySelector('.elsewhere .link-btn') as HTMLButtonElement).click();
    await settle();
    expect(el.querySelector('.card-freq')!.textContent).toContain('only');

    button('Edit').click();
    await settle();
    button('Every month').click();
    await settle();
    button('Save changes').click();
    await settle();

    expect(budgets.budgets()).toEqual([
      expect.objectContaining({ id: 'subs-d', isDefault: true, amount: 50 }),
    ]);
    expect(budgets.budgets()[0].month).toBeUndefined();
  });

  it('+ New budget on an already-budgeted category edits it instead of duplicating', async () => {
    await setup([{ id: 'subs-d', categoryId: 'subs', amount: 50, isDefault: true, createdAt: 1 }]);
    button('+ New Budget').click();
    await settle();
    const select = el.querySelector('app-budget-form select') as HTMLSelectElement;
    select.value = select.options[1].value;
    select.dispatchEvent(new Event('change'));
    await settle();
    expect(el.textContent).toContain('already has an every-month budget of $50.00');
    await setAmount(65);
    button('Save changes').click();
    await settle();
    expect(budgets.budgets()).toEqual([expect.objectContaining({ id: 'subs-d', amount: 65 })]);
  });
});
