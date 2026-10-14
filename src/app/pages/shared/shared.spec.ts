import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Shared } from './shared';
import { TransactionService } from '../../services/transaction.service';
import { PersonService } from '../../services/person.service';
import { GroupService } from '../../services/group.service';
import { FakeGroups } from '../../testing/fake-groups';
import { ToastService } from '../../services/toast.service';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { BillService } from '../../services/bill.service';
import { TransactionTemplateService } from '../../services/transaction-template.service';
import { QuickAddService } from '../../services/quick-add.service';
import { ME, Transaction } from '../../models';
import { MoneyBackLedger } from '../../utils/money-back';
import { personName, quickSplit } from '../../utils/splits';
import { balancesByPerson } from '../../utils/shared';

/** The real money-back logic; writes applied the way Firestore would (undefined dropped). */
class FakeTransactions extends MoneyBackLedger {
  transactions = signal<Transaction[]>([]);
  private apply(id: string, patch: Partial<Transaction>) {
    this.transactions.update(all => all.map(t => t.id === id ? JSON.parse(JSON.stringify({ ...t, ...patch })) : t));
  }
  async update(id: string, patch: Partial<Transaction>) { this.apply(id, patch); }
  async applyPatches(patches: { id: string; patch: Partial<Transaction> }[]) {
    patches.forEach(p => this.apply(p.id, p.patch));
    return patches.length;
  }
  async remove() {}
}

const people = signal([
  { id: 'm', name: 'Mrunaal', createdAt: 0, updatedAt: 0 },
  { id: 'p', name: 'Priya', createdAt: 0, updatedAt: 0 },
]);

let n = 0;
const bill = (merchant: string, date: string, cents: number, who: string[]): Transaction => ({
  id: `b${++n}`, type: 'expense', merchant, amount: cents / 100, date, createdAt: n, updatedAt: 0, accountId: 'a',
  split: quickSplit(cents, [ME, ...who]),
});

