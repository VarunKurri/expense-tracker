import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionView } from './transaction-view';
import { TransactionService } from '../../services/transaction.service';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { ToastService } from '../../services/toast.service';
import { Transaction } from '../../models';
import { MoneyBackLedger } from '../../utils/money-back';
import { ME } from '../../models';
import { quickSplit, splitStatus } from '../../utils/splits';
import { PersonService } from '../../services/person.service';
import { personName } from '../../utils/splits';

/** The real money-back logic; updates are applied the way Firestore would (undefined dropped). */
class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
  async update(id: string, patch: Partial<Transaction>) {
    this.transactions.update(all => all.map(t => t.id === id ? JSON.parse(JSON.stringify({ ...t, ...patch })) : t));
  }
}

const friends = signal([
  { id: 'alex', name: 'Alex', createdAt: 0, updatedAt: 0 },
  { id: 'ben', name: 'Ben', createdAt: 0, updatedAt: 0 },
  { id: 'cara', name: 'Cara', createdAt: 0, updatedAt: 0 },
]);

const haircut: Transaction = {
  id: 'cut', type: 'expense', amount: 46, date: '2026-10-04', merchant: 'In 2 Cuts',
  accountId: 'card', createdAt: 0, updatedAt: 0,
};

describe('TransactionView — money back', () => {
  let txs: FakeTransactions;
  let fixture: ComponentFixture<TransactionView>;
  let el: HTMLElement;

  async function open(t: Transaction, others: Transaction[] = []) {
    txs.transactions.set([t, ...others]);
    fixture = TestBed.createComponent(TransactionView);
    fixture.componentRef.setInput('transaction', t);
    await settle();
  }

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    el = document.body;
  }

  const button = (text: string) =>
    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === text) as HTMLButtonElement;
  const view = () => fixture.nativeElement.querySelector('.view-panel') as HTMLElement;

  async function typeAmount(value: string) {
    const input = document.getElementById('mb-amount') as HTMLInputElement;
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }

  beforeEach(() => {
    txs = new FakeTransactions();
    TestBed.configureTestingModule({
      imports: [TransactionView],
      providers: [
        provideRouter([]),
        { provide: TransactionService, useValue: txs },
        { provide: PersonService, useValue: { people: friends, nameOf: (id: string) => personName(friends(), id) } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        { provide: AccountService, useValue: { accounts: signal([]) } },
        { provide: ManualAssetService, useValue: { items: signal([]) } },
        { provide: ToastService, useValue: { success() {}, error() {} } },
      ],
    });
  });

  it('offers two actions', async () => {
    await open(haircut);
    const actions = [...view().querySelectorAll('.money-back-actions button')].map(b => b.textContent!.trim());
    expect(actions).toEqual(['+ Add money back', '+ Link income']);
  });

  it('"The full amount" needs no amount or date, and the purchase reads as refunded', async () => {
    await open(haircut);
    button('+ Add money back').click();
    await settle();
    expect(el.textContent).toContain('The full amount ($46.00)');
    (el.querySelector('[role="switch"]') as HTMLElement).click();
    await settle();
    expect(document.getElementById('mb-amount')).toBeNull();
    expect(document.getElementById('mb-date')).toBeNull();
    button('Save').click();
    await settle();

    const saved = txs.transactions()[0];
    expect(saved.moneyBack).toEqual([expect.objectContaining({ source: 'refund', amountCents: 4600 })]);
    expect(txs.isFullyRefunded(saved)).toBe(true);
    expect(view().textContent).toContain('Refunded in full');
  });

  it('with some already back, it offers "The rest" — never more than is still out of pocket', async () => {
    const venmo: Transaction = { id: 'v', type: 'income', amount: 20, date: '2026-10-05', merchant: 'Venmo', reimbursesId: 'cut', createdAt: 0, updatedAt: 0 };
    await open(haircut, [venmo]);
    button('+ Add money back').click();
    await settle();
    expect(el.textContent).toContain('The rest ($26.00)');
    (el.querySelector('[role="switch"]') as HTMLElement).click();
    await settle();
    button('Save').click();
    await settle();

    const saved = txs.transactions().find(t => t.id === 'cut')!;
    expect(saved.moneyBack![0].amountCents).toBe(2600);
    expect(txs.effectiveExpenseAmount(saved)).toBe(0);
    expect(txs.reimbursementSurplus(saved)).toBe(0);
  });

  it('a partial amount is netted', async () => {
    await open(haircut);
    button('+ Add money back').click();
    await settle();
    await typeAmount('10');
    button('Save').click();
    await settle();
    expect(view().textContent).toContain('$10.00 back of $46.00');
    expect(view().textContent).toContain('Out of pocket $36.00');
  });

  it('"The full amount" as a repayment pays it back without calling it refunded', async () => {
    await open(haircut);
    button('+ Add money back').click();
    await settle();
    button('Repayment').click();
    await settle();
    expect(el.textContent).toContain('You were paid back for all of it.');
    (el.querySelector('[role="switch"]') as HTMLElement).click();
    await settle();
    button('Save').click();
    await settle();

    const saved = txs.transactions()[0];
    expect(saved.moneyBack).toEqual([expect.objectContaining({ source: 'repayment', amountCents: 4600 })]);
    expect(txs.isFullyRefunded(saved)).toBe(false);
    expect(txs.effectiveExpenseAmount(saved)).toBe(0);
    expect(view().textContent).toContain('↩ Repayment · +$46.00');
  });

  it('linking an income asks refund or repayment — repayment by default', async () => {
    const venmo: Transaction = { id: 'v', type: 'income', amount: 46, date: '2026-10-05', merchant: 'Venmo', createdAt: 0, updatedAt: 0 };
    await open(haircut, [venmo]);
    button('+ Link income').click();
    await settle();
    expect(button('Repayment').getAttribute('aria-checked')).toBe('true');
    button('Refund').click();
    await settle();
    (el.querySelector('.link-item') as HTMLElement).click();
    await settle();

    const linked = txs.transactions().find(t => t.id === 'v')!;
    expect(linked.reimbursesId).toBe('cut');
    expect(linked.moneyBackInfo?.source).toBe('refund');
    expect(txs.isFullyRefunded(txs.transactions()[0])).toBe(true);
  });

  describe('on a split bill', () => {
    // $240 dinner, four ways: you, Alex, Ben, Cara — $60 each.
    const dinner: Transaction = { ...haircut, id: 'dinner', amount: 240, merchant: 'Ramen Bar', split: quickSplit(24000, [ME, 'alex', 'ben', 'cara']) };
    const rows = () => [...view().querySelectorAll('.split-person')].map(r =>
      [...r.querySelectorAll('.split-person-name, .split-person-detail, .split-state, .split-close')]
        .map(e => e.textContent!.trim()).join(' '));
    const saved = () => txs.transactions().find(t => t.id === 'dinner')!;
    const status = () => splitStatus(saved().split!, txs.moneyBackEntriesFor(saved()));

    it('shows each person: what they owe, and their state', async () => {
      await open(dinner);
      expect(rows()).toEqual([
        "Alex Owes $60.00 Owed Won't be repaid",
        "Ben Owes $60.00 Owed Won't be repaid",
        "Cara Owes $60.00 Owed Won't be repaid",
      ]);
      expect(view().textContent).toContain('Your share is $60.00.');
      expect(view().textContent).toContain('$180.00 is still owed to you');
    });

    it('tapping someone records a repayment from them, filled in with what they owe', async () => {
      await open(dinner);
      (view().querySelector('[aria-label="Record a repayment from Alex"]') as HTMLElement).click();
      await settle();
      expect(button('Repayment').getAttribute('aria-checked')).toBe('true');
      expect((document.getElementById('mb-from') as HTMLSelectElement).value).toBe('alex');
      expect((document.getElementById('mb-amount') as HTMLInputElement).value).toBe('60');
      button('Save').click();
      await settle();

      expect(saved().moneyBack).toEqual([expect.objectContaining({ source: 'repayment', amountCents: 6000, fromPersonId: 'alex', coversPersonIds: ['alex'] })]);
      expect(rows()[0]).toContain('Repaid');
      expect(txs.effectiveExpenseAmount(saved())).toBe(180);
      expect(view().textContent).toContain('↩ Repayment from Alex');
    });

    it('one friend paying for several clears them all', async () => {
      await open(dinner);
      (view().querySelector('[aria-label="Record a repayment from Alex"]') as HTMLElement).click();
      await settle();
      const cover = (name: string) => [...document.querySelectorAll('.cover-chips button')].find(b => b.textContent!.trim() === name) as HTMLElement;
      cover('Ben').click(); await settle();
      cover('Cara').click(); await settle();
      expect((document.getElementById('mb-amount') as HTMLInputElement).value).toBe('180');
      button('Save').click();
      await settle();

      expect(status().people.map(p => p.state)).toEqual(['repaid', 'repaid', 'repaid']);
      expect(view().textContent).toContain('Nobody owes you anything on this.');
      expect(view().textContent).toContain('↩ Repayment from Alex for Alex, Ben, Cara');
      expect(txs.effectiveExpenseAmount(saved())).toBe(60); // your share is what's left
    });

    it('a refund on the bill lowers everyone\'s share', async () => {
      await open(dinner);
      button('+ Add money back').click();
      await settle();
      expect(document.getElementById('mb-from')).toBeNull(); // a refund isn't from a person
      await typeAmount('40');
      button('Save').click();
      await settle();
      expect(rows()[0]).toContain('Owes $50.00');
      expect(view().textContent).toContain('Your share is $50.00.');
    });

    it("\"won't be repaid\" closes a balance but keeps it in your spending", async () => {
      await open(dinner);
      const close = [...view().querySelectorAll('.split-close')][2] as HTMLElement; // Cara
      close.click();
      await settle();
      expect(saved().split!.closedPersonIds).toEqual(['cara']);
      expect(rows()[2]).toContain("Won't be repaid");
      expect(rows()[2]).toContain('Reopen');
      expect(view().textContent).toContain('$120.00 is still owed to you');
      expect(txs.effectiveExpenseAmount(saved())).toBe(240);
    });

    it('linking a bank income as a repayment asks who it was from', async () => {
      const venmo: Transaction = { id: 'v', type: 'income', amount: 60, date: '2026-10-05', merchant: 'Venmo', createdAt: 0, updatedAt: 0 };
      await open(dinner, [venmo]);
      button('+ Link income').click();
      await settle();
      (document.getElementById('mb-from') as HTMLSelectElement).value = 'ben';
      document.getElementById('mb-from')!.dispatchEvent(new Event('change'));
      await settle();
      (document.querySelector('.link-item') as HTMLElement).click();
      await settle();
      expect(txs.transactions().find(t => t.id === 'v')!.moneyBackInfo).toEqual({ source: 'repayment', fromPersonId: 'ben', coversPersonIds: ['ben'] });
      expect(status().people.find(p => p.personId === 'ben')!.state).toBe('repaid');
    });
  });
});
