import { Component, signal, viewChild } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { TransactionForm } from './transaction-form';
import { AccountService } from '../../../services/account.service';
import { CategoryService } from '../../../services/category.service';
import { BillService } from '../../../services/bill.service';
import { TransactionTemplateService } from '../../../services/transaction-template.service';
import { TransactionService } from '../../../services/transaction.service';
import { QuickAddService } from '../../../services/quick-add.service';
import { ToastService } from '../../../services/toast.service';
import { PersonService } from '../../../services/person.service';
import { ME, Transaction } from '../../../models';
import { MoneyBackLedger } from '../../../utils/money-back';
import { quickSplit, splitStatus } from '../../../utils/splits';

class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
}

@Component({
  standalone: true,
  imports: [TransactionForm],
  template: `<app-transaction-form [open]="open()" [transaction]="editing()" (saved)="saved.push($event)" />`,
})
class Host {
  open = signal(false);
  editing = signal<Transaction | null>(null);
  saved: Partial<Transaction>[] = [];
  form = viewChild.required(TransactionForm);
}

const dinner: Transaction = {
  id: 'd', type: 'expense', amount: 180, date: '2026-10-02', merchant: 'Ramen Bar', accountId: 'card',
  createdAt: 0, updatedAt: 0,
};

describe('TransactionForm — splitting a bill', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;
  let errors: string[];

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const button = (text: string) =>
    [...document.body.querySelectorAll('button')].find(b => b.textContent!.trim() === text) as HTMLButtonElement;

  async function openWith(tx: Transaction | null) {
    host.editing.set(tx);
    host.open.set(true);
    await settle();
  }

  beforeEach(async () => {
    errors = [];
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: AccountService, useValue: { accounts: signal([{ id: 'card', name: 'Card', type: 'credit', openingBalance: 0 }]) } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        { provide: BillService, useValue: { bills: signal([]) } },
        { provide: TransactionTemplateService, useValue: { templates: signal([]), error: signal(null) } },
        { provide: TransactionService, useValue: new FakeTransactions() },
        { provide: QuickAddService, useValue: { defaultType: () => 'expense' } },
        { provide: ToastService, useValue: { success() {}, error: (m: string) => errors.push(m) } },
        { provide: PersonService, useValue: { people: signal([{ id: 'alex', name: 'Alex', createdAt: 0, updatedAt: 0 }]) } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = document.body;
    await settle();
  });

  it('saves the split with the expense', async () => {
    await openWith(dinner);
    (el.querySelector('[aria-label="Split this bill"]') as HTMLElement).click();
    await settle();
    button('+ Alex').click();
    await settle();
    await host.form().save();

    expect(errors).toEqual([]);
    const split = host.saved[0].split!;
    expect(split.participantIds).toEqual([ME, 'alex']);
    expect(splitStatus(split).owedToMeCents).toBe(9000);
  });

  it("won't save a split with nobody else in it", async () => {
    await openWith(dinner);
    (el.querySelector('[aria-label="Split this bill"]') as HTMLElement).click();
    await settle();
    await host.form().save();
    expect(errors).toEqual(['Add someone to split this bill with.']);
    expect(host.saved).toEqual([]);
  });

  it('uses the amount at save time', async () => {
    await openWith({ ...dinner, split: quickSplit(18000, [ME, 'alex']) });
    host.form().amount = 200;
    await host.form().save();
    expect(splitStatus(host.saved[0].split!).billTotalCents).toBe(20000);
  });

  it('turning the split off on an edit clears it', async () => {
    await openWith({ ...dinner, split: quickSplit(18000, [ME, 'alex']) });
    (el.querySelector('[aria-label="Split this bill"]') as HTMLElement).click();
    await settle();
    await host.form().save();
    expect('split' in host.saved[0]).toBe(true);
    expect(host.saved[0].split).toBeUndefined();
  });

  it('an expense without a split saves without one', async () => {
    await openWith(dinner);
    await host.form().save();
    expect('split' in host.saved[0]).toBe(false);
  });
});
