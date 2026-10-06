import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, signal, inject, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { CategoryService } from '../../../services/category.service';
import { BudgetService } from '../../../services/budget.service';
import { Budget } from '../../../models';
import { ToastService } from '../../../services/toast.service';
import {
  BudgetDraft, BudgetScope, defaultFor, findBudget, monthOptions, overrideFor, prefillAmount,
} from '../../../utils/budgets';
import { monthKeyOf, monthLabel } from '../../../utils/calendar';

/**
 * Add or edit a budget.
 *
 * The form says *what* to save — category, "every month" or "one month", and
 * the amount — and the page works out which document that is. It no longer
 * edits whichever budget happened to be on screen: that is how overriding one
 * month used to wipe the every-month budget.
 */
@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './budget-form.html',
  styleUrl: './budget-form.scss'
})
export class BudgetForm implements OnChanges {
  private toastService = inject(ToastService);
  categories = inject(CategoryService);
  budgetService = inject(BudgetService);

  @Input() open = false;
  /** Preselected category. Empty for "+ New budget". */
  @Input() categoryId = '';
  /** The month the Budgets page is showing. */
  @Input() viewMonth = monthKeyOf();
  @Input() initialScope: BudgetScope = 'default';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<BudgetDraft>();
  @Output() deleteRequested = new EventEmitter<Budget>();

  // Signals, so the notes and title follow every change.
  category = signal('');
  scope = signal<BudgetScope>('default');
  month = signal(monthKeyOf());
  amount = 0;
  /** Once you type an amount, switching scope stops replacing it. */
  private amountTouched = false;
  /** Category is fixed when opened from a budget card. */
  lockCategory = false;

  expenseCategories = computed(() => {
    const all = this.categories.categories();
    const list = all.filter(c => c.kind === 'expense' && !c.archived);
    // An archived category's budget is still editable, so keep it selectable.
    const current = all.find(c => c.id === this.category());
    return current && !list.includes(current) ? [current, ...list] : list;
  });

  months = computed(() => monthOptions(monthKeyOf(), 6, 12, [this.viewMonth, this.month()]));

  /** The existing budget this form will change, if any. */
  target = computed(() =>
    findBudget(this.budgetService.budgets(), this.category(), this.scope(), this.month()) ?? null);

  /** Saving "every month" will turn this month's one-off into the every-month budget. */
  promotes = computed(() => {
    const budgets = this.budgetService.budgets();
    return this.scope() === 'default' && !defaultFor(budgets, this.category())
      && !!overrideFor(budgets, this.category(), this.month());
  });

  /** Whether saving changes a budget that already exists. */
  editingExisting = computed(() => !!this.target() || this.promotes());

  categoryName = computed(() =>
    this.categories.categories().find(c => c.id === this.category())?.name ?? 'This category');

  monthName = computed(() => monthLabel(this.month()));

  /** One calm sentence on what saving does to the other months. */
  note = computed(() => {
    const budgets = this.budgetService.budgets();
    const cat = this.category();
    if (!cat) return '';
    const name = this.categoryName();
    const def = defaultFor(budgets, cat);
    if (this.scope() === 'month') {
      return def
        ? `Only ${this.monthName()} changes. Every other month stays at ${this.money(def.amount)}.`
        : `Only ${this.monthName()} gets a limit. ${name} has no every-month budget.`;
    }
    const oneOff = overrideFor(budgets, cat, this.month());
    if (!def && oneOff) {
      return `${this.monthName()}'s one-off limit becomes the limit for every month.`;
    }
    if (def && oneOff) {
      return `${this.monthName()} keeps its own limit of ${this.money(oneOff.amount)}. Remove it there to use this amount in ${this.monthName()} too.`;
    }
    return def && !this.lockCategory
      ? `${name} already has an every-month budget of ${this.money(def.amount)}. Saving replaces it.`
      : '';
  });

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) this.load();
  }

  private load() {
    this.lockCategory = !!this.categoryId;
    this.category.set(this.categoryId);
    this.scope.set(this.initialScope);
    this.month.set(this.viewMonth || monthKeyOf());
    this.amountTouched = false;
    this.refill();
  }

  private refill() {
    if (this.amountTouched) return;
    this.amount = prefillAmount(this.budgetService.budgets(), this.category(), this.scope(), this.month());
  }

  setCategory(id: string) { this.category.set(id); this.refill(); }
  setScope(s: BudgetScope) { this.scope.set(s); this.refill(); }
  setMonth(m: string) { this.month.set(m); this.refill(); }
  setAmount(v: number) { this.amount = v; this.amountTouched = true; }

  save() {
    if (!this.category()) { this.toastService.error('Please select a category'); return; }
    const amount = Number(this.amount);
    if (!amount || amount <= 0) { this.toastService.error('Amount must be greater than zero'); return; }
    this.saved.emit({ categoryId: this.category(), amount, scope: this.scope(), month: this.month() });
  }

  requestDelete() {
    const t = this.target();
    if (t) this.deleteRequested.emit(t);
  }

  private money(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }
}
