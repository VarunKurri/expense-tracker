import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { ActivatedRoute, Router, convertToParamMap, provideRouter } from '@angular/router';
import { of } from 'rxjs';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { GroupDetail } from './group-detail';
import { TransactionService } from '../../../services/transaction.service';
import { PersonService } from '../../../services/person.service';
import { GroupService } from '../../../services/group.service';
import { ToastService } from '../../../services/toast.service';
import { CategoryService } from '../../../services/category.service';
import { AccountService } from '../../../services/account.service';
import { ManualAssetService } from '../../../services/manual-asset.service';
import { BillService } from '../../../services/bill.service';
import { TransactionTemplateService } from '../../../services/transaction-template.service';
import { QuickAddService } from '../../../services/quick-add.service';
import { ReceiptService } from '../../../services/receipt.service';
import { FakeGroups } from '../../../testing/fake-groups';
import { FakeSharedBills } from '../../../testing/fake-shared-bills';
import { SharedBillService } from '../../../services/shared-bill.service';
import { Group, ME, Transaction } from '../../../models';
import { MoneyBackLedger } from '../../../utils/money-back';
import { personName, quickSplit } from '../../../utils/splits';

class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
  async update() {}
  async remove() {}
}

const people = signal([
  { id: 'alex', name: 'Alex', createdAt: 0, updatedAt: 0 },
  { id: 'ben', name: 'Ben', createdAt: 0, updatedAt: 0 },
]);

const trip: Group = {
  id: 'tahoe', name: 'Tahoe Trip', memberIds: ['alex', 'ben'], simplify: true, payments: [],
  startDate: '2026-09-12', endDate: '2026-09-14', createdAt: 0, updatedAt: 0,
};

const food: Transaction = {
  id: 'food', type: 'expense', merchant: 'Safeway', amount: 120, date: '2026-09-12', accountId: 'card',
  createdAt: 1, updatedAt: 1, split: { ...quickSplit(12000, [ME, 'alex', 'ben']), groupId: 'tahoe' },
};

describe('Group page', () => {
  let fixture: ComponentFixture<GroupDetail>;
  let el: HTMLElement;
  let groups: FakeGroups;
  let sharedBills: FakeSharedBills;
  let txs: FakeTransactions;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const button = (text: string) =>
    [...document.body.querySelectorAll('button')].find(b => b.textContent!.trim() === text) as HTMLButtonElement;
  const rows = (card: number) => [...el.querySelectorAll('.list-card')[card].querySelectorAll('.row')]
    .map(r => [...r.querySelectorAll('.row-name, .label-mono, .row-amount, .bill-note')].map(x => x.textContent!.trim()).join(' '));
  const lastButton = (text: string) =>
    [...document.body.querySelectorAll('button')].filter(b => b.textContent!.trim() === text).pop() as HTMLButtonElement;

  async function setup(list: Transaction[], groupList: Group[] = [trip]) {
    groups = new FakeGroups();
    sharedBills = new FakeSharedBills();
    groups.groups.set(groupList);
    txs = new FakeTransactions();
    txs.transactions.set(list);
    TestBed.configureTestingModule({
      imports: [GroupDetail],
      providers: [
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: of(convertToParamMap({ id: 'tahoe' })) } },
        { provide: TransactionService, useValue: txs },
        { provide: GroupService, useValue: groups },
        { provide: SharedBillService, useValue: sharedBills },
        { provide: PersonService, useValue: { people, nameOf: (id: string) => personName(people(), id) } },
        { provide: ToastService, useValue: { success() {}, error() {} } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        { provide: AccountService, useValue: { accounts: signal([]) } },
        { provide: ManualAssetService, useValue: { items: signal([]) } },
        { provide: BillService, useValue: { bills: signal([]) } },
        { provide: TransactionTemplateService, useValue: { templates: signal([]), error: signal(null) } },
        { provide: QuickAddService, useValue: { defaultType: () => 'expense' } },
        { provide: ReceiptService, useValue: { load: async () => null } },
      ],
    });
    fixture = TestBed.createComponent(GroupDetail);
    el = fixture.nativeElement;
    await settle();
  }

  beforeEach(() => TestBed.resetTestingModule());

  it('says where you stand, how to settle, and lists the bills', async () => {
    await setup([food]);
    const hero = el.querySelector('.hero')!.textContent!;
    expect(hero).toContain('$80.00');
    expect(hero).toContain('The group owes you $80.00.');
    expect(hero).toContain('Tahoe Trip came to $120.00; your share is $40.00.');
    expect(hero).toContain('Sep 12 – Sep 14 · You, Alex and Ben');

    expect(rows(0)).toEqual(['Alex pays you $40.00', 'Ben pays you $40.00']);
    expect(rows(1)).toEqual(['You You get back $80.00', 'Alex Owes $40.00', 'Ben Owes $40.00']);
    expect(rows(2)).toEqual(['Safeway Sep 12 You paid $120.00 · your share $40.00']);
  });

  it('a bill someone else paid counts in the group, and opens to edit', async () => {
    await setup([food]);
    sharedBills.bills.set([{
      id: 'tents', date: '2026-09-13', merchant: 'REI', createdAt: 2, updatedAt: 2,
      split: { ...quickSplit(9000, [ME, 'alex', 'ben']), payments: [{ personId: 'ben', amountCents: 9000 }], groupId: 'tahoe' },
    }]);
    await settle();
    // You paid $120 food (share $40), Ben paid $90 tents (share $30 each).
    expect(el.querySelector('.hero')!.textContent).toContain('The group owes you $50.00.');
    expect(rows(2)).toContain('REI Sep 13 Ben paid $90.00 · your share $30.00');
    expect(rows(1)).toEqual(['You You get back $50.00', 'Alex Owes $70.00', 'Ben Gets back $20.00']);

    ([...el.querySelectorAll('.bill')].find(b => b.textContent!.includes('REI')) as HTMLElement).click();
    await settle();
    expect(document.body.textContent).toContain('Edit bill');
    expect((document.getElementById('sb-merchant') as HTMLInputElement).value).toBe('REI');
  });

  it('+ Someone else paid starts a bill in this group', async () => {
    await setup([food]);
    button('+ Someone else paid').click();
    await settle();
    expect((document.getElementById('sb-group') as HTMLSelectElement).value).toBe('tahoe');
  });

  it('opening a bill shows it as part of the group', async () => {
    await setup([food]);
    (el.querySelector('.bill') as HTMLElement).click();
    await settle();
    const view = document.querySelector('app-transaction-view')!.textContent!;
    // Everyone's share at a glance, and a small link to the group.
    expect(view).toContain('Alex');
    expect(view).toContain('Their share');
    expect(view).toContain('$40.00');
    expect(view).toContain('This bill is in Tahoe Trip');
    expect(view).toContain('Open group');
    expect(view).not.toContain('Owes you');
  });

  it('with no bills yet, says how to add one', async () => {
    await setup([]);
    expect(el.querySelector('.empty .display')!.textContent).toContain('Add the first bill to Tahoe Trip.');
  });

  it('a group that is gone says so', async () => {
    await setup([food], []);
    expect(el.textContent).toContain("This group isn't here anymore.");
  });

  it('deleting the group goes back to Shared and leaves its bills alone', async () => {
    await setup([food]);
    const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    button('Edit group').click();
    await settle();
    button('Delete').click();
    await settle();
    lastButton('Delete').click(); // the confirm
    await settle();
    expect(groups.groups()).toEqual([]);
    expect(txs.transactions()[0].split!.groupId).toBe('tahoe');
    expect(navigate).toHaveBeenCalledWith(['/shared']);
  });
});
