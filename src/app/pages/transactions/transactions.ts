import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { TransactionForm } from './transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';
import { Modal } from '../../components/modal/modal';
import { ReconcileReview } from '../../components/reconcile-review/reconcile-review';
import { ErrorBanner } from '../../components/error-banner/error-banner';
import { Transaction } from '../../models';
import { QuickAddService } from '../../services/quick-add.service';
import { ToastService } from '../../services/toast.service';
import { ReconciliationService } from '../../services/reconciliation.service';

type FilterType = 'all' | 'income' | 'expense' | 'transfer';
type DateRange = 'last-30' | 'this-month' | 'last-month' | 'this-year' | 'custom' | 'all';
type SpecialFilter = 'all' | 'uncategorized' | 'refunded' | 'not-refunded' | 'internal-transfer';
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
  imports: [CommonModule, FormsModule, TransactionForm, Confirm, Modal, ReconcileReview, ErrorBanner],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions {
  private toastService = inject(ToastService);
  txService = inject(TransactionService);
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

  // "Analysis view": entered by following "See all transactions" from the Analysis
  // page. Refunded + internal-transfer rows stay visible but are greyed/struck through
  // and left out of the Income/Expenses/Net totals, so the numbers match the Analysis
  // page exactly. Direct navigation to Transactions leaves this off (everything counts).
  analysisView = signal(false);
  analysisExcludeRefunded = signal(true);

  /** True when a row is shown but excluded from analysis-view totals. */
  excludedFromAnalysis(t: Transaction): boolean {
    if (!this.analysisView()) return false;
    if (t.isInternalTransfer) return true;
    if (this.analysisExcludeRefunded() && t.refunded) return true;
    // A reimbursement (income linked to an expense) isn't real income — it's folded
    // into the expense's true cost — so it's greyed out and left out of the totals.
    if (t.type === 'income' && t.reimbursesId) return true;
    return false;
  }

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
      if (this.specialFilter() === 'internal-transfer' && !t.isInternalTransfer) return false;
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
          if (this.excludedFromAnalysis(t)) return s;
          if (t.type === 'income') return s + t.amount;
          if (t.type === 'expense') return s - t.amount;
          return s;
        }, 0)
      }));
  });

  // Totals — in analysis view, refunded + internal-transfer rows are left out so the
  // numbers match the Analysis page; otherwise everything in range counts.
  totals = computed(() => {
    const analysis = this.analysisView();
    let income = 0, expense = 0;
    for (const t of this.filtered()) {
      if (this.excludedFromAnalysis(t)) continue;
      if (t.type === 'income') income += t.amount;
      // In analysis view, an expense counts at its true cost (net of reimbursements);
      // if reimbursements exceed the expense, the excess is real profit — add it to
      // income rather than letting effectiveExpenseAmount's floor silently drop it.
      if (t.type === 'expense') {
        expense += analysis ? this.txService.effectiveExpenseAmount(t) : t.amount;
        if (analysis) income += this.txService.reimbursementSurplus(t);
      }
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

  /** Short date, e.g. "Jul 5" — used in the reimbursement rows/picker. */
  formatDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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
    this.exitAnalysisView();
  }

  /** Leave analysis view — refunded/internal rows count again and un-grey. */
  exitAnalysisView() {
    this.analysisView.set(false);
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

  // ── Reimbursement linking ─────────────────────────────────
  linkingFrom = signal<Transaction | null>(null);
  linkSearch = signal('');

  // Live copy of the viewed transaction (the `viewing()` snapshot is frozen at open;
  // these read through the service so the panel updates right after a link/unlink).
  private viewingId = computed(() => this.viewing()?.id ?? null);
  viewingLive = computed<Transaction | null>(() => {
    const id = this.viewingId();
    return id ? (this.txService.transactions().find(t => t.id === id) ?? null) : null;
  });
  viewingReimbursements = computed(() => {
    const id = this.viewingId();
    return id ? this.txService.reimbursementsFor(id) : [];
  });
  viewingReimbursedTotal = computed(() => this.txService.reimbursedAmountFor(this.viewingId() ?? undefined));
  // How much of viewingReimbursedTotal() is genuine surplus (reimbursed beyond what the
  // expense cost) rather than reducing its cost — distinguishes "still a net expense"
  // from "came out ahead" in the detail panel.
  viewingReimbursementSurplus = computed(() => {
    const tx = this.viewing();
    return tx ? this.txService.reimbursementSurplus(tx) : 0;
  });
  viewingReimbursesExpense = computed<Transaction | null>(() => {
    const live = this.viewingLive();
    if (live?.type !== 'income' || !live.reimbursesId) return null;
    return this.txService.transactions().find(t => t.id === live.reimbursesId) ?? null;
  });
  // The reimbursed expense's own covered/surplus breakdown — shown on the income side
  // of the link so a surplus is visible from either transaction, not just the expense's.
  viewingReimbursesSurplus = computed(() => {
    const exp = this.viewingReimbursesExpense();
    return exp ? this.txService.reimbursementSurplus(exp) : 0;
  });
  viewingReimbursesCovered = computed(() => {
    const exp = this.viewingReimbursesExpense();
    if (!exp) return 0;
    return Math.min(exp.amount, this.txService.reimbursedAmountFor(exp.id));
  });

  // Opposite-type transactions to link (an expense picks an income, and vice versa).
  linkCandidates = computed<Transaction[]>(() => {
    const from = this.linkingFrom();
    if (!from) return [];
    const wantType = from.type === 'income' ? 'expense' : 'income';
    const q = this.linkSearch().trim().toLowerCase();
    return this.txService.transactions().filter(t =>
      t.type === wantType && t.id !== from.id &&
      !(t.type === 'income' && !!t.reimbursesId) &&   // an income can reimburse only one expense
      (!q || (t.merchant || '').toLowerCase().includes(q) || String(t.amount).includes(q))
    ).slice(0, 50);
  });

  openLinkPicker(tx: Transaction) {
    this.linkSearch.set('');
    this.linkingFrom.set(tx);
  }
  closeLinkPicker() {
    this.linkingFrom.set(null);
    this.linkSearch.set('');
  }

  async confirmLink(candidate: Transaction) {
    const from = this.linkingFrom();
    if (!from) return;
    const income = from.type === 'income' ? from : candidate;
    const expense = from.type === 'expense' ? from : candidate;
    if (!income.id || !expense.id) return;
    try {
      await this.txService.update(income.id, { reimbursesId: expense.id });
      this.toastService.success('Reimbursement linked.');
      this.closeLinkPicker();
    } catch {
      this.toastService.error('Could not link. Please try again.');
    }
  }

  async unlinkReimbursement(income: Transaction) {
    if (!income.id) return;
    try {
      await this.txService.update(income.id, { reimbursesId: undefined });
      this.toastService.success('Reimbursement unlinked.');
    } catch {
      this.toastService.error('Could not unlink. Please try again.');
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
      const start = params.get('start');
      const end = params.get('end');
      const special = params.get('special') as SpecialFilter | null;
      const view = params.get('view');

      // Arriving from the Analysis page's "See all transactions" — mirror its KPIs:
      // refunded + internal-transfer rows stay visible but are greyed out and left
      // out of the totals. `excludeRefunded` reflects the Analysis toggle at the time.
      this.analysisView.set(view === 'analysis');
      this.analysisExcludeRefunded.set(params.get('excludeRefunded') !== 'false');

      // A start/end pair (e.g. from Analysis' "see all" links) means the caller
      // picked an exact period — honor it as a custom range instead of falling
      // back to "all," which the other query-param entry points below still do
      // since they don't carry any date intent of their own.
      if (start || end) {
        this.customStartDate.set(start || '');
        this.customEndDate.set(end || '');
        this.filterDateRange.set('custom');
      }
      if (accountId) {
        this.filterAccountId.set(accountId);
        if (!start && !end) this.filterDateRange.set('all');
      }
      if (categoryId) {
        this.filterCategoryId.set(categoryId);
        if (!start && !end) this.filterDateRange.set('all');
      }
      if (special && ['all', 'uncategorized', 'refunded', 'not-refunded', 'internal-transfer'].includes(special)) {
        this.specialFilter.set(special);
      }
      if (search) {
        this.search.set(search);
        if (!start && !end) this.filterDateRange.set('all');
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

    // Clear bulk selection whenever a filter changes. selectedIds otherwise
    // persists silently across filter changes — select rows under one filter,
    // switch filters, select more, and a bulk delete would include the earlier
    // (now off-screen, easy to forget) selections too. Skips the very first run
    // so entering bulk mode / initial load doesn't wipe a selection that was
    // never made.
    let firstFilterRun = true;
    effect(() => {
      this.filterType(); this.filterDateRange(); this.filterAccountId();
      this.filterCategoryId(); this.search(); this.merchantFilter();
      this.minAmount(); this.maxAmount(); this.customStartDate(); this.customEndDate();
      this.specialFilter();
      if (firstFilterRun) { firstFilterRun = false; return; }
      if (this.bulkMode() && this.selectedIds().size > 0) this.clearSelection();
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
