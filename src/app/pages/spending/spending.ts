import {
  Component, inject, signal, computed, effect,
  AfterViewInit, OnDestroy, ViewChild, ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import {
  Chart, LineController, LineElement, PointElement, Filler,
  CategoryScale, LinearScale, Tooltip,
} from 'chart.js';

import { TransactionService } from '../../services/transaction.service';
import { CategoryService } from '../../services/category.service';
import { BudgetService } from '../../services/budget.service';
import { ThemeService } from '../../services/theme.service';
import { ToastService } from '../../services/toast.service';
import { Transaction } from '../../models';

import { SpendCalendar } from '../../components/spend-calendar/spend-calendar';
import { DayDetail } from '../../components/day-detail/day-detail';
import { TransactionView } from '../../components/transaction-view/transaction-view';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';

import { filterForAnalysis } from '../../utils/analysis-filter';
import { chartColors, categoryPalette, otherColor } from '../../utils/theme-colors';
import { MoneyRules, categoryTotals, spendingTransactions, totalExpenses } from '../../utils/reporting';
import {
  DayCell, addMonths, cumulativeSeries, dateKeyOf,
  monthKeyOf, monthLabel, monthRange,
} from '../../utils/calendar';

Chart.register(
  LineController, LineElement, PointElement, Filler,
  CategoryScale, LinearScale, Tooltip,
);

/**
 * One month of spending in detail — Origin's Spending tab.
 *
 * Deliberately month-shaped, where the Analysis page is range-shaped
 * ("last 90 days"). Both exist because they answer different questions: this
 * one is "how is September going", Analysis is "how am I trending".
 *
 * Every figure here comes from `utils/reporting.ts` under the same money rules
 * Analysis and Reports use — refunded transactions dropped, internal transfers
 * never counted, partial reimbursements netted off the expense they repay — so
 * the same month reads the same wherever you look at it.
 */
@Component({
  selector: 'app-spending',
  standalone: true,
  imports: [
    CommonModule, RouterLink,
    SpendCalendar, DayDetail, TransactionView, TransactionForm, Confirm,
  ],
  templateUrl: './spending.html',
  styleUrl: './spending.scss',
})
export class Spending implements AfterViewInit, OnDestroy {
  private txService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private budgetService = inject(BudgetService);
  private themeService = inject(ThemeService);
  private toast = inject(ToastService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);

  @ViewChild('trendCanvas') trendCanvas?: ElementRef<HTMLCanvasElement>;
  private trendChart: Chart | null = null;

  // ── Controls ───────────────────────────────────────────────
  month = signal(monthKeyOf());
  view = signal<'calendar' | 'trend'>('calendar');
  breakdown = signal<'expenses' | 'budget'>('expenses');

  private thisMonth = monthKeyOf();
  monthTitle = computed(() => monthLabel(this.month()));
  monthName = computed(() => monthLabel(this.month(), false));
  /** No stepping into a month that hasn't started. */
  canGoNext = computed(() => this.month() < this.thisMonth);
  isCurrentMonth = computed(() => this.month() === this.thisMonth);

  constructor() {
    // Deep-linked from the dashboard card, so the month survives a refresh and
    // a shared URL opens on the month it names.
    this.route.queryParamMap.subscribe(params => {
      const m = params.get('month');
      if (m && /^\d{4}-\d{2}$/.test(m)) this.month.set(m);
    });

    effect(() => {
      this.trendPoints();
      if (this.view() === 'trend') this.renderWhenReady();
      else { this.trendChart?.destroy(); this.trendChart = null; }
    });

    // Chart.js bakes colours in at construction, so a theme flip needs a rebuild.
    effect(() => {
      this.themeService.theme();
      this.trendChart?.destroy();
      this.trendChart = null;
      if (this.view() === 'trend') this.renderWhenReady();
    });
  }

  step(by: -1 | 1) {
    const next = addMonths(this.month(), by);
    if (by > 0 && next > this.thisMonth) return;
    this.router.navigate([], {
      relativeTo: this.route,
      queryParams: { month: next },
      queryParamsHandling: 'merge',
    });
  }

  // ── Money ──────────────────────────────────────────────────
  private rules = computed<MoneyRules>(() => ({
    netting: true,
    effectiveExpense: t => this.txService.effectiveExpenseAmount(t),
    reimbursementSurplus: t => this.txService.reimbursementSurplus(t),
  }));

  /** Bound into the calendar, day popup and trend line alike. */
  spendAmount = (t: Transaction) => this.txService.effectiveExpenseAmount(t);

  /** The month's transactions, refunds already excluded. */
  monthTx = computed(() => {
    const { start, end } = monthRange(this.month());
    return filterForAnalysis(this.txService.transactions(), { start, end, excludeRefunded: true });
  });

  /** Only what counts as spending — what the calendar and popup are given. */
  spending = computed(() => spendingTransactions(this.monthTx()));

  total = computed(() => totalExpenses(this.monthTx(), this.rules()));

  private prevMonthTx = computed(() => {
    const { start, end } = monthRange(addMonths(this.month(), -1));
    return filterForAnalysis(this.txService.transactions(), { start, end, excludeRefunded: true });
  });

  prevTotal = computed(() => totalExpenses(this.prevMonthTx(), this.rules()));
  prevLabel = computed(() => monthLabel(addMonths(this.month(), -1), false));

  /**
   * Change against the previous month. Null when there is nothing to compare
   * to — "up 100%" from a month with no spending is not a useful statement.
   */
  delta = computed(() => {
    const prev = this.prevTotal();
    if (prev <= 0) return null;
    const diff = Math.round((this.total() - prev) * 100) / 100;
    // Unsigned: the sentence around it already says "more" or "less", and
    // "$243 less this month (−22%)" reads as a double negative.
    return { diff, pct: Math.abs(Math.round((diff / prev) * 100)) };
  });

  /**
   * Mid-month, comparing a partial month against a whole one is misleading, so
   * the current month also gets a like-for-like figure: the same days of the
   * previous month.
   */
  pacing = computed(() => {
    if (!this.isCurrentMonth()) return null;
    const today = dateKeyOf();
    const dayOfMonth = Number(today.slice(-2));
    const prevKey = addMonths(this.month(), -1);
    const cutoff = `${prevKey}-${String(dayOfMonth).padStart(2, '0')}`;
    const prevSoFar = totalExpenses(
      this.prevMonthTx().filter(t => t.date <= cutoff), this.rules());
    if (prevSoFar <= 0) return null;
    const diff = Math.round((this.total() - prevSoFar) * 100) / 100;
    return { diff, prevSoFar, dayOfMonth };
  });

  daysWithSpending = computed(() =>
    new Set(this.spending().map(t => t.date)).size);

  // ── Category breakdown ─────────────────────────────────────
  /** Top eight categories by spend; the tail folds into a neutral "Other". */
  categoryRows = computed(() => {
    const palette = categoryPalette();
    const rows = categoryTotals(this.monthTx(), this.rules());
    const total = this.total();
    const top = rows.slice(0, 8);
    const rest = rows.slice(8);

    const mapped = top.map((r, i) => {
      const cat = r.categoryId === '__none__'
        ? null
        : this.categoryService.categories().find(c => c.id === r.categoryId);
      return {
        id: r.categoryId,
        name: cat?.name ?? 'Uncategorised',
        icon: cat?.icon ?? '📦',
        color: palette[i % palette.length],
        amount: r.amount,
        pct: total > 0 ? Math.round((r.amount / total) * 1000) / 10 : 0,
      };
    });

    if (rest.length) {
      const amount = Math.round(rest.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      mapped.push({
        id: '__other__',
        name: `Other (${rest.length} categor${rest.length === 1 ? 'y' : 'ies'})`,
        icon: '•',
        color: otherColor(),
        amount,
        pct: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
      });
    }
    return mapped;
  });

  /** Budgeted categories for this month, worst-pacing first. */
  budgetRows = computed(() => {
    const month = this.month();
    const rules = this.rules();
    return this.budgetService.defaultBudgets()
      .map(b => {
        const effective = this.budgetService.getBudgetForCategory(b.categoryId, month);
        if (!effective) return null;
        const cat = this.categoryService.categories().find(c => c.id === b.categoryId);
        const spent = totalExpenses(
          this.monthTx().filter(t => t.categoryId === b.categoryId), rules);
        const pct = effective.amount > 0 ? Math.round((spent / effective.amount) * 100) : 0;
        return {
          categoryId: b.categoryId,
          name: cat?.name ?? 'Unknown',
          icon: cat?.icon ?? '📦',
          spent, budget: effective.amount, pct,
          remaining: Math.round((effective.amount - spent) * 100) / 100,
          status: pct >= 100 ? 'over' : pct >= 80 ? 'warn' : 'ok',
        };
      })
      .filter((b): b is NonNullable<typeof b> => b !== null)
      .sort((a, b) => b.pct - a.pct);
  });

  /** Newest first — this month's spending, for the list under the card. */
  latest = computed(() =>
    [...this.spending()]
      .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt ?? 0) - (a.createdAt ?? 0))
      .slice(0, 10));

  // ── Drill-through ──────────────────────────────────────────
  /** Opens the Transactions page filtered to this month, or one category of it. */
  seeAllInTransactions(categoryId?: string) {
    const { start, end } = monthRange(this.month());
    this.router.navigate(['/transactions'], {
      queryParams: {
        view: 'analysis', start, end, excludeRefunded: true,
        ...(categoryId && categoryId !== '__other__' && categoryId !== '__none__'
          ? { categoryId } : {}),
      },
    });
  }

  // ── Day popup ──────────────────────────────────────────────
  selectedDay = signal<string | null>(null);

  /** The day to step back to when the transaction view closes. See Dashboard. */
  private returnToDay = signal<string | null>(null);

  openDay(cell: DayCell) { this.selectedDay.set(cell.date); }

  closeDay() {
    this.selectedDay.set(null);
    this.returnToDay.set(null);
  }

  // ── Transaction view / edit ────────────────────────────────
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  txToDelete = signal<Transaction | null>(null);

  openTxView(tx: Transaction) { this.viewingTx.set(tx); }

  closeTxView() {
    this.viewingTx.set(null);
    const back = this.returnToDay();
    if (back) { this.returnToDay.set(null); this.selectedDay.set(back); }
  }

  openTxFromDay(tx: Transaction) {
    this.returnToDay.set(this.selectedDay());
    this.selectedDay.set(null);
    this.openTxView(tx);
  }

  editFromTxView(tx: Transaction) {
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
    catch { this.toast.error('Could not save. Please try again.'); }
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
    catch { this.toast.error('Could not delete. Please try again.'); }
    finally {
      this.txConfirmOpen.set(false);
      this.txToDelete.set(null);
      this.editingTx.set(null);
    }
  }

  // ── Trend chart ────────────────────────────────────────────
  private trendPoints = computed(() => ({
    current: cumulativeSeries(this.month(), this.spending(), this.spendAmount, dateKeyOf()),
    previous: cumulativeSeries(
      addMonths(this.month(), -1),
      spendingTransactions(this.prevMonthTx()),
      this.spendAmount,
      dateKeyOf(),
    ),
  }));

  ngAfterViewInit() {
    if (this.view() === 'trend') this.renderWhenReady();
  }

  /**
   * The canvas lives inside an `@if`, so it does not exist at the moment the
   * toggle flips — the ViewChild only resolves once Angular has rendered the
   * new branch. Retry briefly rather than drawing into nothing and leaving an
   * empty card behind.
   */
  private renderWhenReady(attempt = 0) {
    queueMicrotask(() => {
      if (this.view() !== 'trend') return;
      this.renderTrend();
      if (!this.trendChart && attempt < 20) {
        setTimeout(() => this.renderWhenReady(attempt + 1), 50);
      }
    });
  }

  ngOnDestroy() {
    this.trendChart?.destroy();
    // Scroll locks are released by the overlay components — see Dashboard.
  }

  private renderTrend() {
    const canvas = this.trendCanvas?.nativeElement;
    if (!canvas) return;
    const { current, previous } = this.trendPoints();
    const c = chartColors();

    if (this.trendChart) {
      this.trendChart.data.labels = current.map((_, i) => String(i + 1));
      this.trendChart.data.datasets[0].data = current as number[];
      this.trendChart.data.datasets[1].data = previous as number[];
      // The dataset labels name the months, so they have to move with the
      // month too. Missing this left the tooltip reading "September / August"
      // after stepping back to July — and it only looked fixed by toggling to
      // Calendar and back, because that destroys the chart and rebuilds it
      // with fresh labels.
      this.trendChart.data.datasets[0].label = this.monthName();
      this.trendChart.data.datasets[1].label = this.prevLabel();
      this.trendChart.update('none');
      return;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // A soft wash under the current month, the way Origin fills its spend area.
    const fill = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 220);
    fill.addColorStop(0, c.accent + '38');
    fill.addColorStop(1, c.accent + '00');

    this.trendChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: current.map((_, i) => String(i + 1)),
        datasets: [
          {
            label: this.monthName(),
            data: current as number[],
            borderColor: c.accent,
            backgroundColor: fill,
            borderWidth: 2,
            fill: true,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: false,
          },
          {
            label: this.prevLabel(),
            data: previous as number[],
            borderColor: c.tick,
            borderWidth: 1.5,
            borderDash: [4, 4],
            fill: false,
            tension: 0.25,
            pointRadius: 0,
            pointHoverRadius: 4,
            spanGaps: false,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              title: items => `Day ${items[0].label}`,
              label: item => ` ${item.dataset.label}: ${this.formatCurrency(item.raw as number)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: c.tick, font: { size: 10 }, maxRotation: 0,
              // Every fifth day, so the axis stays readable at any width.
              callback: (_v, i) => (i % 5 === 0 ? String(i + 1) : ''),
            },
          },
          y: {
            beginAtZero: true,
            grid: { color: c.grid },
            border: { display: false },
            ticks: {
              color: c.tick, font: { size: 10 },
              callback: v => this.formatShort(v as number),
            },
          },
        },
      },
    });
  }

  // ── Formatting ─────────────────────────────────────────────
  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
      .format(Math.abs(n));
  }

  formatShort(n: number): string {
    if (Math.abs(n) >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }

  formatDay(date: string): string {
    return new Date(date + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  categoryName(id?: string): string {
    return this.categoryService.categories().find(c => c.id === id)?.name ?? 'Uncategorised';
  }
}
