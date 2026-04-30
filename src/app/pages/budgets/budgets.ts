import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
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

interface MonthSummary {
  month: string;
  label: string;
  totalBudget: number;
  totalSpent: number;
  pct: number;
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, BudgetForm, Confirm],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss'
})
export class Budgets {
  Math = Math

  budgetService = inject(BudgetService);
  categoryService = inject(CategoryService);
  txService = inject(TransactionService);

  formOpen = signal(false);
  editing = signal<Budget | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<Budget | null>(null);
  preselectedCategoryId = signal('');
  preselectedMonth = signal('');

  // Selected month for the main view
  selectedMonth = signal(new Date().toISOString().slice(0, 7));

  // Available months (last 6 + next 3)
  availableMonths = computed(() => {
    const months: { value: string; label: string }[] = [];
    const seen = new Set<string>();

    for (let i = -5; i <= 3; i++) {
      const d = new Date();
      d.setDate(1); // normalize to 1st to avoid month overflow
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

  // Budget rows for selected month
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
          t.date.startsWith(month)
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

    return rows.sort((a, b) => b.pct - a.pct);
  });

  // Totals for selected month
  totals = computed(() => {
    const rows = this.budgetRows();
    return {
      budget: rows.reduce((s, r) => s + r.budget.amount, 0),
      spent: rows.reduce((s, r) => s + r.spent, 0),
      over: rows.filter(r => r.status === 'over').length,
      warn: rows.filter(r => r.status === 'warn').length,
    };
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
    return month === new Date().toISOString().slice(0, 7);
  }

  // CRUD
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
    this.editing.set(null);
    this.preselectedCategoryId.set(categoryId);
    this.preselectedMonth.set(this.selectedMonth());
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