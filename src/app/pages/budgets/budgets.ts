import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { BudgetService } from '../../services/budget.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { BudgetForm } from './budget-form/budget-form';
import { Confirm } from '../../components/confirm/confirm';
import { ErrorBanner } from '../../components/error-banner/error-banner';
import { MonthPicker } from '../../components/month-picker/month-picker';
import { Budget } from '../../models';
import { ToastService } from '../../services/toast.service';
import { MoneyRules } from '../../utils/reporting';
import { addMonths, monthKeyOf, monthLabel } from '../../utils/calendar';
import {
  BudgetDraft, BudgetScope, BudgetStatus, budgetProgress, budgetSpent, budgetsElsewhere,
  describeBudgetDeletion, effectiveBudgets, planBudgetSave, wouldClash,
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
  imports: [CommonModule, FormsModule, BudgetForm, Confirm, ErrorBanner, MonthPicker],
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
  private route = inject(ActivatedRoute);

  formOpen = signal(false);
  formCategoryId = signal('');
  formScope = signal<BudgetScope>('default');
  confirmOpen = signal(false);
  toDelete = signal<Budget | null>(null);
  deleteMessage = signal('');

  // Local time throughout: toISOString() is UTC, which put the evening of the
  // last day of a month (west of UTC) or the first morning (east) in the wrong month.
  private currentMonth = monthKeyOf();

  /**
   * The month and the refund toggle live in the URL (`?month=2026-07`), so
   * coming back from a budget's detail page — with the browser's Back or the
   * page's own "← Budgets" — lands on the month you were looking at instead of
   * snapping to this month.
   */
  selectedMonth = signal(this.currentMonth);

  // Exclude refunded transactions, and net reimbursements, in budget totals
  excludeRefunded = signal(true);

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const m = params.get('month');
      this.selectedMonth.set(m && /^\d{4}-\d{2}$/.test(m) ? m : this.currentMonth);
      this.excludeRefunded.set(params.get('excludeRefunded') !== 'false');
    });
  }

  /** Month changes replace the history entry, so Back leaves Budgets rather than stepping through months. */
  setMonth(month: string) {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { month: month === this.currentMonth ? null : month },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  toggleRefunded() {
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { excludeRefunded: this.excludeRefunded() ? 'false' : null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }

  isPastMonth = computed(() => this.selectedMonth() < this.currentMonth);
  isFutureMonth = computed(() => this.selectedMonth() > this.currentMonth);

  // "Resets November 1" — first day of the month after selectedMonth
  resetDate = computed(() => {
    const [y, m] = this.selectedMonth().split('-').map(Number);
    return new Date(y, m, 1).toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
  });

  /** Back as far as your first transaction; a year ahead for planning one-offs. */
  pickerMin = computed(() => {
    let first = this.currentMonth;
    for (const t of this.txService.transactions()) if (t.date.slice(0, 7) < first) first = t.date.slice(0, 7);
    for (const b of this.budgetService.budgets()) if (b.month && b.month < first) first = b.month;
    return first;
  });
  pickerMax = addMonths(this.currentMonth, 12);

  /** Months with a one-off limit get a dot in the month grid. */
  oneOffMonths = computed(() =>
    [...new Set(this.budgetService.budgets().filter(b => !b.isDefault && b.month).map(b => b.month!))]);

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

  private rules = computed<MoneyRules>(() => this.txService.moneyRules(this.excludeRefunded()));

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
    const budget = rows.reduce((s, r) => s + r.budget.amount, 0);
    const spent = Math.round(rows.reduce((s, r) => s + r.spent, 0) * 100) / 100;
    return {
      budget, spent,
      left: Math.round((budget - spent) * 100) / 100,
      pct: budget > 0 ? Math.round((spent / budget) * 100) : 0,
      over: rows.filter(r => r.status === 'over').length,
      warn: rows.filter(r => r.status === 'warn').length,
    };
  });

  monthName = computed(() => monthLabel(this.selectedMonth(), false));

  heroLabel = computed(() =>
    this.isFutureMonth() ? `Budgeted for ${this.monthName()}` : `Spent in ${this.monthName()}`);

  /** One plain sentence on how the month is going — Origin's "why it matters" line. */
  heroSentence = computed(() => {
    const t = this.totals();
    const n = this.budgetRows().length;
    const m = this.monthName();
    const budgets = `${n} budget${n === 1 ? '' : 's'}`;
    if (this.isFutureMonth()) {
      return `${m} hasn't started. These are the limits that will apply.`;
    }
    if (this.isPastMonth()) {
      if (t.left >= 0) return `${m} came in ${this.formatCurrency(t.left)} under across ${budgets}.`;
      return `${m} went ${this.formatCurrency(-t.left)} over across ${budgets}.`;
    }
    if (t.over > 0) {
      const cats = `${t.over} categor${t.over === 1 ? 'y is' : 'ies are'}`;
      return `${cats} already over. ${this.daysLeft()} left in ${m}.`;
    }
    if (t.spent === 0) return `Nothing spent against your budgets yet. ${this.formatCurrency(t.budget)} to work with.`;
    return `${this.formatCurrency(t.left)} left across ${budgets}, with ${this.daysLeft()} to go.`;
  });

  private daysLeft(): string {
    const now = new Date();
    const last = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const d = last - now.getDate() + 1;
    return `${d} day${d === 1 ? '' : 's'}`;
  }

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

  // Navigate to budget detail page
  openDetail(categoryId: string) {
    this.router.navigate(
      ['/budgets', categoryId, this.selectedMonth()],
      {
        queryParams: { excludeRefunded: this.excludeRefunded() },
        // Lets the detail page's "← Budgets" step back in history (to this
        // month) instead of pushing a fresh Budgets entry.
        state: { fromBudgets: true },
      }
    );
  }

  goToMonth(month: string) {
    this.setMonth(month);
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
