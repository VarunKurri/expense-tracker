import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { BudgetForm } from './budget-form/budget-form';
import { Confirm } from '../../components/confirm/confirm';
import { Budget } from '../../models';

interface BudgetRow {
  budget: Budget;
  categoryName: string;
  categoryIcon: string;
  spent: number;
  remaining: number;
  pct: number;
  status: 'ok' | 'warn' | 'over';
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, BudgetForm, Confirm],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss'
})
export class Budgets {
  Math = Math;

  budgetService = inject(BudgetService);
  categoryService = inject(CategoryService);
  txService = inject(TransactionService);
  private router = inject(Router);

  formOpen = signal(false);
  editing = signal<Budget | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<Budget | null>(null);
  preselectedCategoryId = signal('');
  preselectedMonth = signal('');

  selectedMonth = signal(new Date().toISOString().slice(0, 7));

  // Exclude refunded transactions from budget calculations
  excludeRefunded = signal(true);

  // Current month string e.g. "2026-05"
  private currentMonth = new Date().toISOString().slice(0, 7);

  // Is the selected month in the past?
  isPastMonth = computed(() => this.selectedMonth() < this.currentMonth);

  // Is the selected month in the future?
  isFutureMonth = computed(() => this.selectedMonth() > this.currentMonth);

  // "Resets May 1" — first day of the month after selectedMonth
  resetDate = computed(() => {
    const [y, m] = this.selectedMonth().split('-').map(Number);
    const next = new Date(y, m, 1); // JS month is 0-based, so m (not m-1) = next month
    return next.toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  });

  availableMonths = computed(() => {
    const months: { value: string; label: string }[] = [];
    const seen = new Set<string>();
    for (let i = -5; i <= 3; i++) {
      const d = new Date();
      d.setDate(1);
      d.setMonth(d.getMonth() + i);
      const value = d.toISOString().slice(0, 7);
      if (seen.has(value)) continue;
      seen.add(value);
      months.push({
        value,
        label: d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' })
      });
    }
    return months;
  });

  budgetRows = computed((): BudgetRow[] => {
    const month = this.selectedMonth();
    const defaults = this.budgetService.defaultBudgets();
    const rows: BudgetRow[] = [];

    for (const budget of defaults) {
      const effective = this.budgetService.getBudgetForCategory(
        budget.categoryId, month
      );
      if (!effective) continue;

      const cat = this.categoryService.categories()
        .find(c => c.id === budget.categoryId);
      if (!cat) continue;

      const spent = this.txService.transactions()
        .filter(t =>
          t.type === 'expense' &&
          t.categoryId === budget.categoryId &&
          t.date.startsWith(month) &&
          !(this.excludeRefunded() && t.refunded)
        )
        .reduce((s, t) => s + t.amount, 0);

      const pct = effective.amount > 0
        ? Math.round((spent / effective.amount) * 100)
        : 0;

      rows.push({
        budget: effective,
        categoryName: cat.name,
        categoryIcon: cat.icon || '📦',
        spent: Math.round(spent * 100) / 100,
        remaining: Math.round((effective.amount - spent) * 100) / 100,
        pct,
        status: pct >= 100 ? 'over' : pct >= 75 ? 'warn' : 'ok'
      });
    }

    // Sort: over first, then warn, then by pct desc, then by amount desc for ties at 0%
    return rows.sort((a, b) => {
      const statusOrder = { over: 0, warn: 1, ok: 2 };
      if (statusOrder[a.status] !== statusOrder[b.status]) {
        return statusOrder[a.status] - statusOrder[b.status];
      }
      if (b.pct !== a.pct) return b.pct - a.pct;
      return b.budget.amount - a.budget.amount;
    });
  });

  totals = computed(() => {
    const rows = this.budgetRows();
    return {
      budget: rows.reduce((s, r) => s + r.budget.amount, 0),
      spent: rows.reduce((s, r) => s + r.spent, 0),
      over: rows.filter(r => r.status === 'over').length,
      warn: rows.filter(r => r.status === 'warn').length,
    };
  });

  // Dynamic subtitle: "May 2026 · $20 of $3,900"
  subtitle = computed(() => {
    const month = this.selectedMonth();
    const [y, m] = month.split('-').map(Number);
    const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', {
      month: 'long', year: 'numeric'
    });
    const t = this.totals();
    if (t.budget === 0) return label;
    return `${label} · ${this.formatCurrency(t.spent)} of ${this.formatCurrency(t.budget)}`;
  });

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      minimumFractionDigits: 0, maximumFractionDigits: 0
    }).format(Math.abs(n));
  }

  formatCurrencyFull(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  isCurrentMonth(month: string): boolean {
    return month === this.currentMonth;
  }

  // Navigate to budget detail page
  openDetail(categoryId: string) {
    this.router.navigate(
      ['/budgets', categoryId, this.selectedMonth()],
      { queryParams: { excludeRefunded: this.excludeRefunded() } }
    );
  }

  openNew() {
    this.editing.set(null);
    this.preselectedCategoryId.set('');
    this.preselectedMonth.set('');
    this.formOpen.set(true);
  }

  openEdit(budget: Budget) {
    this.editing.set(budget);
    this.preselectedCategoryId.set('');
    this.preselectedMonth.set('');
    this.formOpen.set(true);
  }

  openOverride(categoryId: string) {
    // Look up the effective budget for this category/month and edit it
    const existing = this.budgetService.getBudgetForCategory(
      categoryId, this.selectedMonth()
    );
    if (existing) {
      // Edit the existing budget (sets it as a month override if it isn't already)
      this.editing.set(existing);
      this.preselectedCategoryId.set(categoryId);
      this.preselectedMonth.set(this.selectedMonth());
    } else {
      // No budget yet — open new form pre-filled for this category + month
      this.editing.set(null);
      this.preselectedCategoryId.set(categoryId);
      this.preselectedMonth.set(this.selectedMonth());
    }
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  async handleSave(data: Omit<Budget, 'id' | 'createdAt'>) {
    const e = this.editing();
    try {
      if (e?.id) {
        await this.budgetService.update(e.id, data);
      } else {
        await this.budgetService.add(data);
      }
      this.closeForm();
    } catch (err) {
      alert('Failed: ' + (err as Error).message);
    }
  }

  askDelete() {
    this.toDelete.set(this.editing());
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  async confirmDelete() {
    const b = this.toDelete();
    if (!b?.id) return;
    try {
      await this.budgetService.remove(b.id);
    } finally {
      this.confirmOpen.set(false);
      this.toDelete.set(null);
      this.editing.set(null);
    }
  }
}