import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { TransactionForm } from './transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';
import { ReconcileReview } from '../../components/reconcile-review/reconcile-review';
import { Transaction } from '../../models';
import { QuickAddService } from '../../services/quick-add.service';
import { ToastService } from '../../services/toast.service';
import { ReconciliationService } from '../../services/reconciliation.service';

type FilterType = 'all' | 'income' | 'expense' | 'transfer';
type DateRange = 'last-30' | 'this-month' | 'last-month' | 'this-year' | 'custom' | 'all';
type SpecialFilter = 'all' | 'uncategorized' | 'refunded' | 'not-refunded';
type QuickEditDraft = {
  amount: number;
  date: string;
  accountId: string;
  categoryId: string;
  fromAccountId: string;
  toAccountId: string;
};

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, TransactionForm, Confirm, ReconcileReview],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions {
  private toastService = inject(ToastService);
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);
  private categoryService = inject(CategoryService);
  private route = inject(ActivatedRoute);
  private openedQueryTxId = '';
  private queryTxId = signal('');
  quickAdd = inject(QuickAddService);
  reconcile = inject(ReconciliationService);
  reconcileOpen = signal(false);

  // Modal state
  formOpen = signal(false);
  editing = signal<Transaction | null>(null);
  viewing = signal<Transaction | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<Transaction | null>(null);
  quickEditingId = signal<string | null>(null);
  quickEditDraft = signal<QuickEditDraft | null>(null);
  quickSaving = signal(false);
  bulkMode = signal(false);
  selectedIds = signal<Set<string>>(new Set());
  bulkCategoryId = signal('');
  bulkAccountId = signal('');
  bulkSaving = signal(false);
  bulkConfirmOpen = signal(false);

  // Filter state — default is last 30 days
  filterType = signal<FilterType>('all');
  filterDateRange = signal<DateRange>('last-30');
  filterAccountId = signal('');
  filterCategoryId = signal('');
  search = signal('');
  merchantFilter = signal('');
  minAmount = signal('');
  maxAmount = signal('');
  customStartDate = signal('');
  customEndDate = signal('');
  specialFilter = signal<SpecialFilter>('all');
  advancedFiltersOpen = signal(false);

  // Date range bounds
  private dateRange = computed(() => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();

    const localDate = (year: number, month: number, day: number) => {
      const mm = String(month + 1).padStart(2, '0');
      const dd = String(day).padStart(2, '0');
      return `${year}-${mm}-${dd}`;
    };

    const lastDay = (year: number, month: number) =>
      new Date(year, month + 1, 0).getDate();

    const todayStr = localDate(y, m, now.getDate());

    switch (this.filterDateRange()) {
      case 'last-30': {
        const d30 = new Date(now);
        d30.setDate(d30.getDate() - 29);
        const s = localDate(d30.getFullYear(), d30.getMonth(), d30.getDate());
        return { start: s, end: todayStr };
      }
      case 'this-month':
        return { start: localDate(y, m, 1), end: localDate(y, m, lastDay(y, m)) };
      case 'last-month': {
        // Use Date constructor to handle January rollback correctly
        const prev = new Date(y, m - 1, 1);
        const py = prev.getFullYear(), pm = prev.getMonth();
        return { start: localDate(py, pm, 1), end: localDate(py, pm, lastDay(py, pm)) };
      }
      case 'this-year':
        return { start: `${y}-01-01`, end: `${y}-12-31` };
      case 'custom':
        return { start: this.customStartDate(), end: this.customEndDate() };
      default:
        return { start: '', end: '' };
    }
  });

  // Filtered transactions
  filtered = computed(() => {
    const { start, end } = this.dateRange();
    const q = this.search().toLowerCase();
    const merchantQuery = this.merchantFilter().trim().toLowerCase();
    const min = Number(this.minAmount());
    const max = Number(this.maxAmount());
    return this.txService.transactions().filter(t => {
      if (this.filterType() !== 'all' && t.type !== this.filterType()) return false;
      if (start && t.date < start) return false;
      if (end && t.date > end) return false;
      if (this.minAmount() && t.amount < min) return false;
      if (this.maxAmount() && t.amount > max) return false;
      if (this.filterAccountId()) {
        if (t.type === 'transfer') {
          if (t.fromAccountId !== this.filterAccountId() &&
              t.toAccountId !== this.filterAccountId()) return false;
        } else {
          if (t.accountId !== this.filterAccountId()) return false;
        }
      }
      if (this.filterCategoryId() && t.categoryId !== this.filterCategoryId()) return false;
      if (this.specialFilter() === 'uncategorized' && (t.type === 'transfer' || !!t.categoryId)) return false;
      if (this.specialFilter() === 'refunded' && !t.refunded) return false;
      if (this.specialFilter() === 'not-refunded' && t.refunded) return false;
      if (merchantQuery && !(t.merchant || '').toLowerCase().includes(merchantQuery)) return false;
      if (q) {
        const merchant = (t.merchant || '').toLowerCase();
        const notes = (t.notes || '').toLowerCase();
        if (!merchant.includes(q) && !notes.includes(q)) return false;
      }
      return true;
    });
  });

  // Group by date
  grouped = computed(() => {
    const groups = new Map<string, Transaction[]>();
    for (const t of this.filtered()) {
      if (!groups.has(t.date)) groups.set(t.date, []);
      groups.get(t.date)!.push(t);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([date, items]) => ({
        date,
        label: this.formatDateLabel(date),
        items,
        total: items.reduce((s, t) => {
          if (t.type === 'income') return s + t.amount;
          if (t.type === 'expense') return s - t.amount;
          return s;
        }, 0)
      }));
  });

  // Totals
  totals = computed(() => {
    let income = 0, expense = 0;
    for (const t of this.filtered()) {
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expense += t.amount;
    }
    return { income, expense, net: income - expense };
  });

  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  allCategories = computed(() =>
    this.categoryService.categories().filter(c => !c.archived)
  );

  selectedTransactions = computed(() => {
    const ids = this.selectedIds();
    return this.txService.transactions().filter(t => !!t.id && ids.has(t.id));
  });

  selectedCount = computed(() => this.selectedIds().size);

  allFilteredSelected = computed(() => {
    const ids = this.filtered().map(t => t.id).filter((id): id is string => !!id);
    return ids.length > 0 && ids.every(id => this.selectedIds().has(id));
  });

  selectedEditableTransactions = computed(() =>
    this.selectedTransactions().filter(t => t.type !== 'transfer')
  );

  bulkCategoryKind = computed((): 'income' | 'expense' | null => {
    const txs = this.selectedEditableTransactions();
    if (txs.length === 0) return null;
    const kind = txs[0].type === 'income' ? 'income' : 'expense';
    return txs.every(t => (t.type === 'income' ? 'income' : 'expense') === kind) ? kind : null;
  });

  bulkCategories = computed(() => {
    const kind = this.bulkCategoryKind();
    if (!kind) return [];
    return this.categoryService.categories().filter(c => c.kind === kind && !c.archived);
  });

  // Helpers
  accountName(id?: string): string {
    if (!id) return '—';
    const a = this.accountService.accounts().find(a => a.id === id);
    if (!a) return '—';
    return a.icon ? `${a.icon} ${a.name}` : a.name;
  }

  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id);
  }

  optionLabel(icon: string | undefined, name: string): string {
    return icon ? `${icon}\u00A0\u00A0${name}` : name;
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  formatDateLabel(date: string): string {
    const d = new Date(date + 'T00:00:00');
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    const weekday = d.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const monthDay = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (d.getTime() === today.getTime()) return `TODAY · ${weekday}, ${monthDay.toUpperCase()}`;
    if (d.getTime() === yesterday.getTime()) return `YESTERDAY · ${weekday}, ${monthDay.toUpperCase()}`;
    return `${weekday}, ${monthDay.toUpperCase()}`;
  }

  formatFullDate(date: string): string {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
  }

  hasActiveFilters = computed(() =>
    this.filterType() !== 'all' ||
    this.filterDateRange() !== 'last-30' ||
    !!this.filterAccountId() ||
    !!this.filterCategoryId() ||
    !!this.search() ||
    !!this.merchantFilter() ||
    !!this.minAmount() ||
    !!this.maxAmount() ||
    !!this.customStartDate() ||
    !!this.customEndDate() ||
    this.specialFilter() !== 'all'
  );

  resetFilters() {
    this.filterType.set('all');
    this.filterDateRange.set('last-30');
    this.filterAccountId.set('');
    this.filterCategoryId.set('');
    this.search.set('');
    this.merchantFilter.set('');
    this.minAmount.set('');
    this.maxAmount.set('');
    this.customStartDate.set('');
    this.customEndDate.set('');
    this.specialFilter.set('all');
  }

  isSelected(tx: Transaction): boolean {
    return !!tx.id && this.selectedIds().has(tx.id);
  }

  enterBulkMode() {
    this.bulkMode.set(true);
    this.quickEditingId.set(null);
    this.quickEditDraft.set(null);
  }

  exitBulkMode() {
    if (this.bulkSaving()) return;
    this.bulkMode.set(false);
    this.clearSelection();
  }

  toggleBulkMode() {
    if (this.bulkMode()) this.exitBulkMode();
    else this.enterBulkMode();
  }

  toggleSelectedTx(tx: Transaction) {
    if (!tx.id) return;
    const next = new Set(this.selectedIds());
    if (next.has(tx.id)) next.delete(tx.id);
    else next.add(tx.id);
    this.selectedIds.set(next);
  }

  toggleSelected(event: Event, tx: Transaction) {
    event.stopPropagation();
    this.toggleSelectedTx(tx);
  }

  selectAllFiltered() {
    const ids = this.filtered().map(t => t.id).filter((id): id is string => !!id);
    this.selectedIds.set(new Set(ids));
  }

  clearSelection() {
    this.selectedIds.set(new Set());
    this.bulkCategoryId.set('');
    this.bulkAccountId.set('');
  }

  toggleAllFiltered(event: Event) {
    event.stopPropagation();
    if (this.allFilteredSelected()) this.clearSelection();
    else this.selectAllFiltered();
  }

  private selectedIdsForEditableTransactions(): string[] {
    return this.selectedEditableTransactions().map(t => t.id).filter((id): id is string => !!id);
  }

  async applyBulkCategory() {
    if (this.bulkSaving()) return;
    const categoryId = this.bulkCategoryId();
    const ids = this.selectedIdsForEditableTransactions();
    if (!categoryId) {
      this.toastService.error('Choose a category first.');
      return;
    }
    if (!this.bulkCategoryKind()) {
      this.toastService.error('Select only income or only expense transactions to bulk categorize.');
      return;
    }
    if (ids.length === 0) {
      this.toastService.error('No selected transactions can be categorized.');
      return;
    }

    this.bulkSaving.set(true);
    try {
      await this.txService.updateMany(ids, { categoryId });
      this.toastService.success(`Updated ${ids.length} transactions.`);
      this.clearSelection();
    } catch (err) {
      this.toastService.error('Could not update selected transactions.');
    } finally {
      this.bulkSaving.set(false);
    }
  }

  async applyBulkAccount() {
    if (this.bulkSaving()) return;
    const accountId = this.bulkAccountId();
    const ids = this.selectedIdsForEditableTransactions();
    if (!accountId) {
      this.toastService.error('Choose an account first.');
      return;
    }
    if (ids.length === 0) {
      this.toastService.error('Transfers cannot be moved with bulk account change.');
      return;
    }

    this.bulkSaving.set(true);
    try {
      await this.txService.updateMany(ids, { accountId });
      this.toastService.success(`Moved ${ids.length} transactions.`);
      this.clearSelection();
    } catch (err) {
      this.toastService.error('Could not move selected transactions.');
    } finally {
      this.bulkSaving.set(false);
    }
  }

  async applyBulkRefunded(refunded: boolean) {
    if (this.bulkSaving()) return;
    const ids = this.selectedIdsForEditableTransactions();
    if (ids.length === 0) {
      this.toastService.error('No selected transactions can be marked refunded.');
      return;
    }

    this.bulkSaving.set(true);
    try {
      await this.txService.updateMany(ids, { refunded });
      this.toastService.success(`Updated ${ids.length} transactions.`);
      this.clearSelection();
    } catch (err) {
      this.toastService.error('Could not update selected transactions.');
    } finally {
      this.bulkSaving.set(false);
    }
  }

  askBulkDelete() {
    if (this.selectedCount() === 0) return;
    this.bulkConfirmOpen.set(true);
  }

  async confirmBulkDelete() {
    if (this.bulkSaving()) return;
    const ids = [...this.selectedIds()];
    if (ids.length === 0) return;

    this.bulkSaving.set(true);
    try {
      await this.txService.removeMany(ids);
      this.toastService.success(`Deleted ${ids.length} transactions.`);
      this.clearSelection();
    } catch (err) {
      this.toastService.error('Could not delete selected transactions.');
    } finally {
      this.bulkSaving.set(false);
      this.bulkConfirmOpen.set(false);
    }
  }

  categoriesFor(type: Transaction['type']) {
    const kind = type === 'income' ? 'income' : 'expense';
    return this.categoryService.categories().filter(c => c.kind === kind && !c.archived);
  }

  // ── View panel ────────────────────────────────────────────
  openView(tx: Transaction) {
    if (this.quickEditingId()) return;
    if (this.bulkMode()) {
      this.toggleSelectedTx(tx);
      return;
    }
    this.viewing.set(tx);
    document.body.style.overflow = 'hidden';
  }

  closeView() {
    this.viewing.set(null);
    document.body.style.overflow = '';
  }

  editFromView() {
    const tx = this.viewing();
    this.viewing.set(null);
    document.body.style.overflow = '';
    if (tx) {
      this.editing.set(tx);
      this.formOpen.set(true);
    }
  }

  // ── CRUD ──────────────────────────────────────────────────
  openNew() {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  openEdit(tx: Transaction) {
    this.editing.set(tx);
    this.formOpen.set(true);
  }

  startQuickEdit(event: Event, tx: Transaction) {
    event.stopPropagation();
    if (this.bulkMode()) return;
    this.quickEditingId.set(tx.id || null);
    this.quickEditDraft.set({
      amount: tx.amount,
      date: tx.date,
      accountId: tx.accountId || '',
      categoryId: tx.categoryId || '',
      fromAccountId: tx.fromAccountId || '',
      toAccountId: tx.toAccountId || '',
    });
  }

  cancelQuickEdit(event?: Event) {
    event?.stopPropagation();
    this.quickEditingId.set(null);
    this.quickEditDraft.set(null);
  }

  updateQuickDraft(patch: Partial<QuickEditDraft>) {
    const draft = this.quickEditDraft();
    if (!draft) return;
    this.quickEditDraft.set({ ...draft, ...patch });
  }

  async saveQuickEdit(event: Event, tx: Transaction) {
    event.stopPropagation();
    const draft = this.quickEditDraft();
    if (!tx.id || !draft || this.quickSaving()) return;
    if (!draft.amount || draft.amount <= 0) {
      this.toastService.error('Amount must be greater than zero');
      return;
    }
    if (!draft.date) {
      this.toastService.error('Date is required');
      return;
    }

    const patch: Partial<Transaction> = {
      amount: Number(draft.amount),
      date: draft.date,
    };

    if (tx.type === 'transfer') {
      if (!draft.fromAccountId || !draft.toAccountId) {
        this.toastService.error('Please select both accounts');
        return;
      }
      if (draft.fromAccountId === draft.toAccountId) {
        this.toastService.error('From and To must be different accounts');
        return;
      }
      patch.fromAccountId = draft.fromAccountId;
      patch.toAccountId = draft.toAccountId;
    } else {
      if (!draft.accountId) {
        this.toastService.error('Please select an account');
        return;
      }
      patch.accountId = draft.accountId;
      patch.categoryId = draft.categoryId || undefined;
    }

    this.quickSaving.set(true);
    try {
      await this.txService.update(tx.id, patch);
      this.toastService.success('Transaction updated.');
      this.cancelQuickEdit();
    } catch (err) {
      this.toastService.error('Could not update transaction.');
    } finally {
      this.quickSaving.set(false);
    }
  }

  closeForm() {
    this.formOpen.set(false);
    this.editing.set(null);
    this.quickAdd.close();
  }

  constructor() {
    this.route.queryParamMap.subscribe(params => {
      const accountId = params.get('accountId');
      const categoryId = params.get('categoryId');
      const search = params.get('search');
      const txId = params.get('txId') || '';
      if (accountId) {
        this.filterAccountId.set(accountId);
        this.filterDateRange.set('all');
      }
      if (categoryId) {
        this.filterCategoryId.set(categoryId);
        this.filterDateRange.set('all');
      }
      if (search) {
        this.search.set(search);
        this.filterDateRange.set('all');
      }
      this.queryTxId.set(txId);
    });

    effect(() => {
      if (this.quickAdd.open()) {
        setTimeout(() => {
          this.editing.set(null);
          this.formOpen.set(true);
        }, 0);
      }
    });

    effect(() => {
      const txId = this.queryTxId();
      if (!txId || this.openedQueryTxId === txId) return;
      const tx = this.txService.transactions().find(t => t.id === txId);
      if (!tx) return;
      this.openedQueryTxId = txId;
      setTimeout(() => this.openView(tx), 0);
    });
  }

  async handleSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const e = this.editing();
    try {
      if (e?.id) {
        await this.txService.update(e.id, data);
      } else {
        await this.txService.add(data);
      }
      this.closeForm();
    } catch (err) {
      this.toastService.error('Import failed. Please try again.');
    }
  }

  askDelete() {
    this.toDelete.set(this.editing());
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  async confirmDelete() {
    const tx = this.toDelete();
    if (!tx?.id) return;
    try {
      await this.txService.remove(tx.id);
    } finally {
      this.confirmOpen.set(false);
      this.toDelete.set(null);
      this.editing.set(null);
    }
  }

  cancelDelete() {
    this.confirmOpen.set(false);
    this.toDelete.set(null);
  }

  setFilterType(val: string) {
    this.filterType.set(val as FilterType);
  }
}