describe('Shared page', () => {
  let txs: FakeTransactions;
  let groups: FakeGroups;
  let fixture: ComponentFixture<Shared>;
  let el: HTMLElement;

  // Mrunaal: $30 + $25 + $30 = $85. Priya: $30 + $30 = $60.
  const dinner = bill('Ramen Bar', '2026-09-01', 9000, ['m', 'p']);
  const pizza = bill('Pizza Place', '2026-09-10', 5000, ['m']);
  const tacos = bill('Taco Stand', '2026-09-20', 9000, ['m', 'p']);

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const button = (text: string) =>
    [...document.body.querySelectorAll('button')].find(b => b.textContent!.trim() === text) as HTMLButtonElement;
  const owed = (id: string) =>
    balancesByPerson(txs.transactions(), t => txs.moneyBackEntriesFor(t)).find(b => b.personId === id)!.owedCents;

  async function setup(list: Transaction[]) {
    txs = new FakeTransactions();
    txs.transactions.set(list);
    groups = new FakeGroups();
    TestBed.configureTestingModule({
      imports: [Shared],
      providers: [
        provideRouter([]),
        { provide: TransactionService, useValue: txs },
        { provide: PersonService, useValue: { people, nameOf: (id: string) => personName(people(), id) } },
        { provide: GroupService, useValue: groups },
        { provide: ToastService, useValue: { success() {}, error: (m: string) => errors.push(m) } },
        { provide: CategoryService, useValue: { categories: signal([]) } },
        { provide: AccountService, useValue: { accounts: signal([]) } },
        { provide: ManualAssetService, useValue: { items: signal([]) } },
        { provide: BillService, useValue: { bills: signal([]) } },
        { provide: TransactionTemplateService, useValue: { templates: signal([]), error: signal(null) } },
        { provide: QuickAddService, useValue: { defaultType: () => 'expense' } },
      ],
    });
    fixture = TestBed.createComponent(Shared);
    el = fixture.nativeElement;
    await settle();
  }

  let errors: string[] = [];
  beforeEach(() => { n = 0; errors = []; });

  it('says what everyone owes, and lists each person with their open bills', async () => {
    await setup([dinner, pizza, tacos]);
    expect(el.querySelector('.hero')!.textContent).toContain('$145.00');
    expect(el.textContent).toContain('Two friends owe you $145.00.');
    const cards = [...el.querySelectorAll('.person')];
    expect(cards[0].textContent).toContain('Mrunaal');
    expect(cards[0].textContent).toContain('$85.00 across 3 bills');
    expect([...cards[0].querySelectorAll('.bill-name')].map(b => b.textContent!.trim())).toEqual(['Ramen Bar', 'Pizza Place', 'Taco Stand']);
    expect(cards[1].textContent).toContain('$60.00 across 2 bills');
  });

  it('a cash repayment is spread over the bills, oldest first', async () => {
    await setup([dinner, pizza, tacos]);
    ([...el.querySelectorAll('.person')][0].querySelector('.btn-primary') as HTMLElement).click();
    await settle();
    const amount = document.getElementById('repay-amount') as HTMLInputElement;
    expect(amount.value).toBe('85');
    amount.value = '50';
    amount.dispatchEvent(new Event('input'));
    await settle();
    expect(document.querySelector('.preview')!.textContent).toContain('$30.00');
    expect(document.querySelector('.preview')!.textContent).toContain('$20.00 of $25.00');
    button('Save').click();
    await settle();

    expect(owed('m')).toBe(3500);
    const ramen = txs.transactions().find(t => t.id === dinner.id)!;
    expect(ramen.moneyBack).toEqual([expect.objectContaining({ source: 'repayment', amountCents: 3000, fromPersonId: 'm', coversPersonIds: ['m'] })]);
    expect(owed('p')).toBe(6000); // Priya's balance is untouched
  });

  it('a bank payment is spread over the bills and stops counting as income', async () => {
    const zelle: Transaction = { id: 'z', type: 'income', merchant: 'Zelle Mrunaal', amount: 85, date: '2026-10-01', createdAt: 0, updatedAt: 0, accountId: 'a' };
    await setup([dinner, pizza, tacos, zelle]);
    ([...el.querySelectorAll('.person')][0].querySelector('.btn-primary') as HTMLElement).click();
    await settle();
    button('A bank payment').click();
    await settle();
    const select = document.getElementById('repay-income') as HTMLSelectElement;
    select.value = 'z';
    select.dispatchEvent(new Event('change'));
    await settle();
    button('Save').click();
    await settle();

    const saved = txs.transactions().find(t => t.id === 'z')!;
    expect(saved.moneyBackSplits).toEqual([
      { expenseId: dinner.id, amountCents: 3000 },
      { expenseId: pizza.id, amountCents: 2500 },
      { expenseId: tacos.id, amountCents: 3000 },
    ]);
    expect(txs.isMoneyBackIncome(saved)).toBe(true);
    expect(owed('m')).toBe(0);
    expect(el.textContent).toContain('Priya owes you $60.00.');
    expect(el.querySelector('.square')!.textContent).toContain('Mrunaal');
  });

  it('with nothing split yet, says how to start', async () => {
    await setup([]);
    expect(el.querySelector('.empty .display')!.textContent).toContain('See who owes you what.');
  });

  describe('groups', () => {
    const trip = { id: 'tahoe', name: 'Tahoe Trip', memberIds: ['m', 'p'], simplify: true, payments: [], createdAt: 0, updatedAt: 0 };

    it("each person's total includes what they owe in groups, like Splitwise", async () => {
      const gas = { ...bill('Chevron', '2026-09-05', 6000, ['m', 'p']), id: 'gas' };
      gas.split = { ...gas.split!, groupId: 'tahoe' };
      await setup([dinner, gas]);
      groups.groups.set([trip]);
      await settle();

      const row = el.querySelector('.group-row')!;
      expect(row.textContent).toContain('Tahoe Trip');
      expect(row.textContent).toContain('3 people · 1 bill');
      expect(row.textContent).toContain("You're owed $40.00");
      expect(row.getAttribute('href')).toBe('/shared/groups/tahoe');

      // $30.00 each for ramen, plus $20.00 each in the trip.
      expect(el.textContent).toContain('Two friends owe you $100.00.');
      expect(el.querySelector('.hero .num-display')!.textContent).toContain('$100.00');
      const card = [...el.querySelectorAll('.person')][0];
      expect(card.textContent).toContain('$50.00 across 1 bill and Tahoe Trip');
      expect([...card.querySelectorAll('.bill-name')].map(b => b.textContent!.trim())).toEqual(['Ramen Bar', 'Tahoe Trip']);
      expect(card.textContent).toContain('Owes $20.00');
      // The group bill itself isn't listed per person: the group settles it.
      expect(el.textContent).not.toContain('Chevron');
    });

    it('someone you only share a group with has a total too', async () => {
      const gas = { ...bill('Chevron', '2026-09-05', 6000, ['m', 'p']), id: 'gas' };
      gas.split = { ...gas.split!, groupId: 'tahoe' };
      await setup([gas]);
      groups.groups.set([trip]);
      await settle();
      expect(el.textContent).toContain('Two friends owe you $40.00.');
      expect([...el.querySelectorAll('.person')][0].textContent).toContain('$20.00 across Tahoe Trip');
    });

    it('one repayment pays the bills outside groups first, then the group', async () => {
      const gas = { ...bill('Chevron', '2026-09-05', 6000, ['m', 'p']), id: 'gas' };
      gas.split = { ...gas.split!, groupId: 'tahoe' };
      await setup([dinner, gas]);
      groups.groups.set([trip]);
      await settle();
      ([...el.querySelectorAll('.person')][0].querySelector('.btn-primary') as HTMLElement).click();
      await settle();
      expect((document.getElementById('repay-amount') as HTMLInputElement).value).toBe('50');
      const preview = document.querySelector('.preview')!.textContent!;
      expect(preview).toContain('Ramen Bar');
      expect(preview).toContain('Tahoe Trip');
      button('Save').click();
      await settle();

      const saved = (id: string) => txs.transactions().find(t => t.id === id)!.moneyBack;
      expect(saved(dinner.id!)).toEqual([expect.objectContaining({ amountCents: 3000, fromPersonId: 'm' })]);
      expect(saved(gas.id!)).toEqual([expect.objectContaining({ amountCents: 2000, fromPersonId: 'm' })]);
      // Mrunaal is square; Priya still owes for both.
      expect(el.textContent).toContain('Priya owes you $50.00.');
      expect(el.querySelector('.square')!.textContent).toContain('Mrunaal');
    });

    it('a bill in a group that was deleted counts on its own again', async () => {
      const gas = { ...bill('Chevron', '2026-09-05', 6000, ['m']), id: 'gas' };
      gas.split = { ...gas.split!, groupId: 'gone' };
      await setup([gas]);
      expect(el.querySelector('.group-row')).toBeNull();
      expect(el.textContent).toContain('Mrunaal owes you $30.00.');
    });

    it('New group: name it, add people, and it opens', async () => {
      await setup([]);
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      button('New group').click();
      await settle();
      const name = document.getElementById('group-name') as HTMLInputElement;
      name.value = 'Tahoe Trip';
      name.dispatchEvent(new Event('input'));
      button('+ Mrunaal').click();
      button('+ Priya').click();
      await settle();
      button('Create group').click();
      await settle();

      expect(groups.groups()).toEqual([expect.objectContaining({ name: 'Tahoe Trip', memberIds: ['m', 'p'], simplify: true, payments: [] })]);
      expect(navigate).toHaveBeenCalledWith(['/shared/groups', 'g1']);
    });

    it("won't create a group without a name or anyone in it", async () => {
      await setup([]);
      button('New group').click();
      await settle();
      button('Create group').click();
      await settle();
      expect(errors).toContain('Give the group a name.');
      const name = document.getElementById('group-name') as HTMLInputElement;
      name.value = 'Flat';
      name.dispatchEvent(new Event('input'));
      await settle();
      button('Create group').click();
      await settle();
      expect(errors).toContain('Add at least one person to the group.');
      expect(groups.groups()).toEqual([]);
    });
  });
});
