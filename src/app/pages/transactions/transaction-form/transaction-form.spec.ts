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
import { buildItemizedSplit, emptyItemizedState, newItem, personName, quickSplit, splitStatus } from '../../../utils/splits';
import { ReceiptScanService } from '../../../services/receipt-scan.service';
import { ReceiptService } from '../../../services/receipt.service';

/** Receipt photos, kept in memory the way ReceiptService keeps them in Firestore. */
class FakeReceipts {
  stored = new Map<string, string>([['old', 'data:image/jpeg;base64,OLD']]);
  removed: string[] = [];
  private n = 0;
  async fit() { return { dataUrl: 'data:image/jpeg;base64,NEW', width: 800, height: 1600 }; }
  async save(photo: { dataUrl: string }) { const id = `r${++this.n}`; this.stored.set(id, photo.dataUrl); return id; }
  async load(id: string) { const image = this.stored.get(id); return image ? { id, image, width: 1, height: 1, createdAt: 0 } : null; }
  async remove(id: string) { this.removed.push(id); this.stored.delete(id); }
}
let receipts: FakeReceipts;
import { ReceiptScan } from '../../../utils/receipt';

/** What the fake scanner returns next (or throws). */
let nextScan: ReceiptScan | Error;
const receipt = (over: Partial<ReceiptScan> = {}): ReceiptScan => ({
  isReceipt: true, merchant: 'Hashtag India', date: '2026-09-29',
  items: [
    { name: 'Nalli Gosht Mandi', quantity: 2, unitPriceCents: 2500, totalCents: 5000 },
    { name: 'Chai', quantity: 1, unitPriceCents: null, totalCents: 300 },
  ],
  subtotalCents: 5300, fees: [], discounts: [], taxCents: 387, tipCents: 0, totalCents: 5687, confidence: 0.95,
  ...over,
});

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
    const people = signal([{ id: 'alex', name: 'Alex', createdAt: 0, updatedAt: 0 }]);
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
        { provide: PersonService, useValue: { people, nameOf: (id: string) => personName(people(), id) } },
        { provide: ReceiptScanService, useValue: { scanImage: async () => { if (nextScan instanceof Error) throw nextScan; return nextScan; } } },
        { provide: ReceiptService, useFactory: () => (receipts = new FakeReceipts()) },
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

  it('switching to "Item by item" keeps who is on the bill', async () => {
    await openWith({ ...dinner, split: quickSplit(18000, [ME, 'alex']) });
    button('Item by item').click();
    await settle();
    expect(host.form().itemizedState().participantIds).toEqual([ME, 'alex']);
    expect(el.textContent).toContain('Tip on');
  });

  it("won't save a receipt that doesn't match what you paid, and says what it should be", async () => {
    await openWith(dinner);
    (el.querySelector('[aria-label="Split this bill"]') as HTMLElement).click();
    await settle();
    host.form().setSplitKind('itemized');
    host.form().itemizedState.set({
      ...emptyItemizedState(), participantIds: [ME, 'alex'],
      items: [newItem([ME], 'Steak', 3000), newItem(['alex'], 'Salad', 1000)],
    });
    await host.form().save(); // the transaction says $180
    expect(errors).toEqual(['The receipt says you paid $40.00. Fix the items or the amount before saving.']);

    host.form().useSplitAmount(4000);
    await host.form().save();
    const split = host.saved[0].split!;
    expect(split.mode).toBe('itemized');
    expect(host.saved[0].amount).toBe(40);
    expect(splitStatus(split).owedToMeCents).toBe(1000);
  });

  it('a saved itemized split opens item by item, as it was', async () => {
    const state = { ...emptyItemizedState(), participantIds: [ME, 'alex'], items: [newItem(['alex'], 'Salad', 1000), newItem([ME], 'Steak', 3000)] };
    await openWith({ ...dinner, amount: 40, split: buildItemizedSplit(state, 4000) });
    expect(host.form().splitKind()).toBe('itemized');
    expect(host.form().itemizedState().items.map(i => i.name)).toEqual(['Salad', 'Steak']);
    await host.form().save();
    expect(errors).toEqual([]);
    expect(host.saved[0].split!.items.map(i => i.name)).toEqual(['Salad', 'Steak']);
  });

  describe('a receipt photo', () => {
    const photo = () => new File(['x'], 'receipt.jpg', { type: 'image/jpeg' });
    const pick = async () => {
      await host.form().attachReceipt(photo());
      await settle();
    };

    it('on a blank new expense, attaching it also reads it: merchant, date, amount, items', async () => {
      nextScan = receipt();
      await openWith(null);
      await pick();
      const form = host.form();
      expect(form.receiptImage()).toBe('data:image/jpeg;base64,NEW');
      expect(form.merchant()).toBe('Hashtag India');
      expect(form.date).toBe('2026-09-29');
      expect(form.amount).toBe(56.87);
      expect(form.itemizedState().items.map(i => i.name)).toEqual(['Nalli Gosht Mandi', 'Chai']);
      expect(el.textContent).toContain('2 items · tax & fees $3.87 · tip $0.00 · total $56.87');
      expect(el.textContent).toContain('turn on Split this bill');
    });

    it("on an expense you've already filled in, it's only attached — reading it is a tap away, and never overwrites", async () => {
      nextScan = receipt();
      await openWith(dinner); // Ramen Bar, $180, 2026-10-02
      await pick();
      expect(host.form().scanned()).toBeNull();
      expect(button('Fill in from it')).toBeTruthy();
      button('Fill in from it').click();
      await settle();
      expect(host.form().scanned()).not.toBeNull();
      expect(host.form().merchant()).toBe('Ramen Bar');
      expect(host.form().amount).toBe(180);
      expect(host.form().date).toBe('2026-10-02');
    });

    it('is stored when the transaction is saved, and the transaction points at it', async () => {
      nextScan = receipt();
      await openWith(null);
      await pick();
      host.form().accountId = 'card';
      await host.form().save();
      expect(errors).toEqual([]);
      expect(host.saved[0].receiptId).toBe('r1');
      expect(receipts.stored.get('r1')).toBe('data:image/jpeg;base64,NEW');
    });

    it('an existing receipt shows when editing; replacing it stores the new one and deletes the old', async () => {
      await openWith({ ...dinner, receiptId: 'old' });
      await settle();
      expect(host.form().receiptImage()).toBe('data:image/jpeg;base64,OLD');
      await pick();
      await host.form().save();
      expect(host.saved[0].receiptId).toBe('r1');
      expect(receipts.removed).toEqual(['old']);
    });

    it('removing it clears it from the transaction, and deletes the photo', async () => {
      await openWith({ ...dinner, receiptId: 'old' });
      await settle();
      button('Remove').click();
      await settle();
      expect(el.textContent).toContain('Attach a photo of the receipt');
      await host.form().save();
      expect('receiptId' in host.saved[0]).toBe(true);
      expect(host.saved[0].receiptId).toBeUndefined();
      expect(receipts.removed).toEqual(['old']);
    });

    it('an unchanged receipt is left alone', async () => {
      await openWith({ ...dinner, receiptId: 'old' });
      await host.form().save();
      expect('receiptId' in host.saved[0]).toBe(false);
      expect(receipts.removed).toEqual([]);
    });

    it('splitting it: claim the lines, save — the split is marked as from a receipt', async () => {
      nextScan = receipt();
      await openWith(null);
      await pick();
      const form = host.form();
      form.accountId = 'card';
      form.splitOn.set(true);
      form.itemizedState.update(s => ({
        ...s, participantIds: [ME, 'alex'],
        items: s.items.map(i => ({ ...i, assignments: [{ personId: ME, weight: 1 }, { personId: 'alex', weight: 1 }] })),
      }));
      await settle();
      expect(el.textContent).toContain('tap who had each one');
      await form.save();

      expect(errors).toEqual([]);
      const saved = host.saved[0];
      expect(saved.aiExtracted).toBe(true);
      expect(saved.aiConfidence).toBe(0.95);
      expect(saved.split!.source).toBe('receipt');
      expect(splitStatus(saved.split!).billTotalCents).toBe(5687);
    });

    it('a delivery order: discounts and credits net into tax & fees, and the note says how', async () => {
      nextScan = receipt({
        merchant: 'IGrill Indian Cuisine',
        items: [{ name: 'Vijayawada Style Chicken Biryani', quantity: 3, unitPriceCents: 1399, totalCents: 4197 }],
        discounts: [{ name: 'Discount', cents: 210 }, { name: 'DoorDash Credits', cents: 625 }],
        taxCents: 364, totalCents: 3726,
      });
      await openWith(null);
      await pick();
      expect(host.form().amount).toBe(37.26);
      expect(host.form().itemizedState().charges.taxCents).toBe(-471);
      expect(el.textContent).toContain('Tax & fees is Tax $3.64 · Discount −$2.10 · DoorDash Credits −$6.25.');
      expect(el.querySelector('.scan-note .field-error')).toBeNull();
    });

    it('says when the lines and the printed total disagree', async () => {
      nextScan = receipt({ totalCents: 6187 });
      await openWith(null);
      await pick();
      expect(el.querySelector('.scan-note .field-error')!.textContent).toContain("The lines add up to $56.87, but the receipt's total is $61.87.");
    });

    it("a photo that isn't a receipt, or a failed read, fills in nothing — but the photo stays attached", async () => {
      await openWith(null);
      nextScan = receipt({ isReceipt: false });
      await pick();
      nextScan = new Error('The receipt reader is busy. Try again in a minute.');
      await pick();
      expect(errors).toEqual([
        "That doesn't look like a receipt, so nothing was filled in. It's still attached.",
        'The receipt reader is busy. Try again in a minute.',
      ]);
      expect(host.form().merchant()).toBe('');
      expect(host.form().scanned()).toBeNull();
      expect(host.form().receiptImage()).toBe('data:image/jpeg;base64,NEW');
    });
  });
});
