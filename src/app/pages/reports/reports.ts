import {
  Component, inject, signal, computed, effect,
  AfterViewInit, OnDestroy, ViewChild, ElementRef,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import {
  Chart, BarController, BarElement, CategoryScale, LinearScale,
  DoughnutController, ArcElement, Tooltip, Legend,
} from 'chart.js';
import { SankeyController, Flow } from 'chartjs-chart-sankey';

import { TransactionService } from '../../services/transaction.service';
import { CategoryService } from '../../services/category.service';
import { ThemeService } from '../../services/theme.service';
import { filterForAnalysis } from '../../utils/analysis-filter';
import { chartColors, categoryPalette, otherColor } from '../../utils/theme-colors';
import {
  MoneyRules, totalExpenses, totalIncome, categoryTotals, incomeTotals,
  monthlySeries, monthsBetween, transferTotals, sankeyLinks, sankeyLabel,
} from '../../utils/reporting';

Chart.register(
  BarController, BarElement, CategoryScale, LinearScale,
  DoughnutController, ArcElement, Tooltip, Legend,
  SankeyController, Flow,
);

type ReportKey = 'cash-flow' | 'expenses' | 'income' | 'transfers';
type RangeKey = '3-months' | '6-months' | 'this-year' | 'custom';

/** The chart shapes each report offers, in the order their toggle shows them. */
const VIEWS: Record<ReportKey, { id: string; label: string }[]> = {
  'cash-flow': [
    { id: 'stacked', label: 'Stacked bars' },
    { id: 'grouped', label: 'Side-by-side bars' },
    { id: 'sankey',  label: 'Sankey' },
  ],
  expenses: [
    { id: 'stacked', label: 'Bars by month' },
    { id: 'donut',   label: 'Donut by category' },
  ],
  income:    [{ id: 'grouped', label: 'Bars by month' }],
  transfers: [{ id: 'waterfall', label: 'Money in vs out' }],
};

@Component({
  selector: 'app-reports',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './reports.html',
  styleUrl: './reports.scss',
})
export class Reports implements AfterViewInit, OnDestroy {
  private txService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private themeService = inject(ThemeService);

  @ViewChild('chartCanvas') chartCanvas?: ElementRef<HTMLCanvasElement>;
  private chart: Chart | null = null;

  // ── Controls ───────────────────────────────────────────────
  report = signal<ReportKey>('cash-flow');
  range = signal<RangeKey>('6-months');
  view = signal<string>('stacked');
  customStart = signal('');
  customEnd = signal('');
  /** Netting matches the Analysis page's "exclude refunded" default. */
  netting = signal(true);

  todayStr = new Date().toISOString().slice(0, 10);

  reports: { value: ReportKey; label: string }[] = [
    { value: 'cash-flow', label: 'Cash flow' },
    { value: 'expenses',  label: 'Expenses' },
    { value: 'income',    label: 'Income' },
    { value: 'transfers', label: 'Transfers' },
  ];

  ranges: { value: RangeKey; label: string }[] = [
    { value: '3-months', label: 'Last 3 months' },
    { value: '6-months', label: 'Last 6 months' },
    { value: 'this-year', label: 'This year' },
    { value: 'custom',   label: 'Custom' },
  ];

  views = computed(() => VIEWS[this.report()]);

  selectReport(r: ReportKey) {
    this.report.set(r);
    // Each report offers different shapes; fall back to its first.
    this.view.set(VIEWS[r][0].id);
  }

  selectRange(r: RangeKey) {
    this.range.set(r);
    if (r === 'custom' && !this.customStart()) {
      const d = new Date();
      d.setMonth(d.getMonth() - 2);
      this.customStart.set(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`);
      this.customEnd.set(this.todayStr);
    }
  }

  // ── Period ─────────────────────────────────────────────────
  private dateRange = computed(() => {
    const now = new Date();
    const y = now.getFullYear(), m = now.getMonth();
    const iso = (yy: number, mm: number, dd: number) =>
      `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
    const lastDay = (yy: number, mm: number) => new Date(yy, mm + 1, 0).getDate();

    switch (this.range()) {
      case '3-months': return { start: iso(y, m - 2, 1), end: iso(y, m, lastDay(y, m)) };
      case '6-months': return { start: iso(y, m - 5, 1), end: iso(y, m, lastDay(y, m)) };
      case 'this-year': return { start: `${y}-01-01`, end: `${y}-12-31` };
      case 'custom': return { start: this.customStart(), end: this.customEnd() };
    }
  });

  rangeLabel = computed(() => {
    const { start, end } = this.dateRange();
    if (!start || !end) return 'Pick a start and end date';
    const fmt = (s: string) => {
      const [yy, mm, dd] = s.split('-').map(Number);
      return new Date(yy, mm - 1, dd).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    };
    return `${fmt(start)} – ${fmt(end)}`;
  });

  rangeTitle = computed(() =>
    this.ranges.find(r => r.value === this.range())?.label ?? '');

  // ── Data ───────────────────────────────────────────────────
  /** The same filter the Analysis page uses, so both agree on the period. */
  private filtered = computed(() => {
    const { start, end } = this.dateRange();
    return filterForAnalysis(this.txService.transactions(), {
      start, end, excludeRefunded: this.netting(),
    });
  });

  /** Injected so the reporting helpers stay pure and testable. */
  private rules = computed<MoneyRules>(() => ({
    netting: this.netting(),
    effectiveExpense: t => this.txService.effectiveExpenseAmount(t),
    reimbursementSurplus: t => this.txService.reimbursementSurplus(t),
  }));

  private months = computed(() => {
    const { start, end } = this.dateRange();
    return monthsBetween(start, end);
  });

  monthRows = computed(() => monthlySeries(this.filtered(), this.rules(), this.months()));

  totalIn = computed(() => totalIncome(this.filtered(), this.rules()));
  totalOut = computed(() => totalExpenses(this.filtered(), this.rules()));
  netFlow = computed(() => Math.round((this.totalIn() - this.totalOut()) * 100) / 100);
  avgPerMonth = computed(() => {
    const n = this.months().length || 1;
    return Math.round((this.netFlow() / n) * 100) / 100;
  });

  transfers = computed(() => transferTotals(this.filtered()));

  private catName(id: string): string {
    if (id === '__none__') return 'Uncategorized';
    return this.categoryService.categories().find(c => c.id === id)?.name ?? 'Unknown';
  }

  /**
   * Category rows for the current report, capped at eight named slots with the
   * tail folded into "Other".
   *
   * Eight is the depth of the validated colour ramp — a ninth slice would need a
   * hue that has not been checked for colour-blind separation, so the tail is
   * pooled instead.
   */
  private MAX_SLICES = 8;

  categoryRows = computed(() => {
    const raw = this.report() === 'income'
      ? incomeTotals(this.filtered(), this.rules())
      : categoryTotals(this.filtered(), this.rules());
    const total = raw.reduce((s, r) => s + r.amount, 0);
    const palette = categoryPalette();

    const head = raw.slice(0, this.MAX_SLICES).map((r, i) => ({
      name: this.catName(r.categoryId),
      amount: r.amount,
      color: palette[i],
      pct: total > 0 ? Math.round((r.amount / total) * 1000) / 10 : 0,
    }));

    const tail = raw.slice(this.MAX_SLICES);
    if (tail.length) {
      const amount = Math.round(tail.reduce((s, r) => s + r.amount, 0) * 100) / 100;
      head.push({
        name: `Other (${tail.length})`,
        amount,
        color: otherColor(),
        pct: total > 0 ? Math.round((amount / total) * 1000) / 10 : 0,
      });
    }
    return head;
  });

  /** Income sources feeding the Sankey's pool node. */
  private incomeRows = computed(() => {
    const raw = incomeTotals(this.filtered(), this.rules());
    return raw.slice(0, this.MAX_SLICES)
      .map(r => ({ name: this.catName(r.categoryId), amount: r.amount }));
  });

  hasData = computed(() =>
    this.report() === 'transfers'
      ? this.transfers().count > 0
      : this.totalIn() > 0 || this.totalOut() > 0);

  // ── Formatting ─────────────────────────────────────────────
  money(n: number): string {
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });
  }
  moneyShort(n: number): string {
    const a = Math.abs(n);
    if (a >= 1000) return `${n < 0 ? '-' : ''}$${Math.round(a / 100) / 10}k`;
    return `${n < 0 ? '-' : ''}$${Math.round(a)}`;
  }
  signed(n: number): string {
    return `${n >= 0 ? '+' : '−'}${this.money(Math.abs(n))}`;
  }

  // ── Charts ─────────────────────────────────────────────────
  constructor() {
    // Rebuild whenever the data, the selected view, or the theme changes.
    // Chart.js resolves colours at construction, so a theme switch needs a
    // fresh chart rather than an update.
    effect(() => {
      this.report(); this.view(); this.themeService.theme();
      this.monthRows(); this.categoryRows(); this.transfers();
      queueMicrotask(() => this.rebuild());
    });
  }

  ngAfterViewInit() { this.rebuild(); }
  ngOnDestroy() { this.chart?.destroy(); }

  private rebuild() {
    this.chart?.destroy();
    this.chart = null;
    const ctx = this.chartCanvas?.nativeElement?.getContext('2d');
    if (!ctx || !this.hasData()) return;

    const c = chartColors();
    const common = {
      responsive: true,
      maintainAspectRatio: false,
      // A legend is always present for two or more series, so identity is never
      // carried by colour alone.
      plugins: { legend: { display: false } as any },
    };
    const money = (v: unknown) => this.money(v as number);

    const axes = {
      x: { stacked: false, grid: { display: false }, border: { display: false },
           ticks: { color: c.tick, font: { size: 11 } } },
      y: { stacked: false, grid: { color: c.grid }, border: { display: false },
           ticks: { color: c.tick, font: { size: 11 },
                    callback: (v: unknown) => this.moneyShort(v as number) } },
    };

    const rows = this.monthRows();
    const view = this.view();

    if (this.report() === 'cash-flow' && view === 'sankey') {
      this.chart = this.buildSankey(ctx, c);
      return;
    }

    if (this.report() === 'expenses' && view === 'donut') {
      const rowsC = this.categoryRows();
      this.chart = new Chart(ctx, {
        type: 'doughnut',
        data: {
          labels: rowsC.map(r => r.name),
          datasets: [{
            data: rowsC.map(r => r.amount),
            backgroundColor: rowsC.map(r => r.color),
            // A 2px surface ring keeps adjacent slices from bleeding together.
            borderColor: c.surface, borderWidth: 2, hoverOffset: 6,
          }],
        },
        options: {
          ...common, cutout: '68%',
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: x => ` ${x.label}: ${money(x.raw)}` } },
          },
        },
      });
      return;
    }

    if (this.report() === 'transfers') {
      const t = this.transfers();
      this.chart = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: ['Moved in', 'Moved out'],
          datasets: [{
            data: [t.movedIn, t.movedOut],
            backgroundColor: [c.positive, c.accent],
            borderRadius: 4, barPercentage: 0.5, categoryPercentage: 0.6,
          }],
        },
        options: {
          ...common,
          plugins: {
            legend: { display: false },
            tooltip: { callbacks: { label: x => ` ${money(x.raw)}` } },
          },
          scales: axes as any,
        },
      });
      return;
    }

    // Cash flow (stacked / grouped) and Income share the bar shape.
    const stacked = view === 'stacked';
    const datasets = this.report() === 'income'
      ? [{ label: 'Income', data: rows.map(r => r.income), backgroundColor: c.positive,
           borderRadius: 4, barPercentage: 0.55, categoryPercentage: 0.7 }]
      : [
          { label: 'Income', data: rows.map(r => r.income), backgroundColor: c.positive,
            borderRadius: 4, barPercentage: stacked ? 0.6 : 0.55, categoryPercentage: 0.7 },
          { label: 'Spending', data: rows.map(r => r.expenses), backgroundColor: c.accent,
            borderRadius: 4, barPercentage: stacked ? 0.6 : 0.55, categoryPercentage: 0.7 },
        ];

    this.chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: rows.map(r => r.label), datasets },
      options: {
        ...common,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: x => ` ${x.dataset.label}: ${money(x.raw)}` } },
        },
        scales: {
          x: { ...axes.x, stacked },
          y: { ...axes.y, stacked },
        } as any,
      },
    });
  }

  private buildSankey(ctx: CanvasRenderingContext2D, c: ReturnType<typeof chartColors>) {
    const sources = this.incomeRows();
    const cats = this.categoryRows().map(r => ({ name: r.name, amount: r.amount }));
    const links = sankeyLinks(sources, cats);

    // Colour the nodes: income sources share the positive hue, the pool is
    // neutral, and each spending category keeps its ramp slot so the Sankey and
    // the donut agree on what colour a category is.
    const colours = new Map<string, string>();
    for (const s of sources) colours.set(s.name, c.positive);
    colours.set('Cash flow', c.tick);
    for (const r of this.categoryRows()) colours.set(`${r.name}​`, r.color);
    const nodeColour = (key: string) => colours.get(key) ?? c.tick;

    return new Chart(ctx, {
      type: 'sankey' as any,
      data: {
        datasets: [{
          data: links,
          colorFrom: (x: any) => nodeColour(x.raw.from),
          colorTo: (x: any) => nodeColour(x.raw.to),
          colorMode: 'gradient',
          alpha: 0.55,
          borderWidth: 0,
          labels: Object.fromEntries(
            [...colours.keys()].map(k => [k, sankeyLabel(k)])
          ),
          font: { size: 11 },
          // Node labels sit on top of the coloured ribbons, so they take
          // full-strength ink rather than the muted tick colour.
          color: c.ink,
        } as any],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (x: any) =>
                ` ${sankeyLabel(x.raw.from)} → ${sankeyLabel(x.raw.to)}: ${this.money(x.raw.flow)}`,
            },
          },
        },
      } as any,
    });
  }

  /** Legend entries for the current chart — never colour alone. */
  legend = computed(() => {
    const c = chartColors();
    switch (this.report()) {
      case 'cash-flow':
        return this.view() === 'sankey'
          ? [] // the Sankey labels its own nodes
          : [{ label: 'Income', color: c.positive }, { label: 'Spending', color: c.accent }];
      case 'income':
        return [];
      case 'transfers':
        return [{ label: 'Moved in', color: c.positive }, { label: 'Moved out', color: c.accent }];
      default:
        return this.view() === 'donut' ? [] : [{ label: 'Spending', color: c.accent }];
    }
  });

  showCategoryTable = computed(() =>
    this.report() === 'expenses' || this.report() === 'income' ||
    (this.report() === 'cash-flow' && this.view() === 'sankey'));
}
