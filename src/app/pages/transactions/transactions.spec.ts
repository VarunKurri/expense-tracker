import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach } from 'vitest';
import { Transactions } from './transactions';
import { TransactionService } from '../../services/transaction.service';
import { ToastService } from '../../services/toast.service';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { BillService } from '../../services/bill.service';
import { TransactionTemplateService } from '../../services/transaction-template.service';
import { QuickAddService } from '../../services/quick-add.service';
import { ReconciliationService } from '../../services/reconciliation.service';
import { PersonService } from '../../services/person.service';
import { GroupService } from '../../services/group.service';
import { SharedBillService } from '../../services/shared-bill.service';
import { FakeGroups } from '../../testing/fake-groups';
import { FakeSharedBills } from '../../testing/fake-shared-bills';
import { Transaction } from '../../models';
import { MoneyBackLedger } from '../../utils/money-back';
import { localDateString } from '../../utils/date';

/** The real money-back logic; deletes recorded so the test can see exactly what went. */
class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
  error = signal<string | null>(null);
  removed: string[] = [];
  async removeMany(ids: string[]) {
    this.removed.push(...ids);
    this.transactions.update(all => all.filter(t => !ids.includes(t.id!)));
  }
  async update() {}
  async updateMany() {}
}

const daysAgo = (n: number) => {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return localDateString(d);
};
const tx = (id: string, merchant: string, date: string): Transaction =>
  ({ id, type: 'expense', merchant, amount: 39.61, date, accountId: 'chk', createdAt: 1, updatedAt: 1 }) as Transaction;

describe('Transactions bulk edit', () => {
  let txs: FakeTransactions;
  let fixture: ComponentFixture<Transactions>;
  let page: Transactions;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const selectAll = () => fixture.nativeElement.querySelector('.bulk-select-all input') as HTMLInputElement;

  beforeEach(async () => {
    txs = new FakeTransactions();
    txs.transactions.set([
      tx('v1', 'Verizon Phone Bill', daysAgo(5)),
      tx('v2', 'Verizon Phone Bill', daysAgo(40)),   // only with All time
      tx('v3', 'Verizon Phone Bill', daysAgo(100)),  // only with All time
      tx('o1', 'Costco', daysAgo(5)),                // never matches the search
      tx('o2', 'Costco', daysAgo(60)),
    ]);
    TestBed.configureTestingModule({
      imports: [Transactions],
      providers: [
        provideRouter([]),
        { provide: TransactionService, useValue: txs },
        { provide: ToastService, useValue: { success() {}, error() {}, info() {} } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        { provide: AccountService, useValue: { accounts: signal([{ id: 'chk', name: 'Chase College', type: 'checking', openingBalance: 0 }]) } },
        { provide: ManualAssetService, useValue: { items: signal([]) } },
        { provide: BillService, useValue: { bills: signal([]) } },
        { provide: TransactionTemplateService, useValue: { templates: signal([]), error: signal(null) } },
        { provide: QuickAddService, useValue: { defaultType: () => 'expense', open: signal(false), close() {} } },
        { provide: ReconciliationService, useValue: { matches: signal([]), busy: signal(false) } },
        { provide: PersonService, useValue: { people: signal([]), nameOf: () => '' } },
        { provide: GroupService, useValue: new FakeGroups() },
        { provide: SharedBillService, useValue: new FakeSharedBills() },
      ],
    });
    fixture = TestBed.createComponent(Transactions);
    page = fixture.componentInstance;
    await settle();
  });

  it('Select all ticks every row the search and range show, and keeps them ticked', async () => {
    page.enterBulkMode();
    page.search.set('verizon');
    page.filterDateRange.set('all');
    await settle();

    selectAll().click();
    await settle();

    expect(page.selectedTransactions().map(t => t.id)).toEqual(['v1', 'v2', 'v3']);
    expect(fixture.nativeElement.querySelector('.bulk-select-all span').textContent).toContain('3 of 3 selected');
    const ticked = [...fixture.nativeElement.querySelectorAll('.tx-row input[type=checkbox]')] as HTMLInputElement[];
    expect(ticked.length).toBe(3);
    expect(ticked.every(box => box.checked)).toBe(true);
  });

  it('a single tick stays ticked', async () => {
    page.enterBulkMode();
    await settle();
    page.toggleSelectedTx(txs.transactions()[0]);
    await settle();
    expect(page.selectedCount()).toBe(1);
  });

  it('deletes only the rows shown and ticked, never one the filters hide', async () => {
    page.enterBulkMode();
    page.search.set('verizon');
    page.filterDateRange.set('all');
    await settle();
    selectAll().click();
    await settle();
    // Something ticked that the filters don't show can't come along.
    page.selectedIds.update(ids => new Set([...ids, 'o1']));

    await page.confirmBulkDelete();
    expect(txs.removed.sort()).toEqual(['v1', 'v2', 'v3']);
    expect(txs.transactions().map(t => t.id).sort()).toEqual(['o1', 'o2']);
  });

  it('changing a filter clears the selection', async () => {
    page.enterBulkMode();
    page.filterDateRange.set('all');
    await settle();
    selectAll().click();
    await settle();
    expect(page.selectedCount()).toBe(5);

    page.search.set('costco');
    await settle();
    expect(page.selectedCount()).toBe(0);
  });
});
