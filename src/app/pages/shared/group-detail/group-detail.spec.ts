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
  async update(id: string, patch: Partial<Transaction>) {
    this.transactions.update(all => all.map(t => (t.id === id ? JSON.parse(JSON.stringify({ ...t, ...patch })) : t)));
  }
  async applyPatches(patches: { id: string; patch: Partial<Transaction> }[]) {
    for (const p of patches) await this.update(p.id, p.patch);
    return patches.length;
  }
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
    expect(rows(3)).toEqual(['Safeway Sep 12 You paid $120.00 · your share $40.00']);
  });

  it('a bill someone else paid counts in the group, opens to read, and Edit opens the form', async () => {
    await setup([food]);
    sharedBills.bills.set([{
      id: 'tents', date: '2026-09-13', merchant: 'REI', createdAt: 2, updatedAt: 2,
      split: { ...quickSplit(9000, [ME, 'alex', 'ben']), payments: [{ personId: 'ben', amountCents: 9000 }], groupId: 'tahoe' },
    }]);
    await settle();
    // You paid $120 food (share $40), Ben paid $90 tents (share $30 each).
    expect(el.querySelector('.hero')!.textContent).toContain('The group owes you $50.00.');
    expect(rows(3)).toContain('REI Sep 13 Ben paid $90.00 · your share $30.00');
    expect(rows(1)).toEqual(['You You get back $50.00', 'Alex Owes $70.00', 'Ben Gets back $20.00']);

    ([...el.querySelectorAll('.bill')].find(b => b.textContent!.includes('REI')) as HTMLElement).click();
    await settle();
    const sheet = document.querySelector('app-shared-bill-view')!.textContent!;
    expect(sheet).toContain('$90.00');
    expect(sheet).toContain('Paid by Ben');
    expect(sheet).toContain('Shares');
    expect(sheet).toContain('Paid $90.00 · their share');
    expect(sheet).toContain('This bill is in Tahoe Trip');
    (document.querySelector('app-shared-bill-view .view-edit-btn') as HTMLElement).click();
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

  describe('payments between friends', () => {
    const tents = () => ({
      id: 'tents', date: '2026-09-13', merchant: 'REI', createdAt: 2, updatedAt: 2,
      split: { ...quickSplit(9000, [ME, 'alex', 'ben']), payments: [{ personId: 'ben', amountCents: 9000 }], groupId: 'tahoe' },
    });

    it('Mark as paid records what was suggested, and the plan follows', async () => {
      await setup([]);
      sharedBills.bills.set([tents()]);
      await settle();
      expect(rows(0)).toContain('Alex pays Ben $30.00');
      button('Mark as paid').click(); // Alex pays Ben (yours aren't markable)
      await settle();
      expect((document.getElementById('pay-from') as HTMLSelectElement).value).toBe('alex');
      expect((document.getElementById('pay-amount') as HTMLInputElement).value).toBe('30');
      button('Record payment').click();
      await settle();

      expect(groups.byId('tahoe')!.payments).toEqual([expect.objectContaining({ fromPersonId: 'alex', toPersonId: 'ben', amountCents: 3000 })]);
      expect(rows(0)).toEqual(['You pay Ben $30.00']);
      expect(rows(2)).toEqual([expect.stringMatching(/^Alex paid Ben .*\$30\.00/)]);
    });

    it('a recorded payment can be edited and deleted', async () => {
      await setup([], [{ ...trip, payments: [{ id: 'p1', fromPersonId: 'alex', toPersonId: 'ben', amountCents: 1000, date: '2026-09-20' }] }]);
      sharedBills.bills.set([tents()]);
      await settle();
      ([...el.querySelectorAll('.list-card')[2].querySelectorAll('.bill')][0] as HTMLElement).click();
      await settle();
      const amount = document.getElementById('pay-amount') as HTMLInputElement;
      expect(amount.value).toBe('10');
      amount.value = '30';
      amount.dispatchEvent(new Event('input'));
      button('Save changes').click();
      await settle();
      expect(groups.byId('tahoe')!.payments[0].amountCents).toBe(3000);

      ([...el.querySelectorAll('.list-card')[2].querySelectorAll('.bill')][0] as HTMLElement).click();
      await settle();
      button('Delete').click();
      await settle();
      lastButton('Delete').click();
      await settle();
      expect(groups.byId('tahoe')!.payments).toEqual([]);
    });
  });

  describe('payments to and from you', () => {
    const zelle: Transaction = { id: 'z', type: 'income', amount: 50, date: '2026-09-20', merchant: 'Zelle from ALEX', accountId: 'chk',
      createdAt: 5, updatedAt: 5 };
    const drinks: Transaction = { id: 'drinks', type: 'expense', merchant: 'BevMo', amount: 30, date: '2026-09-13', accountId: 'card',
      createdAt: 2, updatedAt: 2, split: { ...quickSplit(3000, [ME, 'alex', 'ben']), groupId: 'tahoe' } };
    const venmo: Transaction = { id: 'v', type: 'expense', amount: 30, date: '2026-09-21', merchant: 'Venmo to Ben', accountId: 'chk',
      createdAt: 6, updatedAt: 6 };
    const select = async (id: string, value: string) => {
      const s = document.getElementById(id) as HTMLSelectElement;
      s.value = value;
      s.dispatchEvent(new Event('change'));
      await settle();
    };
    const type = async (id: string, value: string) => {
      const i = document.getElementById(id) as HTMLInputElement;
      i.value = value;
      i.dispatchEvent(new Event('input'));
      await settle();
    };

    it('link a Zelle to the group: one payment over your bills, not income, and the balance follows', async () => {
      await setup([food, drinks, zelle]);
      expect(rows(0)).toEqual(['Alex pays you $50.00', 'Ben pays you $50.00']);
      button('Record').click(); // Alex pays you
      await settle();
      expect((document.getElementById('pay-from') as HTMLSelectElement).value).toBe('alex');
      expect((document.getElementById('pay-to') as HTMLSelectElement).value).toBe(ME);
      await select('pay-tx', 'z');
      expect(document.body.textContent).toContain('After this, Alex is square.');
      button('Record payment').click();
      await settle();

      const income = txs.transactions().find(t => t.id === 'z')!;
      expect(income.moneyBackInfo).toEqual({ source: 'repayment', fromPersonId: 'alex', coversPersonIds: ['alex'] });
      // Safeway, the oldest, had $80 of other people's shares on it: all $50 fits there, as money back.
      expect(income.reimbursesId).toBe('food');
      expect(income.moneyBackSplits).toBeUndefined();
      expect(rows(0)).toEqual(['Ben pays you $50.00']);
      expect(rows(1)).toEqual(['You You get back $50.00', 'Alex Square', 'Ben Owes $50.00']);
      expect(rows(2)).toEqual([expect.stringMatching(/^Alex paid you Sep 20 · Zelle from ALEX\s*\$50\.00$/)]);
    });

    it('pays less or more than suggested: the balance just follows', async () => {
      await setup([food, drinks, { ...zelle, amount: 70 }]);
      button('Record').click();
      await settle();
      await select('pay-tx', 'z');
      expect(document.body.textContent).toContain('After this, Alex gets back $20.00.');
      button('Record payment').click();
      await settle();
      expect(rows(1)).toEqual(['You You get back $30.00', 'Alex Gets back $20.00', 'Ben Owes $50.00']);
    });

    it('cash from a friend is written on your bills as one payment, and can be removed', async () => {
      await setup([food, drinks]);
      button('Record').click();
      await settle();
      button('Cash or other').click();
      await settle();
      await type('pay-amount', '90'); // more than Safeway's $80 of other people's shares, so it runs onto BevMo
      button('Record payment').click();
      await settle();

      const entries = txs.transactions().flatMap(t => (t.moneyBack ?? []).map(e => ({ tx: t.id, ...e })));
      expect(entries.map(e => [e.tx, e.amountCents, e.fromPersonId])).toEqual([['food', 8000, 'alex'], ['drinks', 1000, 'alex']]);
      expect(new Set(entries.map(e => e.batchId)).size).toBe(1);
      expect(rows(2)).toEqual([expect.stringMatching(/^Alex paid you .*cash\s*\$90\.00$/)]);
      expect(rows(1)).toEqual(['You You get back $10.00', 'Alex Gets back $40.00', 'Ben Owes $50.00']);

      (el.querySelectorAll('.list-card')[2].querySelector('.bill') as HTMLElement).click();
      await settle();
      expect(document.body.textContent).toContain('Paid back, on your bills');
      button('Remove from group').click();
      await settle();
      lastButton('Remove').click();
      await settle();
      expect(txs.transactions().flatMap(t => t.moneyBack ?? [])).toEqual([]);
      expect(rows(1)).toEqual(['You You get back $100.00', 'Alex Owes $50.00', 'Ben Owes $50.00']);
    });

    it('a Venmo you sent settles up with them and counts as spending; removing it unmarks it', async () => {
      await setup([food, venmo]);
      sharedBills.bills.set([{
        id: 'tents', date: '2026-09-13', merchant: 'REI', createdAt: 2, updatedAt: 2,
        split: { ...quickSplit(18000, [ME, 'alex', 'ben']), payments: [{ personId: 'ben', amountCents: 18000 }], groupId: 'tahoe' },
      }]);
      await settle();
      expect(rows(1)).toEqual(['You You get back $20.00', 'Alex Owes $100.00', 'Ben Gets back $80.00']);
      button('+ Record a payment').click();
      await settle();
      await select('pay-from', ME);
      await select('pay-to', 'ben');
      await select('pay-tx', 'v');
      button('Record payment').click();
      await settle();

      expect(txs.transactions().find(t => t.id === 'v')!.settlement).toEqual({ personId: 'ben', groupId: 'tahoe' });
      expect(rows(1)).toEqual(['You You get back $50.00', 'Alex Owes $100.00', 'Ben Gets back $50.00']);
      expect(rows(2)).toEqual([expect.stringMatching(/^You paid Ben Sep 21 · Venmo to Ben\s*\$30\.00$/)]);

      (el.querySelectorAll('.list-card')[2].querySelector('.bill') as HTMLElement).click();
      await settle();
      button('Remove from group').click();
      await settle();
      lastButton('Remove').click();
      await settle();
      expect(txs.transactions().find(t => t.id === 'v')!.settlement).toBeUndefined();
    });

    it('cash you handed someone is kept on the group, out of your spending', async () => {
      await setup([food]);
      button('+ Record a payment').click();
      await settle();
      await select('pay-from', ME);
      await select('pay-to', 'ben');
      button('Cash or other').click();
      await settle();
      expect(document.body.textContent).toContain("isn't in your spending");
      await type('pay-amount', '10');
      button('Record payment').click();
      await settle();
      expect(groups.byId('tahoe')!.payments).toEqual([expect.objectContaining({ fromPersonId: ME, toPersonId: 'ben', amountCents: 1000 })]);
      expect(rows(1)).toEqual(['You You get back $90.00', 'Alex Owes $40.00', 'Ben Owes $50.00']);
    });

    it('with nothing of yours in the group to pay back, says so', async () => {
      await setup([zelle]);
      sharedBills.bills.set([{
        id: 'tents', date: '2026-09-13', merchant: 'REI', createdAt: 2, updatedAt: 2,
        split: { ...quickSplit(9000, [ME, 'alex', 'ben']), payments: [{ personId: 'ben', amountCents: 9000 }], groupId: 'tahoe' },
      }]);
      await settle();
      const errors: string[] = [];
      TestBed.inject(ToastService).error = (m: string) => { errors.push(m); };
      button('+ Record a payment').click();
      await settle();
      await select('pay-from', 'alex');
      await select('pay-to', ME);
      await select('pay-tx', 'z');
      button('Record payment').click();
      await settle();
      expect(errors).toEqual(['There is no expense of yours in this group to record it against yet.']);
      expect(txs.transactions().find(t => t.id === 'z')!.moneyBackInfo).toBeUndefined();
    });
  });

  it('Who paid you? names a payment linked without a name, and the group credits them', async () => {
    // A Zelle from before splits existed: it pays back the Safeway bill but doesn't say who sent it.
    const zelle = { id: 'z', type: 'income', amount: 40, date: '2026-09-15', merchant: 'Zelle from BEN', accountId: 'chk',
      reimbursesId: 'food', createdAt: 5, updatedAt: 5 } as Transaction;
    await setup([food, zelle]);
    expect(el.textContent).toContain('Who paid you?');
    expect(el.textContent).toContain('a guess: pick who sent it above'); // credited by bill order until named
    const select = el.querySelector('.assign-select') as HTMLSelectElement;
    select.value = 'ben';
    select.dispatchEvent(new Event('change'));
    await settle();

    expect(txs.transactions().find(t => t.id === 'z')!.moneyBackInfo).toEqual({ source: 'repayment', fromPersonId: 'ben', coversPersonIds: ['ben'] });
    expect(el.textContent).not.toContain('Who paid you?');
    expect(el.textContent).not.toContain('a guess');
    expect(rows(1)).toEqual(['You You get back $40.00', 'Alex Owes $40.00', 'Ben Square']);
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
