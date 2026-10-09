import {
  Component, inject, signal, computed,
  AfterViewInit, ViewChild, ElementRef, effect, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';
import { TransactionView } from '../../components/transaction-view/transaction-view';
import { Transaction } from '../../models';
import { ToastService } from '../../services/toast.service';
import { filterForAnalysis } from '../../utils/analysis-filter';
import { isMoneyBackIncome } from '../../utils/money-back';
import { MoneyRules, categoryTotals, splitTotals, totalExpenses, totalIncome } from '../../utils/reporting';
import { splitSentence } from '../../utils/shared';
import { splitStatus } from '../../utils/splits';
import { fromCents, toCents } from '../../utils/money';
import { categoryPalette, chartColors } from '../../utils/theme-colors';
import { ThemeService } from '../../services/theme.service';
import {
  Chart, ChartData, ChartOptions,
  ArcElement, DoughnutController,
  BarElement, BarController,
  CategoryScale, LinearScale,
  Tooltip, Legend
} from 'chart.js';
import { localDateString } from '../../utils/date';

Chart.register(
  ArcElement, DoughnutController,
  BarElement, BarController,
  CategoryScale, LinearScale,
  Tooltip, Legend
);

type RangeKey = 'this-month' | 'last-month' | '3-months' | 'this-year' | 'all' | 'custom';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink, TransactionForm, Confirm, TransactionView],
  templateUrl: './analysis.html',
  styleUrl: './analysis.scss'
})
export class Analysis implements AfterViewInit, OnDestroy {
  private toastService = inject(ToastService);
  private themeService = inject(ThemeService);
  private txService = inject(TransactionService);
  /** Fully refunded, counting refund incomes linked from the bank. */
  private isRefunded = (t: Transaction) => this.txService.isFullyRefunded(t);
  private accountService = inject(AccountService);
  private categoryService = inject(CategoryService);

  @ViewChild('donutCanvas') donutCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barCanvas') barCanvas!: ElementRef<HTMLCanvasElement>;

  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private chartsReady = false;

  // ── Transaction view/edit panel ────────────────────────────
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  txToDelete = signal<Transaction | null>(null);

  // Which merchant row is expanded to show all transactions
  expandedMerchant = signal<string | null>(null);

  toggleMerchant(name: string) {
    this.expandedMerchant.set(
      this.expandedMerchant() === name ? null : name
    );
  }

  // The view panel owns its own body-scroll lock.
  openTxView(tx: Transaction) {
    this.viewingTx.set(tx);
  }

  closeTxView() {
    this.viewingTx.set(null);
  }

  editFromTxView() {
    const tx = this.viewingTx();
    this.viewingTx.set(null);
    if (tx) {
      this.editingTx.set(tx);
      this.txFormOpen.set(true);
    }
  }

  closeTxForm() {
    this.txFormOpen.set(false);
    this.editingTx.set(null);
  }

