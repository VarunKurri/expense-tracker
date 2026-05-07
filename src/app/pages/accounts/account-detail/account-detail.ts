import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountService } from '../../../services/account.service';
import { TransactionService } from '../../../services/transaction.service';
import { CategoryService } from '../../../services/category.service';
import { AccountForm } from '../account-form/account-form';
import { Confirm } from '../../../components/confirm/confirm';
import { Account } from '../../../models';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-account-detail',
  standalone: true,
  imports: [CommonModule, AccountForm, Confirm],
  templateUrl: './account-detail.html',
  styleUrl: './account-detail.scss'
})
export class AccountDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private txService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private toastService = inject(ToastService);

  formOpen = signal(false);
  confirmOpen = signal(false);

  account = computed(() => {
    const id = this.route.snapshot.paramMap.get('id');
    return this.accountService.accounts().find(a => a.id === id) || null;
  });

  balance = computed(() => {
    const a = this.account();
    if (!a) return 0;
    const txDelta = this.txService.balanceForAccount(a.id!);
    if (a.type === 'credit') return a.openingBalance - txDelta;
    return (a.openingBalance || 0) + txDelta;
  });

  availableCredit = computed(() => {
    const a = this.account();
    if (!a?.creditLimit) return 0;
    return a.creditLimit - this.balance();
  });

  utilizationPct = computed(() => {
    const a = this.account();
    if (!a?.creditLimit) return 0;
    return Math.min(100, Math.round((this.balance() / a.creditLimit) * 100));
  });

  paymentDueDate = computed(() => {
    const a = this.account();
    if (!a?.paymentDueDay) return null;
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), a.paymentDueDay);
    if (due < today) due.setMonth(due.getMonth() + 1);
    return due.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  statementDate = computed(() => {
    const a = this.account();
    if (!a?.statementClosingDay) return null;
    const today = new Date();
    const closing = new Date(today.getFullYear(), today.getMonth(), a.statementClosingDay);
    if (closing < today) closing.setMonth(closing.getMonth() + 1);
    return closing.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  });

  utilizationColor = computed(() => {
    const pct = this.utilizationPct();
    if (pct >= 80) return 'var(--red)';
    if (pct >= 60) return 'var(--amber)';
    return 'var(--green)';
  });

  // Last 8 transactions for this account, sorted newest first
  recentTransactions = computed(() => {
    const a = this.account();
    if (!a?.id) return [];
    return this.txService.transactions()
      .filter(t => {
        if (t.type === 'transfer') {
          return t.fromAccountId === a.id || t.toAccountId === a.id;
        }
        return t.accountId === a.id;
      })
      .sort((a, b) => b.date.localeCompare(a.date))
      .slice(0, 8);
  });

  // Helpers for the recent transactions list
  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id);
  }

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

  goBack() { this.router.navigate(['/accounts']); }

  viewAllTransactions() {
    const a = this.account();
    if (!a?.id) return;
    // Navigate to transactions — the account filter will be handled by query param
    // If your router supports it; otherwise just navigate to /transactions
    this.router.navigate(['/transactions'], { queryParams: { accountId: a.id } });
  }

  async handleSave(data: Omit<Account, 'id' | 'createdAt'>) {
    const a = this.account();
    if (!a?.id) return;
    try {
      await this.accountService.update(a.id, data);
      this.formOpen.set(false);
    } catch (err) {
      this.toastService.error('Failed. Please try again.');
    }
  }

  askDelete() {
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  async confirmDelete() {
    const a = this.account();
    if (!a?.id) return;
    try {
      await this.accountService.remove(a.id);
      this.router.navigate(['/accounts']);
    } finally {
      this.confirmOpen.set(false);
    }
  }
}