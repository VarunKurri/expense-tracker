import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { ItemizedSplitEditor } from './itemized-split-editor';
import { PersonService } from '../../services/person.service';
import { ToastService } from '../../services/toast.service';
import { ME, SplitPerson } from '../../models';
import {
  ItemizedSplitState, buildItemizedSplit, emptyItemizedState, itemizedBillCents, personName, splitProblems, splitStatus,
} from '../../utils/splits';

class FakePeople {
  people = signal<SplitPerson[]>([{ id: 'alex', name: 'Alex', createdAt: 0, updatedAt: 0 }]);
  nameOf(id: string) { return personName(this.people(), id); }
  async add(p: { name: string }) { return p.name.toLowerCase(); }
}

@Component({
  standalone: true,
  imports: [ItemizedSplitEditor],
  template: `<app-itemized-split-editor [myPaidCents]="paid()" [(state)]="state" (useAmount)="paid.set($event)" />`,
})
class Host {
  paid = signal(0);
  state = signal<ItemizedSplitState>({ ...emptyItemizedState(), participantIds: [ME, 'alex'] });
}

describe('ItemizedSplitEditor', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const buttons = (text: string) =>
    [...el.querySelectorAll('button')].filter(b => b.textContent!.trim() === text) as HTMLButtonElement[];
  const button = (text: string) => buttons(text)[0];
  async function type(input: Element, value: string) {
    (input as HTMLInputElement).value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }
  const names = () => [...el.querySelectorAll('input[aria-label="Item name"]')];
  const prices = () => [...el.querySelectorAll('input[aria-label="Price"]')];
  const items = () => [...el.querySelectorAll('.item')] as HTMLElement[];
  const chipIn = (item: HTMLElement, text: string) =>
    [...item.querySelectorAll('button.chip')].find(b => b.textContent!.trim() === text) as HTMLButtonElement;

  /** Steak (you) $30, Salad (Alex) $10, Wine (both) $20. */
  async function enterDinner() {
    await type(names()[0], 'Steak');
    await type(prices()[0], '30');
    chipIn(items()[0], 'You').click();
    button('+ Add item').click(); await settle();
    await type(names()[1], 'Salad');
    await type(prices()[1], '10');
    chipIn(items()[1], 'Alex').click();
    button('+ Add item').click(); await settle();
    await type(names()[2], 'Wine');
    await type(prices()[2], '20');
    chipIn(items()[2], 'You').click();
    chipIn(items()[2], 'Alex').click();
    await settle();
  }

  beforeEach(async () => {
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: PersonService, useValue: new FakePeople() },
        { provide: ToastService, useValue: { success() {}, error() {} } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    await settle();
  });

  it('items, tax and tip: shared in proportion to what each person had', async () => {
    await enterDinner();
    await type(el.querySelector('input[aria-label="Tax"]')!, '10');
    await type(el.querySelector('input[aria-label="Tip"]')!, '20');
    // $60 of items, $6 tax, $12 tip = $78. Alex had $20 of $60: a third of tax and tip.
    expect(itemizedBillCents(host.state())).toBe(7800);
    expect(el.textContent).toContain('Items $60.00 · tax $6.00 · tip $12.00');
    host.paid.set(7800); // you paid the $78 bill
    await settle();
    const alex = [...el.querySelectorAll('.summary-row')].find(r => r.textContent!.includes('Alex'))!;
    expect(alex.textContent).toContain('$26.00');
    expect(alex.textContent).toContain('Owes you · 2 items · tax $2.00 · tip $4.00');
    expect(el.textContent).toContain('✓ Adds up');
  });

  it('when the receipt and the amount disagree, offers to use the receipt total', async () => {
    await enterDinner();
    expect(el.textContent).toContain('$60.00 of $0.00 added');
    expect(el.textContent).toContain('$60.00 over');
    button('Or make the amount $60.00 to match the receipt').click();
    await settle();
    expect(host.paid()).toBe(6000);
    expect(el.textContent).toContain('✓ Adds up');
    expect(el.textContent).not.toContain('to match the receipt');
    expect(splitProblems(buildItemizedSplit(host.state(), host.paid()), host.paid())).toEqual([]);
  });

  it('flags an item nobody had, and "Give unclaimed items to me" claims it', async () => {
    await enterDinner();
    button('+ Add item').click(); await settle();
    await type(names()[3], 'Dessert');
    await type(prices()[3], '9');
    expect(el.textContent).toContain("Some items aren't anyone's yet.");
    expect(el.textContent).toContain('Nobody yet');
    button('Give unclaimed items to me').click();
    await settle();
    expect(el.textContent).not.toContain("Some items aren't anyone's yet.");
    expect(host.state().items[3].assignments).toEqual([{ personId: ME, weight: 1 }]);
  });

  it('an item split unevenly: Alex had two thirds of the wine', async () => {
    await enterDinner();
    const select = items()[2].querySelector('select') as HTMLSelectElement;
    select.value = 'shares';
    select.dispatchEvent(new Event('change'));
    await settle();
    const [mine, alex] = [...items()[2].querySelectorAll('.item-weights input')];
    await type(mine, '1');
    await type(alex, '2');
    host.paid.set(6000);
    await settle();
    const s = splitStatus(buildItemizedSplit(host.state(), 6000));
    // Alex: $10 salad + $13.33 of the wine.
    expect(s.people[0].shareCents).toBe(2333);
  });

  it('tip on items + tax uses the larger base', async () => {
    await enterDinner();
    await type(el.querySelector('input[aria-label="Tax"]')!, '10');
    await type(el.querySelector('input[aria-label="Tip"]')!, '20');
    button('Items + tax').click();
    await settle();
    expect(el.textContent).toContain('tip $13.20'); // 20% of $66
  });

  it('removing someone takes them off every item', async () => {
    await enterDinner();
    (el.querySelector('[aria-label="Remove Alex"]') as HTMLElement).click();
    await settle();
    expect(host.state().items.flatMap(i => i.assignments.map(a => a.personId))).not.toContain('alex');
  });

  it('shows how much is left to add while tax and tip are typed', async () => {
    await enterDinner();
    host.paid.set(7800);
    await settle();
    expect(el.textContent).toContain('$60.00 of $78.00 added');
    expect(el.textContent).toContain('$18.00 left');
    await type(el.querySelector('input[aria-label="Tax"]')!, '10');
    expect(el.textContent).toContain('$12.00 left');
    await type(el.querySelector('input[aria-label="Tip"]')!, '20');
    expect(el.textContent).toContain('✓ Adds up');
  });
});
