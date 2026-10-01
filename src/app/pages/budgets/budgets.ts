import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { BudgetForm } from './budget-form/budget-form';
import { Confirm } from '../../components/confirm/confirm';
import { ErrorBanner } from '../../components/error-banner/error-banner';
import { Budget } from '../../models';
import { ToastService } from '../../services/toast.service';
import { MoneyRules } from '../../utils/reporting';
import { monthKeyOf, monthLabel } from '../../utils/calendar';
import {
  BudgetDraft, BudgetScope, BudgetStatus, budgetProgress, budgetSpent, budgetsElsewhere,
  describeBudgetDeletion, effectiveBudgets, monthOptions, planBudgetSave, wouldClash,
} from '../../utils/budgets';

interface BudgetRow {
  budget: Budget;
  categoryId: string;
  categoryName: string;
  categoryIcon: string;
  /** A one-off limit for this month, replacing (or standing in for) every-month. */
  isOverride: boolean;
  /** The every-month amount the one-off replaces, if there is one. */
  defaultAmount: number | null;
  spent: number;
  remaining: number;
  pct: number;
  status: BudgetStatus;
}

@Component({
  selector: 'app-budgets',
  standalone: true,
  imports: [CommonModule, FormsModule, BudgetForm, Confirm, ErrorBanner],
  templateUrl: './budgets.html',
  styleUrl: './budgets.scss'
})
export class Budgets {
  private toastService = inject(ToastService);
  Math = Math;

  budgetService = inject(BudgetService);
  categoryService = inject(CategoryService);
  txService = inject(TransactionService);
  private router = inject(Router);

  formOpen = signal(false);
  formCategoryId = signal('');
  formScope = signal<BudgetScope>('default');
  confirmOpen = signal(false);
  toDelete = signal<Budget | null>(null);
  deleteMessage = signal('');

  // Local time throughout: toISOString() is UTC, which put the evening of the
  // last day of a month (west of UTC) or the first morning (east) in the wrong month.
  private currentMonth = monthKeyOf();

  selectedMonth = signal(this.currentMonth);

  // Exclude refunded transactions from budget calculations
  excludeRefunded = signal(true);

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

