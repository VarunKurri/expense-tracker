import { Component, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { describe, it, expect } from 'vitest';
import { TransactionPicker } from './transaction-picker';
import { Transaction } from '../../models';

const tx = (id: string, merchant: string, amount: number, date: string): Transaction =>
  ({ id, type: 'income', merchant, amount, date, accountId: 'a', createdAt: 0, updatedAt: 0 }) as Transaction;

@Component({
  standalone: true,
  imports: [TransactionPicker],
  template: `<app-transaction-picker [transactions]="list" [selectedId]="chosen()" [matchCents]="9986" matchText="Vybhav"
                                     (picked)="chosen.set($event.id!)" />`,
})
class Host {
  list = [
    tx('loan', 'Loan Amount by Vishal', 750, '2026-09-28'),
    tx('vyb', 'Sent by Vybhav', 99.86, '2026-09-17'),
    tx('mru', 'Sent by Mrunaal', 1.9, '2026-09-16'),
    tx('dad', 'Credit from Dad', 2000, '2026-08-12'),
  ];
  chosen = signal('');
}

describe('TransactionPicker', () => {
  async function render() {
    const fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
    await fixture.whenStable();
    const el: HTMLElement = fixture.nativeElement;
    const names = () => [...el.querySelectorAll('.link-item-main')].map(n => n.textContent!.trim());
    const search = async (q: string) => {
      const input = el.querySelector('.link-search') as HTMLInputElement;
      input.value = q;
      input.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      await fixture.whenStable();
    };
    return { fixture, el, names, search };
  }

  it('lists the likely match first (who it is from, or exactly what is owed), then newest first', async () => {
    const { names } = await render();
    expect(names()).toEqual(['Sent by Vybhav', 'Loan Amount by Vishal', 'Sent by Mrunaal', 'Credit from Dad']);
  });

  it('searches by name or amount', async () => {
    const { el, names, search } = await render();
    await search('mrunaal');
    expect(names()).toEqual(['Sent by Mrunaal']);
    await search('1.90');
    expect(names()).toEqual(['Sent by Mrunaal']);
    await search('$750');
    expect(names()).toEqual(['Loan Amount by Vishal']);
    await search('nothing like it');
    expect(el.textContent).toContain('No matching transactions.');
  });

  it('marks the one picked', async () => {
    const { fixture, el } = await render();
    (el.querySelectorAll('.link-item')[0] as HTMLElement).click();
    fixture.detectChanges();
    expect(fixture.componentInstance.chosen()).toBe('vyb');
    expect(el.querySelectorAll('.link-item.selected').length).toBe(1);
  });
});
