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

/** The real money-back logic; updates are applied the way Firestore would (undefined dropped). */
class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
  async update(id: string, patch: Partial<Transaction>) {
    this.transactions.update(all => all.map(t => t.id === id ? JSON.parse(JSON.stringify({ ...t, ...patch })) : t));
  }
}

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
});
