import { Component, HostListener, effect, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { Transaction } from '../../models';

let nextLockId = 0;

/**
 * A single transaction, read-only, as a centred card on desktop and a sheet
 * that rises from the bottom on a phone.
 *
 * Lifted out of `dashboard.html`, which had grown its own copy alongside a
 * near-identical one in `analysis.html`. The Analysis page still has its own —
 * moving it too would mean editing a page that is not otherwise part of this
 * change, so it is left for a follow-up rather than done blind.
 *
 * Owns its own body-scroll lock, so a caller cannot forget to release it.
 */
@Component({
  selector: 'app-transaction-view',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transaction-view.html',
  styleUrl: './transaction-view.scss',
})
export class TransactionView {
  private categoryService = inject(CategoryService);
  private accountService = inject(AccountService);
  private scrollLock = inject(ScrollLockService);

  /** Distinct per instance, so two overlays never cancel each other's lock. */
  private lockKey = `tx-view-${nextLockId++}`;

  transaction = input<Transaction | null>(null);

  closed = output<void>();
  editRequested = output<Transaction>();

  constructor() {
    effect(onCleanup => {
      this.scrollLock.set(this.lockKey, !!this.transaction());
      // Navigating away with the panel open would otherwise leave the whole
      // app unscrollable.
      onCleanup(() => this.scrollLock.unlock(this.lockKey));
    });
  }

  categoryFor(id?: string) {
    return id ? this.categoryService.categories().find(c => c.id === id) ?? null : null;
  }

  accountName(id?: string): string {
    return id ? this.accountService.accounts().find(a => a.id === id)?.name ?? '' : '';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
      .format(Math.abs(n));
  }

  formatFullDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() { if (this.transaction()) this.close(); }

  close() { this.closed.emit(); }

  edit() {
    const tx = this.transaction();
    if (tx) this.editRequested.emit(tx);
  }
}
