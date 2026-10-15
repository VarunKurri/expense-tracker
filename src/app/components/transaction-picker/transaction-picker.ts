import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Transaction } from '../../models';
import { formatCurrency } from '../../utils/format';
import { toCents } from '../../utils/money';

/**
 * Pick one of your transactions: a search box ("Vybhav", "99.86") over a
 * list showing each one's name, date and amount. Used wherever a payment is
 * linked to something (money back on a purchase, a repayment on Shared, a
 * group settle-up), so linking reads the same everywhere.
 *
 * The caller decides which transactions qualify; this only searches and
 * ranks them. With `matchCents` / `matchText` (what's owed, and who from),
 * likely matches come first: "Sent by Vybhav · $99.86" above a paycheque.
 * `selectedId` marks the chosen one, for pickers that sit inside a form.
 */
@Component({
  selector: 'app-transaction-picker',
  standalone: true,
  imports: [FormsModule],
  template: `
    <input class="link-search input-field" type="search" [ngModel]="search()" (ngModelChange)="search.set($event)"
           [name]="name()" placeholder="Search merchant or amount…" [attr.aria-label]="'Search ' + name()" />
    <div class="link-list" role="listbox" [attr.aria-label]="name()">
      @for (t of shown(); track t.id) {
        <button type="button" class="link-item" role="option" [class.selected]="t.id === selectedId()"
                [attr.aria-selected]="t.id === selectedId()" (click)="picked.emit(t)">
          <span class="link-item-main">{{ t.merchant || (t.type === 'income' ? 'Income' : 'Expense') }}</span>
          <span class="link-item-meta">
            {{ formatDate(t.date) }} · {{ t.type === 'expense' ? '−' : '+' }}{{ money(t.amount) }}
            @if (t.id === selectedId()) { <span class="link-item-check" aria-hidden="true">✓</span> }
          </span>
        </button>
      } @empty {
        <div class="link-empty">No matching transactions.</div>
      }
    </div>
  `,
  styleUrl: './transaction-picker.scss',
})
export class TransactionPicker {
  transactions = input.required<Transaction[]>();
  selectedId = input<string>('');
  /** What's expected, in cents: transactions of exactly this amount come first. */
  matchCents = input<number>(0);
  /** Who it's from or to: transactions naming them come first. */
  matchText = input<string>('');
  /** Names the search box and list, for screen readers and forms. */
  name = input<string>('transactions');
  picked = output<Transaction>();

  search = signal('');

  shown = computed(() => {
    const q = this.search().trim().toLowerCase().replace(/^\$/, '');
    const cents = this.matchCents();
    const text = this.matchText().trim().toLowerCase();
    const likely = (t: Transaction) =>
      (cents > 0 && toCents(t.amount) === cents) || (!!text && (t.merchant || '').toLowerCase().includes(text));
    return this.transactions()
      .filter(t => !q || (t.merchant || '').toLowerCase().includes(q) || String(t.amount).includes(q) || t.amount.toFixed(2).includes(q))
      .sort((a, b) => Number(likely(b)) - Number(likely(a)) || b.date.localeCompare(a.date))
      .slice(0, 50);
  });

  money(amount: number): string {
    return formatCurrency(amount);
  }

  formatDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
