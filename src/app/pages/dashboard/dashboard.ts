import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { MigrationService } from '../../services/migration.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private accounts = inject(AccountService);
  private transactions = inject(TransactionService);
  private migration = inject(MigrationService);
  private router = inject(Router);

  migrating = signal(false);
  migrationResult = signal<string | null>(null);
  activeRange = signal<'7D' | '30D' | '90D' | 'YTD'>('30D');

  activeAccounts = computed(() =>
    this.accounts.accounts().filter(a => !a.archived)
  );

  balanceFor(accountId: string, openingBalance: number): number {
    return openingBalance + this.transactions.balanceForAccount(accountId);
  }

  netWorth = computed(() =>
    this.activeAccounts().reduce((sum, a) =>
      sum + this.balanceFor(a.id!, a.openingBalance), 0)
  );

  thisMonthIncome = computed(() => {
    const month = new Date().toISOString().slice(0, 7);
    return this.transactions.transactions()
      .filter(t => t.type === 'income' && t.date.startsWith(month))
      .reduce((s, t) => s + t.amount, 0);
  });

  thisMonthExpenses = computed(() => {
    const month = new Date().toISOString().slice(0, 7);
    return this.transactions.transactions()
      .filter(t => t.type === 'expense' && t.date.startsWith(month))
      .reduce((s, t) => s + t.amount, 0);
  });

  savingsRate = computed(() => {
    const income = this.thisMonthIncome();
    if (!income) return 0;
    return Math.round(((income - this.thisMonthExpenses()) / income) * 100);
  });

  formatWhole(n: number): string {
    return Math.abs(Math.floor(n)).toLocaleString('en-US');
  }

  formatCents(n: number): string {
    return Math.abs(n % 1).toFixed(2).slice(1);
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(n);
  }

  isNegative(n: number): boolean { return n < 0; }

  navigate(path: string) { this.router.navigate([path]); }

  async runMigration() {
    this.migrating.set(true);
    try {
      const res = await this.migration.migrateOldExpenses();
      this.migrationResult.set(`✅ Migrated ${res.migrated} expense(s).`);
    } catch (err) {
      this.migrationResult.set('❌ ' + (err as Error).message);
    } finally {
      this.migrating.set(false);
    }
  }
  setRange(r: String) {
    this.activeRange.set(r as '7D' | '30D' | '90D' | 'YTD');
  }
}