  async handleTxSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const tx = this.editingTx();
    if (!tx?.id) return;
    try {
      await this.txService.update(tx.id, data);
      this.closeTxForm();
    } catch (err) {
      this.toastService.error('Failed. Please try again.');
    }
  }

  askTxDelete() {
    this.txToDelete.set(this.editingTx());
    this.txFormOpen.set(false);
    this.txConfirmOpen.set(true);
  }

  async confirmTxDelete() {
    const tx = this.txToDelete();
    if (!tx?.id) return;
    try {
      await this.txService.remove(tx.id);
    } finally {
      this.txConfirmOpen.set(false);
      this.txToDelete.set(null);
      this.editingTx.set(null);
    }
  }

  // ── Filters ────────────────────────────────────────────────
  range = signal<RangeKey>('this-month');
  filterAccountId = signal('');
  excludeRefunded = signal(true);
  excludedCategories = signal<Set<string>>(new Set());
  customStart = signal('');
  customEnd = signal('');
  todayStr = localDateString(); // local, not UTC (UTC is already tomorrow on a US evening)

  ranges: { value: RangeKey; label: string }[] = [
    { value: 'this-month',  label: 'This month' },
    { value: 'last-month',  label: 'Last month' },
    { value: '3-months',    label: 'Last 3 months' },
    { value: 'this-year',   label: 'This year' },
    { value: 'all',         label: 'All time' },
    { value: 'custom',      label: 'Custom' },
  ];

  showCategoryFilter = signal(false);

  selectRange(r: RangeKey) {
    this.range.set(r);
    if (r === 'custom' && !this.customStart()) {
      // Default the custom picker to the current month so it opens with a
      // sensible, non-empty range rather than "all time" until both dates are set.
      const now = new Date();
      this.customStart.set(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`);
      this.customEnd.set(this.todayStr);
    }
  }

  // ── Date range ─────────────────────────────────────────────
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

    switch (this.range()) {
      case 'this-month':
        return { start: localDate(y, m, 1), end: localDate(y, m, lastDay(y, m)) };
      case 'last-month':
        return { start: localDate(y, m - 1, 1), end: localDate(y, m - 1, lastDay(y, m - 1)) };
      case '3-months':
        return { start: localDate(y, m - 2, 1), end: localDate(y, m, lastDay(y, m)) };
      case 'this-year':
        return { start: `${y}-01-01`, end: `${y}-12-31` };
      case 'custom':
        return { start: this.customStart(), end: this.customEnd() };
      default:
        return { start: '', end: '' };
    }
  });

  // ── Filtered transactions ──────────────────────────────────
  filtered = computed(() => {
    const { start, end } = this.dateRange();
    return filterForAnalysis(this.txService.transactions(), {
      start, end,
      accountId: this.filterAccountId(),
      excludeRefunded: this.excludeRefunded(),
      isRefunded: this.isRefunded,
      excludedCategoryIds: this.excludedCategories(),
    });
  });

  // Internal transfers (e.g. a credit card payment) are excluded. They are real money
  // movement between the user's own accounts, not real spending/earning.
  expenses = computed(() => this.filtered().filter(t => t.type === 'expense' && !t.isInternalTransfer));

  /** An expense's true cost after any linked reimbursements, unless netting is
   *  off ("Include refunded"), in which case every expense counts as recorded.
   *
   *  Public because the drill-down lists have to show the same figure this page
   *  totals: a $173.27 charge that was $101.76 paid back counts as $71.51 here,
   *  and a row printing $173.27 under a $117.28 header does not add up. */
  eff(t: Transaction): number {
    if (!this.excludeRefunded()) return t.amount;
    return this.txService.effectiveExpenseAmount(t);
  }

  /** How much of an expense came back, for the "was $X, $Y back" note. */
  reimbursedOn(t: Transaction): number {
    if (!this.excludeRefunded()) return 0;
    return this.txService.moneyBackFor(t);
  }

  // ── Split bills ────────────────────────────────────────────
  /** Split bills in the period: your share, what you covered for others, what's come back. */
  splits = computed(() => splitTotals(this.filtered(), t => this.txService.moneyBackEntriesFor(t)));

  /** How the period reads in a sentence ("…on 2 split bills this month"). */
  private periodPhrase = computed(() => {
    switch (this.range()) {
      case 'this-month': return 'this month';
      case 'last-month': return 'last month';
      case '3-months': return 'in the last 3 months';
      case 'this-year': return 'this year';
      case 'custom': return 'in this period';
      default: return '';
    }
  });

  splitText = computed(() => splitSentence(this.splits(), this.periodPhrase()));

  /** Integer cents, as currency. */
  cents(n: number): string {
    return this.formatCurrency(fromCents(n));
  }

  /**
   * The quiet line under a drill-down row's net figure: the charge itself when
   * money came back, and your share when the bill was split, so a $49.05
   * pizza reads as "your share $12.27", not as $49.05 of your own spending.
   */
  txNote(t: Transaction): string {
    const parts: string[] = [];
    const back = this.reimbursedOn(t);
    if (back > 0.005) parts.push(`${this.formatCurrency(t.amount)} · ↩ ${this.formatCurrency(back)} back`);
    if (t.split) {
      const share = splitStatus(t.split, this.txService.moneyBackEntriesFor(t)).myShareCents;
      parts.push(`your share ${this.cents(share)}`);
    }
    return parts.join(' · ');
  }

  // ── KPIs ───────────────────────────────────────────────────
  // The totals are shared with Reports and the category breakdown
  // (utils/reporting.ts), and added up in whole cents. With the toggle on,
  // reimbursements over the original expense count as income (see
  // reimbursementSurplus).
  private rules = computed<MoneyRules>(() => this.txService.moneyRules(this.excludeRefunded()));

  totalExpenses = computed(() => totalExpenses(this.filtered(), this.rules()));

  totalIncome = computed(() => totalIncome(this.filtered(), this.rules()));

  /** Spending per category, largest first, in dollars. */
  private categoryTotals = computed(() => categoryTotals(this.filtered(), this.rules()));

  avgMonthlySpend = computed(() => {
    const txs = this.expenses();
    if (!txs.length) return 0;
    const months = new Set(txs.map(t => t.date.slice(0, 7))).size || 1;
    return fromCents(Math.round(toCents(this.totalExpenses()) / months));
  });

  savingsRate = computed(() => {
    const inc = this.totalIncome();
    if (!inc) return null;  // meaningless without income
    return Math.round(((inc - this.totalExpenses()) / inc) * 100);
  });

  // Human-readable savings rate context
  savingsRateLabel = computed(() => {
    if (this.totalIncome() === 0) return 'No income this period';
    const rate = this.savingsRate();
    if (rate === null) return '';
    if (rate > 0) return `Saving ${rate}% of income`;
    return `Spending ${Math.abs(rate)}% more than income`;
  });

  topCategory = computed(() => {
    const top = this.categoryTotals().find(c => c.categoryId !== '__none__');
    if (!top) return null;
    const cat = this.categoryService.categories().find(c => c.id === top.categoryId);
    return cat ? { name: cat.name, icon: cat.icon, amount: top.amount } : null;
  });

  largestExpense = computed(() => {
    const txs = this.expenses();
    if (!txs.length) return null;
    return txs.reduce((max, t) => this.eff(t) > this.eff(max) ? t : max, txs[0]);
  });

  // ── Spending by category ───────────────────────────────────
  categoryBreakdown = computed(() => {
    const total = this.totalExpenses();
    return this.categoryTotals()
      .slice(0, 8)
      .map(({ categoryId: id, amount }, i) => {
        const cat = id === '__none__'
          ? { name: 'Uncategorized', icon: '📦', color: '#9ca3af' }
          : this.categoryService.categories().find(c => c.id === id);
        return {
          id,
          name: cat?.name || 'Unknown',
          icon: (cat as any)?.icon || '📦',
          // A category without its own colour takes the next palette hue, so
          // slices stay apart rather than all falling back to one purple.
          color: (cat as any)?.color || categoryPalette()[i % 8],
          amount,
          pct: total > 0 ? Math.round((amount / total) * 100) : 0
        };
      });
  });

  // ── Top merchants: tracks all transactions per merchant for correct latest pick
  topMerchants = computed(() => {
    // amount in cents
    const byMerchant = new Map<string, { amount: number; txs: Transaction[] }>();
    for (const t of this.expenses()) {
      const key = t.merchant || 'Unknown';
      const amt = toCents(this.eff(t));
      const existing = byMerchant.get(key);
      if (!existing) {
        byMerchant.set(key, { amount: amt, txs: [t] });
      } else {
        existing.amount += amt;
        existing.txs.push(t);
      }
    }
    return [...byMerchant.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 10)
      .map(([name, data], i) => {
        // Sort by date desc, then by amount desc for same-date ties
        const sorted = [...data.txs].sort((a, b) => {
          if (b.date !== a.date) return b.date.localeCompare(a.date);
          return b.amount - a.amount;
        });
        return {
          rank: i + 1,
          name,
          amount: fromCents(data.amount),
          count: data.txs.length,
          lastTx: sorted[0],
          txs: sorted   // all transactions, newest first
        };
      });
  });

  // ── Monthly trend data ─────────────────────────────────────
  monthlyTrend = computed(() => {
    const now = new Date();
    const months = new Map<string, { income: number; expenses: number }>(); // in cents
    let numMonths = 6;
    if (this.range() === 'this-year') numMonths = 12;
    if (this.range() === 'all') numMonths = 12;

    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      months.set(`${y}-${m}`, { income: 0, expenses: 0 });
    }

    const netting = this.excludeRefunded();
    for (const t of this.txService.transactions()) {
      if (t.isInternalTransfer) continue;
      const key = t.date.slice(0, 7);
      if (!months.has(key)) continue;
      const entry = months.get(key)!;
      if (t.type === 'income' && (!netting || !isMoneyBackIncome(t))) entry.income += toCents(t.amount);
      if (t.type === 'expense' && !this.txService.isFullyRefunded(t)) {
        entry.expenses += toCents(this.eff(t));
        if (netting) entry.income += toCents(this.txService.reimbursementSurplus(t));
      }
    }

    return [...months.entries()].map(([month, data]) => {
      const [y, m] = month.split('-').map(Number);
      const label = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'short' });
      return {
        month, label,
        income: fromCents(data.income),
        expenses: fromCents(data.expenses),
      };
    });
  });

  allExpenseCategories = computed(() =>
    this.categoryService.categories().filter(c => c.kind === 'expense')
  );

  // Human label for the active range: a real date span for "Custom" instead of
  // just the word "Custom", since that's the whole point of picking exact dates.
  rangeLabel = computed(() => {
    if (this.range() === 'custom') {
      const s = this.customStart(), e = this.customEnd();
      if (!s || !e) return 'Custom range';
      const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
      return `${fmt(s)} – ${fmt(e)}`;
    }
    return this.ranges.find(r => r.value === this.range())?.label || '';
  });

  // Dynamic subtitle
  subtitle = computed(() => {
    const label = this.rangeLabel();
    const spent = this.totalExpenses();
    if (!spent) return label;
    return `${label} · ${this.formatCurrency(spent)} spent`;
  });

  // Query params for "see all" links so Transactions/the category breakdown page
  // reflect the exact same filtered period the user is currently looking at.
  seeAllParams = computed(() => {
    const { start, end } = this.dateRange();
    const qp: Record<string, string> = {};
    if (start) qp['start'] = start;
    if (end) qp['end'] = end;
    if (this.filterAccountId()) qp['accountId'] = this.filterAccountId();
    return qp;
  });

  categoryBreakdownParams = computed(() => {
    const qp = { ...this.seeAllParams() };
    if (!this.excludeRefunded()) qp['excludeRefunded'] = 'false';
    const excluded = [...this.excludedCategories()];
    if (excluded.length) qp['excluded'] = excluded.join(',');
    return qp;
  });

  // Params for "See all transactions": same period as above, plus a marker so the
  // Transactions page enters an "analysis view" (matches these KPIs exactly: refunded
  // + internal-transfer rows stay visible but greyed out and are left out of totals).
  seeAllTxParams = computed(() => {
    const qp: Record<string, string> = { ...this.seeAllParams(), view: 'analysis' };
    qp['excludeRefunded'] = this.excludeRefunded() ? 'true' : 'false';
    return qp;
  });

  toggleCategoryExclusion(categoryId: string) {
    const current = new Set(this.excludedCategories());
    if (current.has(categoryId)) current.delete(categoryId);
    else current.add(categoryId);
    this.excludedCategories.set(current);
  }

  isCategoryExcluded(categoryId: string): boolean {
    return this.excludedCategories().has(categoryId);
  }

  // ── Helpers ────────────────────────────────────────────────
  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }

  formatCurrencyShort(n: number): string {
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }

  formatFullDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
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

  accountName(id?: string): string {
    if (!id) return 'None';
    const a = this.accountService.accounts().find(a => a.id === id);
    if (!a) return 'None';
    return a.icon ? `${a.icon} ${a.name}` : a.name;
  }

  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id) || null;
  }

  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  // ── Charts ─────────────────────────────────────────────────
  constructor() {
    effect(() => {
      const catData = this.categoryBreakdown();
      const trendData = this.monthlyTrend();
      if (this.chartsReady) {
        this.updateDonut(catData);
        this.updateBar(trendData);
      }
    });

    // Chart.js resolves colours once, at construction, so a theme switch would
    // leave these painted for the previous theme. Rebuild both on change.
    effect(() => {
      this.themeService.theme();
      if (!this.chartsReady) return;
      this.donutChart?.destroy(); this.donutChart = null;
      this.barChart?.destroy();   this.barChart = null;
      queueMicrotask(() => this.initCharts());
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.initCharts();
      this.chartsReady = true;
    }, 100);
  }

  ngOnDestroy() {
    this.donutChart?.destroy();
    this.barChart?.destroy();
  }

  private initCharts() {
    this.initDonut();
    this.initBar();
  }

  private initDonut() {
    const ctx = this.donutCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;
    const data = this.categoryBreakdown();
    this.donutChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          data: data.map(d => d.amount),
          backgroundColor: data.map(d => d.color),
          borderWidth: 3,
          borderColor: chartColors().surface,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            position: 'nearest',
            yAlign: 'bottom',
            callbacks: {
              label: (ctx) => {
                const val = ctx.raw as number;
                const total = this.totalExpenses();
                const pct = total > 0 ? Math.round(val / total * 100) : 0;
                return ` ${ctx.label}: ${this.formatCurrency(val)} (${pct}%)`;
              }
            }
          }
        }
      }
    });
  }

  private initBar() {
    const ctx = this.barCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;
    const data = this.monthlyTrend();
    const c = chartColors();
    this.barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Income',
            data: data.map(d => d.income),
            backgroundColor: c.positive,
            borderWidth: 0,
            borderRadius: 4,
            barPercentage: 0.55,
            categoryPercentage: 0.7,
          },
          {
            label: 'Spending',
            data: data.map(d => d.expenses),
            backgroundColor: c.accent,
            borderRadius: 4,
            barPercentage: 0.55,
            categoryPercentage: 0.7,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${this.formatCurrency(ctx.raw as number)}`
            }
          }
        },
        scales: {
          x: { grid: { display: false }, border: { display: false }, ticks: { color: c.tick, font: { size: 11 } } },
          y: {
            grid: { color: c.grid },
            border: { display: false },
            ticks: { color: c.tick, font: { size: 11 }, callback: (val) => this.formatCurrencyShort(val as number) }
          }
        }
      }
    });
  }

  private updateDonut(data: ReturnType<typeof this.categoryBreakdown>) {
    if (!this.donutChart) return;
    this.donutChart.data.labels = data.map(d => d.name);
    this.donutChart.data.datasets[0].data = data.map(d => d.amount);
    (this.donutChart.data.datasets[0] as any).backgroundColor = data.map(d => d.color);
    this.donutChart.update('none');
  }

  private updateBar(data: ReturnType<typeof this.monthlyTrend>) {
    if (!this.barChart) return;
    this.barChart.data.labels = data.map(d => d.label);
    this.barChart.data.datasets[0].data = data.map(d => d.income);
    this.barChart.data.datasets[1].data = data.map(d => d.expenses);
    this.barChart.update('none');
  }
}