  // Five months back to three ahead, plus the selected month if you jumped
  // further (e.g. from "Also budgeted in…").
  availableMonths = computed(() =>
    monthOptions(this.currentMonth, 5, 3, [this.selectedMonth()]).map(m => ({
      value: m.value,
      label: new Date(m.value + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' }),
    })));

  // Budgets whose category no longer exists (e.g. after a category was merged/deleted).
  // Their amount is intact — they just need re-pointing to a current category.
  orphanedBudgets = computed(() => {
    const ids = new Set(this.categoryService.categories().map(c => c.id));
    return this.budgetService.budgets().filter(b => !ids.has(b.categoryId));
  });

  expenseCategories = computed(() =>
    this.categoryService.categories().filter(c => c.kind === 'expense')
  );

  private reassignTargets = signal<Record<string, string>>({});

  reassignTarget(budgetId: string): string {
    return this.reassignTargets()[budgetId] ?? this.expenseCategories()[0]?.id ?? '';
  }

  setReassignTarget(budgetId: string, categoryId: string) {
    this.reassignTargets.update(m => ({ ...m, [budgetId]: categoryId }));
  }

  async reassignBudget(b: Budget) {
    const target = this.reassignTarget(b.id!);
    if (!b.id || !target) return;
    if (wouldClash(this.budgetService.budgets(), b, target)) {
      const name = this.categoryName(target);
      this.toastService.error(b.isDefault
        ? `${name} already has an every-month budget. Delete this one, or pick another category.`
        : `${name} already has a limit for ${monthLabel(b.month!)}. Delete this one, or pick another category.`);
      return;
    }
    try {
      await this.budgetService.update(b.id, { categoryId: target });
      this.toastService.success('Budget reassigned.');
    } catch {
      this.toastService.error('Could not reassign this budget. Please try again.');
    }
  }

  async removeOrphan(b: Budget) {
    if (!b.id) return;
    try {
      await this.budgetService.remove(b.id);
    } catch {
      this.toastService.error('Could not delete this budget. Please try again.');
    }
  }

  private rules = computed<MoneyRules>(() => ({
    netting: this.excludeRefunded(),
    effectiveExpense: t => this.txService.effectiveExpenseAmount(t),
    reimbursementSurplus: t => this.txService.reimbursementSurplus(t),
  }));

  budgetRows = computed((): BudgetRow[] => {
    const month = this.selectedMonth();
    const rules = this.rules();
    const txs = this.txService.transactions();
    const categories = this.categoryService.categories();
    const rows: BudgetRow[] = [];

    for (const e of effectiveBudgets(this.budgetService.budgets(), month)) {
      const cat = categories.find(c => c.id === e.categoryId);
      if (!cat) continue; // orphaned — listed in the panel above instead
      const spent = budgetSpent(txs, e.categoryId, month, rules);
      rows.push({
        budget: e.budget,
        categoryId: e.categoryId,
        categoryName: cat.name,
        categoryIcon: cat.icon || '📦',
        isOverride: e.isOverride,
        defaultAmount: e.defaultAmount,
        spent,
        ...budgetProgress(spent, e.budget.amount),
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

  /** Categories budgeted only in other months — invisible here, so say where they are. */
  elsewhere = computed(() =>
    budgetsElsewhere(this.budgetService.budgets(), this.selectedMonth())
      .filter(e => this.categoryService.categories().some(c => c.id === e.categoryId))
      .map(e => ({
        ...e,
        name: this.categoryName(e.categoryId),
        labels: e.months.map(m => monthLabel(m)),
      })));

  categoryName(id: string): string {
    return this.categoryService.categories().find(c => c.id === id)?.name ?? 'This category';
  }

  /** "Every month" / "October only" / "October · usually $50". */
  freqLabel(row: BudgetRow): string {
    if (!row.isOverride) return 'Every month';
    const m = monthLabel(this.selectedMonth(), false);
    return row.defaultAmount === null
      ? `${m} only`
      : `${m} · usually ${this.formatCurrency(row.defaultAmount)}`;
  }

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
    const label = monthLabel(this.selectedMonth());
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

  formatShortDate(ts: number): string {
    if (!ts) return 'unknown date';
    return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

  goToMonth(month: string) {
    this.selectedMonth.set(month);
  }

  openNew() {
    this.formCategoryId.set('');
    this.formScope.set('default');
    this.formOpen.set(true);
  }

  /** Edit a card. Opens on whichever limit the card is showing for this month. */
  openEdit(row: BudgetRow) {
    this.formCategoryId.set(row.categoryId);
    this.formScope.set(row.isOverride ? 'month' : 'default');
    this.formOpen.set(true);
  }

  /** Set a one-off limit for the month being viewed. Never touches every-month. */
  openOverride(row: BudgetRow) {
    this.formCategoryId.set(row.categoryId);
    this.formScope.set('month');
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
  }

  async handleSave(draft: BudgetDraft) {
    const plan = planBudgetSave(this.budgetService.budgets(), draft);
    try {
      if (plan.write.kind === 'update') {
        await this.budgetService.update(plan.write.id, plan.write.patch);
      } else {
        await this.budgetService.add(plan.write.data);
      }
      for (const id of plan.deletes) await this.budgetService.remove(id);
      this.closeForm();
      this.toastService.success(draft.scope === 'month'
        ? `${this.categoryName(draft.categoryId)} limit for ${monthLabel(draft.month)} saved.`
        : `${this.categoryName(draft.categoryId)} budget saved.`);
    } catch {
      this.toastService.error('Could not save this budget. Please try again.');
    }
  }

  askDelete(target: Budget) {
    this.toDelete.set(target);
    this.deleteMessage.set(describeBudgetDeletion(
      this.budgetService.budgets(), target, this.categoryName(target.categoryId)));
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  cancelDelete() {
    this.confirmOpen.set(false);
    this.toDelete.set(null);
  }

  async confirmDelete() {
    const b = this.toDelete();
    if (!b?.id) return;
    try {
      await this.budgetService.remove(b.id);
    } catch {
      this.toastService.error('Could not delete this budget. Please try again.');
    } finally {
      this.confirmOpen.set(false);
      this.toDelete.set(null);
    }
  }
}
