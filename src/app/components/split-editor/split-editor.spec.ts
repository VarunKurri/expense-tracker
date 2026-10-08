import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { describe, it, expect, beforeEach } from 'vitest';
import { SplitEditor } from './split-editor';
import { PersonService } from '../../services/person.service';
import { ToastService } from '../../services/toast.service';
import { ME, SplitPerson } from '../../models';
import { QuickSplitState, buildQuickSplit, emptyQuickState, personName, splitStatus } from '../../utils/splits';

class FakePeople {
  people = signal<SplitPerson[]>([{ id: 'alex', name: 'Alex', createdAt: 0, updatedAt: 0 }]);
  added: string[] = [];
  nameOf(id: string) { return personName(this.people(), id); }
  async add(p: { name: string }) {
    const id = p.name.toLowerCase();
    this.added.push(p.name);
    this.people.update(all => [...all, { id, name: p.name, createdAt: 0, updatedAt: 0 }]);
    return id;
  }
}

@Component({
  standalone: true,
  imports: [SplitEditor],
  template: `<app-split-editor [myPaidCents]="paid()" [(state)]="state" />`,
})
class Host {
  paid = signal(18000);
  state = signal<QuickSplitState>(emptyQuickState());
}

describe('SplitEditor (quick split)', () => {
  let fixture: ComponentFixture<Host>;
  let host: Host;
  let people: FakePeople;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }
  const button = (text: string) =>
    [...el.querySelectorAll('button')].find(b => b.textContent!.trim() === text) as HTMLButtonElement;
  async function typeInto(input: HTMLInputElement, value: string) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
    await settle();
  }
  async function addByName(name: string) {
    await typeInto(el.querySelector('input[aria-label="Add someone by name"]') as HTMLInputElement, name);
    button('Add').click();
    await settle();
  }
  const saved = () => splitStatus(buildQuickSplit(host.state(), host.paid()));

  beforeEach(async () => {
    people = new FakePeople();
    TestBed.configureTestingModule({
      imports: [Host],
      providers: [
        { provide: PersonService, useValue: people },
        { provide: ToastService, useValue: { success() {}, error() {} } },
      ],
    });
    fixture = TestBed.createComponent(Host);
    host = fixture.componentInstance;
    el = fixture.nativeElement;
    await settle();
  });

  it('asks for someone to split with until there is one', () => {
    expect(el.textContent).toContain('Add someone to split with.');
  });

  it('adds a saved person from a suggestion, and someone new by name (saved for next time)', async () => {
    button('+ Alex').click();
    await settle();
    await addByName('Ben');
    expect(people.added).toEqual(['Ben']);
    expect(host.state().participantIds).toEqual([ME, 'alex', 'ben']);
    // $180 three ways
    expect(el.textContent).toContain('owes you $60.00');
    expect(el.textContent).toContain('$120.00 is owed back to you');
    expect(el.textContent).not.toContain('Add someone to split with.');
  });

  it('reuses a saved person when their name is typed instead of creating a duplicate', async () => {
    await addByName('alex');
    expect(people.added).toEqual([]);
    expect(host.state().participantIds).toEqual([ME, 'alex']);
  });

  it('paid for others: leave yourself out and all of it is owed back', async () => {
    await addByName('Ben');
    button('+ Alex').click();
    await settle();
    button('You').click();
    await settle();
    expect(el.textContent).toContain("You're not in the split");
    expect(saved().myShareCents).toBe(0);
    expect(saved().owedToMeCents).toBe(18000);
  });

  it('switching to Amounts restates the split, and typing an amount changes the shares', async () => {
    button('+ Alex').click();
    await settle();
    button('Amounts').click();
    await settle();
    const inputs = [...el.querySelectorAll('.weights input')] as HTMLInputElement[];
    expect(inputs.map(i => i.value)).toEqual(['90', '90']);
    await typeInto(inputs[0], '120');
    // $120 + $90 ≠ $180: still divided in proportion, and it says so.
    expect(el.textContent).toContain('more than the bill');
    await typeInto(inputs[1], '60');
    expect(el.textContent).not.toContain('more than the bill');
    expect(saved().owedToMeCents).toBe(6000);
  });

  it('someone else paying part of it makes the bill bigger (scenario 2)', async () => {
    button('+ Alex').click();
    await settle();
    await addByName('Ben');
    (el.querySelector('[aria-label="Someone else paid part of it"]') as HTMLElement).click();
    await settle();
    await typeInto(el.querySelector('input[aria-label="How much they paid"]') as HTMLInputElement, '60');
    // You paid $180, Alex $60: a $240 bill, $80 each. Alex is $20 short, Ben owes all $80.
    const s = saved();
    expect(s.billTotalCents).toBe(24000);
    expect(s.myShareCents).toBe(8000);
    expect(s.people.map(p => [p.personId, p.dueToMeCents])).toEqual([['alex', 2000], ['ben', 8000]]);
    expect(el.textContent).toContain('$240.00');
    expect(el.textContent).toContain('$100.00 is owed back to you');
    expect(el.textContent).not.toContain('between them');
  });

  it('a friend who paid more than their share is owed by the others, not by you', async () => {
    button('+ Alex').click();
    await settle();
    await addByName('Ben');
    (el.querySelector('[aria-label="Someone else paid part of it"]') as HTMLElement).click();
    await settle();
    await typeInto(el.querySelector('input[aria-label="How much they paid"]') as HTMLInputElement, '120');
    // A $300 bill, $100 each: Ben owes you $80 and Alex $20.
    expect(saved().owedToMeCents).toBe(8000);
    expect(el.textContent).toContain('Ben owes Alex $20.00 — between them.');
  });

  it('removing a person also removes them as a payer', async () => {
    button('+ Alex').click();
    await settle();
    (el.querySelector('[aria-label="Someone else paid part of it"]') as HTMLElement).click();
    await settle();
    (el.querySelector('[aria-label="Remove Alex"]') as HTMLElement).click();
    await settle();
    expect(host.state().otherPayments).toEqual([]);
  });
});
