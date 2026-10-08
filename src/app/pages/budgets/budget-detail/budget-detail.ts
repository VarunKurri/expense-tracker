import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule, Location } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BudgetService } from '../../../services/budget.service';
import { CategoryService } from '../../../services/category.service';
import { TransactionService } from '../../../services/transaction.service';
import { AccountService } from '../../../services/account.service';
import { TransactionForm } from '../../transactions/transaction-form/transaction-form';
import { TransactionView } from '../../../components/transaction-view/transaction-view';
import { Confirm } from '../../../components/confirm/confirm';
import { Transaction } from '../../../models';
import { ToastService } from '../../../services/toast.service';
import { MoneyRules } from '../../../utils/reporting';
import { monthKeyOf, monthLabel } from '../../../utils/calendar';
import { budgetProgress, budgetSpent } from '../../../utils/budgets';

/**
 * One budget, one month: how far through the limit you are and the
 * transactions that got you there.
 *
 * With "Excluding refunded" on (the default, carried over from the Budgets
 * page), every figure here is net: refunded purchases are left out and money
 * friends paid back is subtracted, so the rows add up to the total above them
 * and to the card you clicked on.
 */
@Component({
  selector: 'app-budget-detail',
  standalone: true,
  imports: [CommonModule, TransactionForm, TransactionView, Confirm],
  templateUrl: './budget-detail.html',
  styleUrl: './budget-detail.scss'
})
export class BudgetDetail {
  private toastService = inject(ToastService);

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private location = inject(Location);
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);

  // Transaction view / edit
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  txToDelete = signal<Transaction | null>(null);

  // Route params
  private categoryId = this.route.snapshot.paramMap.get('categoryId') || '';
  private month = this.route.snapshot.paramMap.get('month') || monthKeyOf();

  /** The Budgets page's toggle, carried in the URL. */
  excludeRefunded = this.route.snapshot.queryParamMap.get('excludeRefunded') !== 'false';

  category = computed(() =>
    this.categoryService.categories().find(c => c.id === this.categoryId) || null
  );

  budget = computed(() =>
    this.budgetService.getBudgetForCategory(this.categoryId, this.month) || null
  );

  monthLabel = monthLabel(this.month);

  private rules: MoneyRules = this.txService.moneyRules(this.excludeRefunded);

  /** Every expense in this category and month, newest first — refunded ones included, shown dimmed. */
  transactions = computed(() =>
    this.txService.transactions()
      .filter(t =>
        t.type === 'expense' &&
        !t.isInternalTransfer &&
        t.categoryId === this.categoryId &&
        t.date.startsWith(this.month)
      )
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
  );

  /** The ones that count toward the budget. */
  counted = computed(() =>
    this.transactions().filter(t => !this.isExcluded(t))
  );

  /** What a row counts for: net of reimbursements when excluding refunded. */
  amountOf(t: Transaction): number {
    return this.excludeRefunded ? this.txService.effectiveExpenseAmount(t) : t.amount;
  }

  reimbursedOf(t: Transaction): number {
    return this.txService.moneyBackFor(t);
  }

  isRefunded(t: Transaction): boolean {
    return this.txService.isFullyRefunded(t);
  }

  isExcluded(t: Transaction): boolean {
    return this.excludeRefunded && this.txService.isFullyRefunded(t);
  }

  spent = computed(() =>
    budgetSpent(this.txService.transactions(), this.categoryId, this.month, this.rules)
  );

  remaining = computed(() => (this.budget()?.amount || 0) - this.spent());

  private progress = computed(() => budgetProgress(this.spent(), this.budget()?.amount || 0));
  pct = computed(() => this.progress().pct);
  status = computed(() => this.progress().status);

  average = computed(() => {
    const n = this.counted().length;
    return n ? this.spent() / n : 0;
  });

  largest = computed(() => this.counted().reduce((m, t) => Math.max(m, this.amountOf(t)), 0));

  /** Money paid back on this month's purchases — explains why the total is net. */
  reimbursedTotal = computed(() =>
    this.excludeRefunded
      ? Math.round(this.counted().reduce((s, t) => s + Math.min(t.amount, this.reimbursedOf(t)), 0) * 100) / 100
      : 0
  );

  netNote = computed(() => {
    if (!this.excludeRefunded) return 'Every purchase at its full amount, including refunded ones.';
    const back = this.reimbursedTotal();
    return back > 0
      ? `Net of refunds and reimbursements — ${this.formatCurrency(back)} was paid back to you.`
      : 'Net of refunds and reimbursements.';
  });

  resetDate = computed(() => {
    const [y, m] = this.month.split('-').map(Number);
    return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  });

  // ── Transaction view / edit ────────────────────────────────
  openTxView(tx: Transaction) { this.viewingTx.set(tx); }

  closeTxView() { this.viewingTx.set(null); }

  editFromTxView(tx: Transaction) {
    this.viewingTx.set(null);
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  closeTxForm() {
    this.txFormOpen.set(false);
    this.editingTx.set(null);
  }

  async handleTxSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const tx = this.editingTx();
    if (!tx?.id) return;
    try {
      await this.txService.update(tx.id, data);
      this.closeTxForm();
    } catch {
      this.toastService.error('Could not save. Please try again.');
    }
  }

  askTxDelete() {
    this.txToDelete.set(this.editingTx());
    this.txFormOpen.set(false);
    this.txConfirmOpen.set(true);
  }

  async confirmTxDelete() {
    const tx = this.txToDelete();
    if (!tx?.id) return;
    try {
      await this.txService.remove(tx.id);
    } catch {
      this.toastService.error('Could not delete. Please try again.');
    } finally {
      this.txConfirmOpen.set(false);
      this.txToDelete.set(null);
      this.editingTx.set(null);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  accountName(id?: string): string {
    if (!id) return '—';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? `${a.icon} ${a.name}` : '—';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  formatDate(date: string): string {
    const d = new Date(date + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.getTime() === today.getTime()) return 'Today';
    if (d.getTime() === yesterday.getTime()) return 'Yesterday';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /**
   * Back to Budgets, on the month this page is about. Arriving from the
   * Budgets page, step back through history so this button and the browser's
   * own Back agree; arriving from anywhere else (Spending, the command
   * palette, a shared link), open Budgets on this month.
   */
  goBack() {
    if ((this.location.getState() as { fromBudgets?: boolean } | null)?.fromBudgets) {
      this.location.back();
      return;
    }
    this.router.navigate(['/budgets'], {
      queryParams: {
        month: this.month === monthKeyOf() ? null : this.month,
        excludeRefunded: this.excludeRefunded ? null : 'false',
      },
    });
  }
}
