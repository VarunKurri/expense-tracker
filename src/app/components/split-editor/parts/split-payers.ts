import { Component, computed, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Payment } from '../../../models';
import { PersonService } from '../../../services/person.service';
import { ToastService } from '../../../services/toast.service';
import { fromCents, toCents } from '../../../utils/money';

/**
 * "Someone else paid part of it": the people besides you who paid the
 * merchant, and how much. Shared by both split editors.
 */
@Component({
  selector: 'app-split-payers',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="toggle-row">
      <div>
        <div class="toggle-label">Someone else paid part of it</div>
        <div class="toggle-sub">{{ hint() }}</div>
      </div>
      <button type="button" class="toggle" role="switch" [class.on]="on()" [attr.aria-checked]="on()"
              aria-label="Someone else paid part of it" (click)="toggle()"></button>
    </div>
    @if (on()) {
      <div class="weights">
        @for (p of payments(); track $index; let i = $index) {
          <div class="weight-row payer">
            <select class="input-field" [ngModel]="p.personId" (ngModelChange)="setPerson(i, $event)" [name]="'payer-' + i"
                    aria-label="Who paid">
              @for (id of choices(p.personId); track id) { <option [value]="id">{{ people.nameOf(id) }}</option> }
            </select>
            <span class="input-affix"><span class="affix">$</span>
              <input class="input-field" type="number" step="0.01" min="0" inputmode="decimal"
                     [ngModel]="value(p.amountCents)" (ngModelChange)="setAmount(i, $event)"
                     [name]="'payer-amt-' + i" placeholder="0.00" aria-label="How much they paid" />
            </span>
            <button type="button" class="person-remove" (click)="remove(i)" aria-label="Remove payer">✕</button>
          </div>
        }
      </div>
      @if (choices('').length) {
        <button type="button" class="link-btn add-payer" (click)="add()">+ Someone else paid too</button>
      }
    }
  `,
  styleUrl: './split-parts.scss',
})
export class SplitPayers {
  people = inject(PersonService);
  private toast = inject(ToastService);

  /** Payments by people other than you. */
  payments = model.required<Payment[]>();
  /** Who could have paid: everyone on the bill but you. */
  candidates = input.required<string[]>();
  hint = input('The bill is what you paid plus what they paid.');

  on = computed(() => this.payments().length > 0);

  toggle() {
    if (this.on()) { this.payments.set([]); return; }
    const first = this.candidates()[0];
    if (!first) { this.toast.error('Add the people you split with first.'); return; }
    this.payments.set([{ personId: first, amountCents: 0 }]);
  }

  /** People who could still be picked for a row: its own person, plus anyone not already paying. */
  choices(current: string): string[] {
    const taken = new Set(this.payments().map(p => p.personId));
    return this.candidates().filter(id => id === current || !taken.has(id));
  }

  add() {
    const next = this.choices('')[0];
    if (next) this.payments.update(ps => [...ps, { personId: next, amountCents: 0 }]);
  }

  setPerson(index: number, personId: string) {
    this.payments.update(ps => ps.map((p, i) => i === index ? { ...p, personId } : p));
  }

  value(cents: number): number | null {
    return cents ? fromCents(cents) : null;
  }

  setAmount(index: number, raw: number | string | null) {
    const n = Number(raw);
    const amountCents = Number.isFinite(n) && n > 0 ? toCents(n) : 0;
    this.payments.update(ps => ps.map((p, i) => i === index ? { ...p, amountCents } : p));
  }

  remove(index: number) {
    this.payments.update(ps => ps.filter((_, i) => i !== index));
  }
}
