import { Component, HostListener, computed, effect, inject, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { Transaction } from '../../models';
import { transactionsOn } from '../../utils/calendar';

let nextLockId = 0;

/**
 * What one day cost, after Origin's "Details" popup.
 *
 * Opened from a calendar cell. It lists that day's transactions and hands one
 * back when tapped, so the caller can open its full transaction view — the
 * popup itself is a summary, not an editor.
 *
 * The total is summed from the rows it is showing rather than taken from the
 * calendar cell, so what you read here always adds up to what is listed below
 * it. (Both come from the same filtered set, so they agree; summing locally
 * means they cannot silently drift apart if a caller ever passes a subset.)
 */
@Component({
  selector: 'app-day-detail',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './day-detail.html',
  styleUrl: './day-detail.scss',
})
export class DayDetail {
  private categoryService = inject(CategoryService);
  private accountService = inject(AccountService);
  private scrollLock = inject(ScrollLockService);

  /** Distinct per instance, so two overlays never cancel each other's lock. */
  private lockKey = `day-detail-${nextLockId++}`;

  /** `YYYY-MM-DD`, or null when closed. */
  date = input<string | null>(null);
  /** The day's transactions are filtered out of this set by the component. */
  transactions = input<Transaction[]>([]);
  /** Carries the caller's netting rule into the total. */
  amountOf = input<(t: Transaction) => number>(t => t.amount);

  closed = output<void>();
  txPicked = output<Transaction>();

  constructor() {
    effect(onCleanup => {
      this.scrollLock.set(this.lockKey, !!this.date());
      // Navigating away with the popup open would otherwise leave the app
      // unscrollable.
      onCleanup(() => this.scrollLock.unlock(this.lockKey));
    });
  }

  rows = computed(() => {
    const d = this.date();
    return d ? transactionsOn(this.transactions(), d) : [];
  });

  total = computed(() =>
    Math.round(this.rows().reduce((s, t) => s + this.amountOf()(t), 0) * 100) / 100);

  heading = computed(() => {
    const d = this.date();
    if (!d) return '';
    return new Date(d + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  });

  fullDate = computed(() => {
    const d = this.date();
    if (!d) return '';
    return new Date(d + 'T00:00:00')
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  });

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

  @HostListener('document:keydown.escape')
  onEscape() { if (this.date()) this.close(); }

  close() { this.closed.emit(); }
}
