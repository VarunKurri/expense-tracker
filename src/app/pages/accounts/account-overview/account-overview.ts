import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';
import { AccountService } from '../../../services/account.service';
import { TransactionService } from '../../../services/transaction.service';
import { CategoryService } from '../../../services/category.service';
import { AccountForm } from '../account-form/account-form';
import { Confirm } from '../../../components/confirm/confirm';
import { Account } from '../../../models';

@Component({
  selector: 'app-account-overview',
  standalone: true,
  imports: [CommonModule, AccountForm, Confirm],
  templateUrl: './account-overview.html',
  styleUrl: './account-overview.scss'
})
export class AccountOverview {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private accountService = inject(AccountService);
  private txService = inject(TransactionService);
  private categoryService = inject(CategoryService);

  formOpen = signal(false);
  confirmOpen = signal(false);

  account = computed(() => {
    const id = this.route.snapshot.paramMap.get('id');
    return this.accountService.accounts().find(a => a.id === id) || null;
  });

  balance = computed(() => {
    const a = this.account();
    if (!a) return 0;
    const delta = this.txService.balanceForAccount(a.id!);
    return (a.openingBalance || 0) + delta;
  });

  // This month's income and expenses for this account
  monthlyStats = computed(() => {
    const a = this.account();
    if (!a?.id) return { income: 0, expenses: 0 };
    const now = new Date();
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const monthStart = `${y}-${m}-01`;
    const monthEnd = `${y}-${m}-${String(new Date(y, now.getMonth() + 1, 0).getDate()).padStart(2, '0')}`;

    let income = 0, expenses = 0;
    for (const t of this.txService.transactions()) {
      if (t.date < monthStart || t.date > monthEnd) continue;
      const belongsToAccount = t.type === 'transfer'
        ? t.fromAccountId === a.id || t.toAccountId === a.id
        : t.accountId === a.id;
      if (!belongsToAccount) continue;
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expenses += t.amount;
    }
    return { income, expenses };
  });

  // Last 8 transactions for this account
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

  typeLabel = computed(() => {
    const type = this.account()?.type;
    const map: Record<string, string> = {
      checking: 'Checking',
      savings: 'Savings',
      cash: 'Cash',
      investment: 'Investment',
    };
    return map[type || ''] || 'Account';
  });

  typeIcon = computed(() => {
    const type = this.account()?.type;
    const map: Record<string, string> = {
      checking: '🏦',
      savings: '🏦',
      cash: '💵',
      investment: '📈',
    };
    return map[type || ''] || '💰';
  });

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
    this.router.navigate(['/transactions'], { queryParams: { accountId: a.id } });
  }

  async handleSave(data: Omit<Account, 'id' | 'createdAt'>) {
    const a = this.account();
    if (!a?.id) return;
    try {
      await this.accountService.update(a.id, data);
      this.formOpen.set(false);
    } catch (err) {
      alert('Failed: ' + (err as Error).message);
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