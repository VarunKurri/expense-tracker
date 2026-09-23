import { Component, inject, signal, computed, AfterViewInit, ViewChild, ElementRef, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { CategoryService } from '../../services/category.service';
import { BillService } from '../../services/bill.service';
import { BudgetService } from '../../services/budget.service';
import { QuickAddService } from '../../services/quick-add.service';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { BillForm } from '../bills/bill-form/bill-form';
import { Confirm } from '../../components/confirm/confirm';
import { ToastService } from '../../services/toast.service';
import { Account, Bill, Transaction } from '../../models';
import { chartColors } from '../../utils/theme-colors';
import { ThemeService } from '../../services/theme.service';
import { SpendCalendar } from '../../components/spend-calendar/spend-calendar';
import { DayDetail } from '../../components/day-detail/day-detail';
import { TransactionView } from '../../components/transaction-view/transaction-view';
import { DayCell, monthKeyOf, monthLabel } from '../../utils/calendar';
import { spendingTransactions } from '../../utils/reporting';
import {
  Chart, ArcElement, DoughnutController,
  Tooltip, Legend
} from 'chart.js';

Chart.register(ArcElement, DoughnutController, Tooltip, Legend);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [
    CommonModule, TransactionForm, BillForm, Confirm,
    SpendCalendar, DayDetail, TransactionView,
  ],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard implements AfterViewInit, OnDestroy {
  private accountService = inject(AccountService);
  private txService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private billService = inject(BillService);
  private budgetService = inject(BudgetService);
  private quickAddService = inject(QuickAddService);
  private router = inject(Router);
  private toastService = inject(ToastService);
  private themeService = inject(ThemeService);
  Math = Math

  @ViewChild('miniDonutCanvas') miniDonutCanvas!: ElementRef<HTMLCanvasElement>;
  private miniDonut: Chart | null = null;

  activeRange = signal<'7D' | '30D' | '90D' | 'YTD'>('30D');

  testToasts() {
    this.toastService.success('Transaction saved successfully');
    setTimeout(() => this.toastService.error('Failed to load data'), 1000);
    setTimeout(() => this.toastService.info('Syncing your accounts…'), 2000);
  }

  // ── Transaction view panel ────────────────────────────────
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  txToDelete = signal<Transaction | null>(null);

  // The overlays own their own body-scroll locks, so these only move state.
  openTxView(tx: Transaction) { this.viewingTx.set(tx); }

  /** Steps back to the day popup when that is where this was opened from. */
  closeTxView() {
    this.viewingTx.set(null);
    const back = this.returnToDay();
    if (back) { this.returnToDay.set(null); this.selectedDay.set(back); }
  }

  editFromTxView(tx: Transaction) {
    // Editing leaves the day popup behind — the form is a new destination, not
    // a step deeper into it.
    this.returnToDay.set(null);
    this.viewingTx.set(null);
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  closeTxForm() { this.txFormOpen.set(false); this.editingTx.set(null); }

  async handleTxSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const tx = this.editingTx();
    if (!tx?.id) return;
    try { await this.txService.update(tx.id, data); this.closeTxForm(); }
    catch (err) { this.toastService.error('Failed. Please try again.'); }
  }

  askTxDelete() {
    this.txToDelete.set(this.editingTx());
    this.txFormOpen.set(false);
    this.txConfirmOpen.set(true);
  }

  async confirmTxDelete() {
    const tx = this.txToDelete();
    if (!tx?.id) return;
    try { await this.txService.remove(tx.id); }
    finally { this.txConfirmOpen.set(false); this.txToDelete.set(null); this.editingTx.set(null); }
  }

  // ── Bill edit form ────────────────────────────────────────
  editingBill = signal<Bill | null>(null);
  billFormOpen = signal(false);
  billConfirmOpen = signal(false);
  billToDelete = signal<Bill | null>(null);

  openBillEdit(bill: Bill) {
    this.editingBill.set(bill);
    this.billFormOpen.set(true);
  }

  closeBillForm() { this.billFormOpen.set(false); this.editingBill.set(null); }

  async handleBillSave(data: Omit<Bill, 'id' | 'createdAt'>) {
    const b = this.editingBill();
    try {
      if (b?.id) await this.billService.update(b.id, data);
      this.closeBillForm();
    } catch (err) { this.toastService.error('Failed. Please try again.'); }
  }

  askBillDelete() {
    this.billToDelete.set(this.editingBill());
    this.billFormOpen.set(false);
    this.billConfirmOpen.set(true);
  }

  async confirmBillDelete() {
    const b = this.billToDelete();
    if (!b?.id) return;
    try { await this.billService.remove(b.id); }
    finally { this.billConfirmOpen.set(false); this.billToDelete.set(null); this.editingBill.set(null); }
  }

  // ── Account navigation ────────────────────────────────────
  openAccount(account: Account) {
    if (account.type === 'credit') {
      this.router.navigate(['/accounts', account.id]);
    } else {
      this.router.navigate(['/accounts/overview', account.id]);
    }
  }

  // ── Data ──────────────────────────────────────────────────
  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  balanceFor(account: Account): number {
    const txDelta = this.txService.balanceForAccount(account.id!);
    const balance = account.type === 'credit'
      ? account.openingBalance - txDelta
      : (account.openingBalance || 0) + txDelta;
    return Math.round(balance * 100) / 100;
  }

  netWorth = computed(() => {
    let assets = 0, liabilities = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit') { if (bal > 0) liabilities += bal; else assets += Math.abs(bal); }
      else { if (bal >= 0) assets += bal; else liabilities += Math.abs(bal); }
    }
    return Math.round((assets - liabilities) * 100) / 100;
  });

  netWorthChange = computed(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    const cutoff = this.localDateString(d);
    return Math.round(
      this.txService.transactions()
        .filter(t => t.date >= cutoff && !t.isInternalTransfer)
        .reduce((s, t) => {
          if (t.type === 'income') return s + t.amount;
          if (t.type === 'expense') return s - t.amount;
          return s;
        }, 0) * 100
    ) / 100;
  });

  // ── Spending calendar ─────────────────────────────────────
  /**
   * The month the calendar card shows. The dashboard is always "now" — stepping
   * through months is what the Spending page is for.
   */
  calendarMonth = monthKeyOf();
  calendarLabel = monthLabel(this.calendarMonth, false);

  /**
   * What the calendar counts as spending. Deliberately the same rules the
   * Analysis and Reports pages use by default — expenses only, no internal
   * transfers, refunded transactions dropped, and partial reimbursements netted
   * off — so the figure on this card matches what those pages show for the same
   * month rather than being a fourth, slightly different number.
   */
  monthSpending = computed(() =>
    spendingTransactions(this.txService.transactions())
      .filter(t => !t.refunded && t.date.startsWith(this.calendarMonth))
  );

  /** Bound into the calendar and day popup so both net reimbursements the same way. */
  spendAmount = (t: Transaction) => this.txService.effectiveExpenseAmount(t);

  monthTotal = computed(() =>
    Math.round(this.monthSpending().reduce((s, t) => s + this.spendAmount(t), 0) * 100) / 100
  );

  /** The day popup's open state — null when closed. */
  selectedDay = signal<string | null>(null);

  /**
   * The day to come back to when the transaction view closes.
   *
   * Without this, closing a transaction opened from a day popup dumps you on
   * the dashboard — you lose your place and have to find the day again. Closing
   * an overlay should undo the step that opened it, not the whole stack.
   */
  private returnToDay = signal<string | null>(null);

  openDay(cell: DayCell) { this.selectedDay.set(cell.date); }

  closeDay() {
    this.selectedDay.set(null);
    this.returnToDay.set(null);
  }

  /** Day popup → the full transaction view, so one tap gets to the detail. */
  openTxFromDay(tx: Transaction) {
    this.returnToDay.set(this.selectedDay());
    this.selectedDay.set(null);
    this.openTxView(tx);
  }

  openSpending() {
    this.router.navigate(['/analysis/spending'], {
      queryParams: { month: this.calendarMonth },
    });
  }

  private rangeStart = computed((): string => {
    const now = new Date();
    switch (this.activeRange()) {
      case '7D':  { const d = new Date(now); d.setDate(d.getDate() - 7);  return this.localDateString(d); }
      case '30D': { const d = new Date(now); d.setDate(d.getDate() - 30); return this.localDateString(d); }
      case '90D': { const d = new Date(now); d.setDate(d.getDate() - 90); return this.localDateString(d); }
      case 'YTD': return `${now.getFullYear()}-01-01`;
    }
  });

  rangeIncome = computed(() =>
    this.txService.transactions()
      .filter(t => t.type === 'income' && !t.isInternalTransfer && t.date >= this.rangeStart())
      .reduce((s, t) => s + t.amount, 0)
  );
  rangeExpenses = computed(() =>
    this.txService.transactions()
      .filter(t => t.type === 'expense' && !t.isInternalTransfer && t.date >= this.rangeStart())
      .reduce((s, t) => s + t.amount, 0)
  );
  savingsRate = computed(() => {
    const income = this.rangeIncome();
    if (!income) return null;
    return Math.round(((income - this.rangeExpenses()) / income) * 100);
  });

  recentTransactions = computed(() => this.txService.transactions().slice(0, 8));

  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id);
  }

  accountName(id?: string): string {
    if (!id) return '';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? a.name : '';
  }

  timeAgo(date: string): string {
    const now = new Date();
    const d = new Date(date + 'T00:00:00');
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${diff}d ago`;
  }

  upcomingBills = computed(() =>
    this.billService.upcomingBills(7).filter(b => b.active)
  );
  overdueBills = computed(() =>
    this.billService.overdueBills().filter(b => b.active)
  );

  daysUntil(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(date + 'T00:00:00');
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  localDate(dateStr: string): Date {
    return new Date(dateStr + 'T00:00:00');
  }

  // Local date string — never UTC
  private localDateString(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // currentMonth in local time
  currentMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  budgetSummary = computed(() => {
    const month = this.currentMonth;
    return this.budgetService.defaultBudgets()
      .map(budget => {
        const effective = this.budgetService.getBudgetForCategory(budget.categoryId, month);
        if (!effective) return null;
        const cat = this.categoryService.categories().find(c => c.id === budget.categoryId);
        const spent = this.txService.transactions()
          .filter(t =>
            t.type === 'expense' &&
            !t.isInternalTransfer &&
            t.categoryId === budget.categoryId &&
            t.date.startsWith(month) &&
            !t.refunded
          )
          .reduce((s, t) => s + t.amount, 0);
        const pct = effective.amount > 0 ? Math.round((spent / effective.amount) * 100) : 0;
        return {
          name: cat?.name || 'Unknown', icon: cat?.icon || '📦',
          spent: Math.round(spent * 100) / 100,
          budget: effective.amount, pct,
          status: pct >= 100 ? 'over' : pct >= 75 ? 'warn' : 'ok'
        };
      })
      .filter(Boolean)
      .sort((a, b) => b!.pct - a!.pct)
      .slice(0, 4);
  });

  // Last-30-days spending, matching the cash-flow chart's window (so the dashboard is
  // consistent and isn't blank early in the month or with recent-but-past-month data).
  recentExpenses = computed(() => {
    const now = new Date();
    const cutoff = this.localDateString(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29));
    const today = this.localDateString(now);
    return this.txService.transactions()
      .filter(t => t.type === 'expense' && !t.refunded && !t.isInternalTransfer && t.date >= cutoff && t.date <= today);
  });
  recentTotal = computed(() =>
    Math.round(this.recentExpenses().reduce((s, t) => s + t.amount, 0) * 100) / 100
  );
  categoryBreakdown = computed(() => {
    const byCat = new Map<string, number>();
    for (const t of this.recentExpenses()) {
      const key = t.categoryId || '__none__';
      byCat.set(key, (byCat.get(key) || 0) + t.amount);
    }
    const total = this.recentTotal();
    return [...byCat.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 6)
      .map(([id, amount]) => {
        const cat = id === '__none__'
          ? { name: 'Other', icon: '📦', color: '#9ca3af' }
          : this.categoryService.categories().find(c => c.id === id);
        return {
          name: cat?.name || 'Unknown',
          icon: (cat as any)?.icon || '📦',
          color: (cat as any)?.color || '#6366f1',
          amount: Math.round(amount * 100) / 100,
          pct: total > 0 ? Math.round((amount / total) * 100) : 0
        };
      });
  });

  // ── Helpers ───────────────────────────────────────────────
  formatWhole(n: number): string {
    return Math.floor(Math.round(Math.abs(n) * 100) / 100).toLocaleString('en-US');
  }
  formatCents(n: number): string {
    const rounded = Math.round(Math.abs(n) * 100) / 100;
    return Math.round((rounded % 1) * 100).toString().padStart(2, '0');
  }
  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }
  billAmountLabel(bill: Bill): string {
    const base = this.formatCurrency(bill.amount);
    return bill.amountMode === 'variable' ? `${base} est.` : base;
  }
  formatCurrencyShort(n: number): string {
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }
  isNegative(n: number): boolean { return n < 0; }
  navigate(path: string) { this.router.navigate([path]); }
  setRange(r: string) { this.activeRange.set(r as '7D' | '30D' | '90D' | 'YTD'); }

  addMoney() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() =>
        setTimeout(() => this.quickAddService.trigger('income'), 150)
      );
    } else { this.quickAddService.trigger('income'); }
  }

  addExpense() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() =>
        setTimeout(() => this.quickAddService.trigger('expense'), 150)
      );
    } else { this.quickAddService.trigger('expense'); }
  }

  // ── Charts ────────────────────────────────────────────────
  constructor() {
    effect(() => {
      const donutData = this.categoryBreakdown();
      this.ensureDonut();
      if (this.miniDonut) this.updateMiniDonut(donutData);
    });

    // Chart.js bakes colours in at construction time, so a theme switch would
    // otherwise leave the chart painted for the old theme. Rebuild on change.
    effect(() => {
      this.themeService.theme();
      this.miniDonut?.destroy();
      this.miniDonut = null;
      queueMicrotask(() => this.ensureDonut());
    });
  }

  ngAfterViewInit() {
    this.initChartsWhenReady();
  }

  // The donut canvas is only in the DOM when there is spending to show, and it
  // arrives a tick after the data does; retry until it exists.
  private initChartsWhenReady(attempt = 0) {
    this.ensureDonut();
    if (!this.miniDonut && this.recentTotal() > 0 && attempt < 20) {
      setTimeout(() => this.initChartsWhenReady(attempt + 1), 100);
    }
  }

  private ensureDonut() {
    const el = this.miniDonutCanvas?.nativeElement;
    // The donut canvas is added/removed with current-month data; keep the chart in sync.
    if (this.miniDonut && !el) { this.miniDonut.destroy(); this.miniDonut = null; }
    if (!this.miniDonut && el) this.initMiniDonut();
  }

  ngOnDestroy() {
    this.miniDonut?.destroy();
    // Scroll locks are released by the overlay components themselves, via
    // ScrollLockService — writing to body.overflow here would bypass its
    // counter and could release a lock another overlay still holds.
  }

  private initMiniDonut() {
    const ctx = this.miniDonutCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;
    const data = this.categoryBreakdown();
    this.miniDonut = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{ data: data.map(d => d.amount), backgroundColor: data.map(d => d.color), borderWidth: 2, borderColor: chartColors().surface, hoverOffset: 4 }]
      },
      options: {
        responsive: true, maintainAspectRatio: false, cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: (ctx) => ` ${ctx.label}: ${this.formatCurrency(ctx.raw as number)}` } }
        }
      }
    });
  }

  private updateMiniDonut(data: any[]) {
    if (!this.miniDonut) return;
    this.miniDonut.data.labels = data.map(d => d.name);
    this.miniDonut.data.datasets[0].data = data.map(d => d.amount);
    (this.miniDonut.data.datasets[0] as any).backgroundColor = data.map(d => d.color);
    this.miniDonut.update('none');
  }
}
