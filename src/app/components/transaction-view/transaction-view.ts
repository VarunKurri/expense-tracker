import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { ToastService } from '../../services/toast.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { Modal } from '../modal/modal';
import { Transaction } from '../../models';

let nextLockId = 0;

/**
 * A single transaction in full, read-only, as a centred card on desktop and a
 * sheet that rises from the bottom on a phone.
 *
 * This is the *only* transaction view in the app. It started as a copy in
 * `dashboard.html` alongside near-identical ones in `analysis.html` and
 * `transactions.html`, and the copies had drifted: only the Transactions one
 * grew reimbursement linking, so the same transaction told you a different
 * story depending on which screen you opened it from — and the one place the
 * numbers most need explaining (an expense that was partly paid back) was the
 * part that was missing everywhere else.
 *
 * It reads the transaction back out of the service rather than trusting the
 * input, which is a snapshot taken when the panel opened. Linking or unlinking
 * a reimbursement has to be visible immediately, without the caller having to
 * know to re-feed it.
 */
@Component({
  selector: 'app-transaction-view',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './transaction-view.html',
  styleUrl: './transaction-view.scss',
})
export class TransactionView {
  private categoryService = inject(CategoryService);
  private accountService = inject(AccountService);
  private toast = inject(ToastService);
  private scrollLock = inject(ScrollLockService);
  txService = inject(TransactionService);

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

  /**
   * The transaction as it stands now, not as it was when the panel opened.
   * Falls back to the input while the service is still loading.
   */
  tx = computed<Transaction | null>(() => {
    const snapshot = this.transaction();
    if (!snapshot?.id) return snapshot;
    return this.txService.transactions().find(t => t.id === snapshot.id) ?? snapshot;
  });

  // ── Reimbursements ─────────────────────────────────────────
  reimbursements = computed(() => {
    const id = this.tx()?.id;
    return id ? this.txService.reimbursementsFor(id) : [];
  });

  reimbursedTotal = computed(() =>
    this.txService.reimbursedAmountFor(this.tx()?.id ?? undefined));

  /**
   * The part of the reimbursed total that exceeds the expense — the difference
   * between "you still spent something" and "you came out ahead".
   */
  reimbursementSurplus = computed(() => {
    const t = this.tx();
    return t ? this.txService.reimbursementSurplus(t) : 0;
  });

  netExpense = computed(() => {
    const t = this.tx();
    return t ? this.txService.effectiveExpenseAmount(t) : 0;
  });

  /** For an income that pays back an expense: the expense it pays back. */
  reimbursesExpense = computed<Transaction | null>(() => {
    const t = this.tx();
    if (t?.type !== 'income' || !t.reimbursesId) return null;
    return this.txService.transactions().find(x => x.id === t.reimbursesId) ?? null;
  });

  /** Shown on the income side too, so a surplus is visible from either end. */
  reimbursesSurplus = computed(() => {
    const exp = this.reimbursesExpense();
    return exp ? this.txService.reimbursementSurplus(exp) : 0;
  });

  reimbursesCovered = computed(() => {
    const exp = this.reimbursesExpense();
    if (!exp) return 0;
    return Math.min(exp.amount, this.txService.reimbursedAmountFor(exp.id));
  });

  // ── Link picker ────────────────────────────────────────────
  linkingFrom = signal<Transaction | null>(null);
  linkSearch = signal('');

  /** Opposite-type transactions: an expense picks an income, and vice versa. */
  linkCandidates = computed<Transaction[]>(() => {
    const from = this.linkingFrom();
    if (!from) return [];
    const wantType = from.type === 'income' ? 'expense' : 'income';
    const q = this.linkSearch().trim().toLowerCase();
    return this.txService.transactions().filter(t =>
      t.type === wantType && t.id !== from.id &&
      // An income can only ever reimburse one expense.
      !(t.type === 'income' && !!t.reimbursesId) &&
      (!q || (t.merchant || '').toLowerCase().includes(q) || String(t.amount).includes(q))
    ).slice(0, 50);
  });

  openLinkPicker(tx: Transaction) {
    this.linkSearch.set('');
    this.linkingFrom.set(tx);
  }

  closeLinkPicker() {
    this.linkingFrom.set(null);
    this.linkSearch.set('');
  }

  async confirmLink(candidate: Transaction) {
    const from = this.linkingFrom();
    if (!from) return;
    const income = from.type === 'income' ? from : candidate;
    const expense = from.type === 'expense' ? from : candidate;
    if (!income.id || !expense.id) return;
    try {
      await this.txService.update(income.id, { reimbursesId: expense.id });
      this.toast.success('Reimbursement linked.');
      this.closeLinkPicker();
    } catch {
      this.toast.error('Could not link. Please try again.');
    }
  }

  async unlinkReimbursement(income: Transaction) {
    if (!income.id) return;
    try {
      await this.txService.update(income.id, { reimbursesId: undefined });
      this.toast.success('Reimbursement unlinked.');
    } catch {
      this.toast.error('Could not unlink. Please try again.');
    }
  }

  // ── Lookups & formatting ───────────────────────────────────
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

  formatDate(date: string): string {
    return new Date(date + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatFullDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    // The picker sits on top of the panel, so Escape closes that first.
    if (this.linkingFrom()) { this.closeLinkPicker(); return; }
    if (this.transaction()) this.close();
  }

  close() {
    this.closeLinkPicker();
    this.closed.emit();
  }

  edit() {
    const t = this.tx();
    if (t) this.editRequested.emit(t);
  }
}
