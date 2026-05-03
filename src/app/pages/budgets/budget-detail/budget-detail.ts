import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { BudgetService } from '../../../services/budget.service';
import { CategoryService } from '../../../services/category.service';
import { TransactionService } from '../../../services/transaction.service';
import { AccountService } from '../../../services/account.service';
import { TransactionForm } from '../../transactions/transaction-form/transaction-form';
import { Confirm } from '../../../components/confirm/confirm';
import { Transaction } from '../../../models';

@Component({
  selector: 'app-budget-detail',
  standalone: true,
  imports: [CommonModule, TransactionForm, Confirm],
  templateUrl: './budget-detail.html',
  styleUrl: './budget-detail.scss'
})
export class BudgetDetail {
  Math = Math;

  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private budgetService = inject(BudgetService);
  private categoryService = inject(CategoryService);
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);

  // Transaction view/edit panel
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  txToDelete = signal<Transaction | null>(null);

  // Route params
  private categoryId = computed(() =>
    this.route.snapshot.paramMap.get('categoryId') || ''
  );
  private month = computed(() =>
    this.route.snapshot.paramMap.get('month') || new Date().toISOString().slice(0, 7)
  );

  // Respect the excludeRefunded toggle from the budgets list page
  excludeRefunded = this.route.snapshot.queryParamMap.get('excludeRefunded') !== 'false';

  category = computed(() =>
    this.categoryService.categories().find(c => c.id === this.categoryId()) || null
  );

  budget = computed(() =>
    this.budgetService.getBudgetForCategory(this.categoryId(), this.month()) || null
  );

  monthLabel = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric'
    });
  });

  transactions = computed(() =>
    this.txService.transactions()
      .filter(t =>
        t.type === 'expense' &&
        t.categoryId === this.categoryId() &&
        t.date.startsWith(this.month())
      )
      .sort((a, b) => b.date.localeCompare(a.date))
  );

  // Transactions used for budget calculation — respects excludeRefunded
  spendingTransactions = computed(() =>
    this.transactions().filter(t => !(this.excludeRefunded && t.refunded))
  );

  spent = computed(() =>
    this.spendingTransactions().reduce((s, t) => s + t.amount, 0)
  );

  remaining = computed(() => (this.budget()?.amount || 0) - this.spent());

  pct = computed(() => {
    const b = this.budget();
    if (!b || b.amount === 0) return 0;
    return Math.min(100, Math.round((this.spent() / b.amount) * 100));
  });

  status = computed((): 'ok' | 'warn' | 'over' => {
    const p = this.pct();
    if (p >= 100) return 'over';
    if (p >= 75) return 'warn';
    return 'ok';
  });

  resetDate = computed(() => {
    const [y, m] = this.month().split('-').map(Number);
    return new Date(y, m, 1).toLocaleDateString('en-US', {
      month: 'long', day: 'numeric'
    });
  });

  // Transaction view panel
  openTxView(tx: Transaction) {
    this.viewingTx.set(tx);
    document.body.style.overflow = 'hidden';
  }

  closeTxView() {
    this.viewingTx.set(null);
    document.body.style.overflow = '';
  }

  editFromTxView() {
    const tx = this.viewingTx();
    this.viewingTx.set(null);
    document.body.style.overflow = '';
    if (tx) {
      this.editingTx.set(tx);
      this.txFormOpen.set(true);
    }
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
    } catch (err) {
      alert('Failed: ' + (err as Error).message);
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
    } finally {
      this.txConfirmOpen.set(false);
      this.txToDelete.set(null);
      this.editingTx.set(null);
    }
  }

  // Helpers
  accountName(id?: string): string {
    if (!id) return '—';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? `${a.icon} ${a.name}` : '—';
  }

  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id) || null;
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  formatFullDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
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

  goBack() {
    this.router.navigate(['/budgets']);
  }
}