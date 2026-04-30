import {
  Component, inject, signal, computed,
  AfterViewInit, ViewChild, ElementRef, effect, OnDestroy
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { Transaction } from '../../models';
import {
  Chart, ChartData, ChartOptions,
  ArcElement, DoughnutController,
  BarElement, BarController,
  CategoryScale, LinearScale,
  Tooltip, Legend
} from 'chart.js';

Chart.register(
  ArcElement, DoughnutController,
  BarElement, BarController,
  CategoryScale, LinearScale,
  Tooltip, Legend
);

type RangeKey = 'this-month' | 'last-month' | '3-months' | 'this-year' | 'all';

@Component({
  selector: 'app-analysis',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './analysis.html',
  styleUrl: './analysis.scss'
})
export class Analysis implements AfterViewInit, OnDestroy {
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);
  private categoryService = inject(CategoryService);

  @ViewChild('donutCanvas') donutCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('barCanvas') barCanvas!: ElementRef<HTMLCanvasElement>;

  private donutChart: Chart | null = null;
  private barChart: Chart | null = null;
  private chartsReady = false;

  // ── Filters ────────────────────────────────────────────────
  range = signal<RangeKey>('this-month');
  filterAccountId = signal('');
  excludeRefunded = signal(true);
  excludedCategories = signal<Set<string>>(new Set());

  ranges: { value: RangeKey; label: string }[] = [
    { value: 'this-month',  label: 'This month' },
    { value: 'last-month',  label: 'Last month' },
    { value: '3-months',    label: 'Last 3 months' },
    { value: 'this-year',   label: 'This year' },
    { value: 'all',         label: 'All time' },
  ];

  showCategoryFilter = signal(false);

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
        return {
          start: localDate(y, m, 1),
          end:   localDate(y, m, lastDay(y, m))
        };
      case 'last-month':
        return {
          start: localDate(y, m - 1, 1),
          end:   localDate(y, m - 1, lastDay(y, m - 1))
        };
      case '3-months':
        return {
          start: localDate(y, m - 2, 1),
          end:   localDate(y, m, lastDay(y, m))
        };
      case 'this-year':
        return { start: `${y}-01-01`, end: `${y}-12-31` };
      default:
        return { start: '', end: '' };
    }
  });

  // ── Filtered transactions ──────────────────────────────────
  filtered = computed(() => {
    const { start, end } = this.dateRange();
    const accountId = this.filterAccountId();
    const excludeRef = this.excludeRefunded();
    const excluded = this.excludedCategories();

    return this.txService.transactions().filter(t => {
      if (start && t.date < start) return false;
      if (end && t.date > end) return false;
      if (accountId && t.accountId !== accountId) return false;
      if (excludeRef && t.refunded) return false;
      if (t.categoryId && excluded.has(t.categoryId)) return false;
      return true;
    });
  });

  expenses = computed(() =>
    this.filtered().filter(t => t.type === 'expense')
  );

  income = computed(() =>
    this.filtered().filter(t => t.type === 'income')
  );

  // ── KPIs ───────────────────────────────────────────────────
  totalExpenses = computed(() =>
    Math.round(this.expenses().reduce((s, t) => s + t.amount, 0) * 100) / 100
  );

  totalIncome = computed(() =>
    Math.round(this.income().reduce((s, t) => s + t.amount, 0) * 100) / 100
  );

  avgMonthlySpend = computed(() => {
    const txs = this.expenses();
    if (!txs.length) return 0;
    const months = new Set(txs.map(t => t.date.slice(0, 7))).size || 1;
    return Math.round((this.totalExpenses() / months) * 100) / 100;
  });

  savingsRate = computed(() => {
    const inc = this.totalIncome();
    if (!inc) return null;
    return Math.round(((inc - this.totalExpenses()) / inc) * 100);
  });

  topCategory = computed(() => {
    const byCat = new Map<string, number>();
    for (const t of this.expenses()) {
      if (!t.categoryId) continue;
      byCat.set(t.categoryId, (byCat.get(t.categoryId) || 0) + t.amount);
    }
    if (!byCat.size) return null;
    const [id, amount] = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    const cat = this.categoryService.categories().find(c => c.id === id);
    return cat ? { name: cat.name, icon: cat.icon, amount } : null;
  });

  largestExpense = computed(() => {
    const txs = this.expenses();
    if (!txs.length) return null;
    return txs.reduce((max, t) => t.amount > max.amount ? t : max, txs[0]);
  });

  // ── Spending by category ───────────────────────────────────
  categoryBreakdown = computed(() => {
    const byCat = new Map<string, number>();
    const total = this.totalExpenses();

    for (const t of this.expenses()) {
      const key = t.categoryId || '__none__';
      byCat.set(key, (byCat.get(key) || 0) + t.amount);
    }

    return [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([id, amount]) => {
        const cat = id === '__none__'
          ? { name: 'Uncategorized', icon: '📦', color: '#9ca3af' }
          : this.categoryService.categories().find(c => c.id === id);
        return {
          id,
          name: cat?.name || 'Unknown',
          icon: (cat as any)?.icon || '📦',
          color: (cat as any)?.color || '#6366f1',
          amount: Math.round(amount * 100) / 100,
          pct: total > 0 ? Math.round((amount / total) * 100) : 0
        };
      });
  });

  // ── Top merchants ──────────────────────────────────────────
  topMerchants = computed(() => {
    const byMerchant = new Map<string, { amount: number; count: number }>();
    for (const t of this.expenses()) {
      const key = t.merchant || 'Unknown';
      const existing = byMerchant.get(key) || { amount: 0, count: 0 };
      byMerchant.set(key, {
        amount: existing.amount + t.amount,
        count: existing.count + 1
      });
    }
    return [...byMerchant.entries()]
      .sort((a, b) => b[1].amount - a[1].amount)
      .slice(0, 10)
      .map(([name, data], i) => ({
        rank: i + 1,
        name,
        amount: Math.round(data.amount * 100) / 100,
        count: data.count
      }));
  });

  // ── Monthly trend data (for bar chart) ────────────────────
  monthlyTrend = computed(() => {
    const now = new Date();
    const months = new Map<string, { income: number; expenses: number }>();

    let numMonths = 6;
    if (this.range() === 'this-year') numMonths = 12;
    if (this.range() === 'all') numMonths = 12;

    for (let i = numMonths - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      // Use local year/month instead of toISOString() which shifts to UTC
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const key = `${y}-${m}`;
      months.set(key, { income: 0, expenses: 0 });
    }

    for (const t of this.txService.transactions()) {
      const key = t.date.slice(0, 7);
      if (!months.has(key)) continue;
      const entry = months.get(key)!;
      if (t.type === 'income') entry.income += t.amount;
      if (t.type === 'expense' && !t.refunded) entry.expenses += t.amount;
    }

    return [...months.entries()].map(([month, data]) => {
      const [y, m] = month.split('-').map(Number);
      const label = new Date(y, m - 1, 1)
        .toLocaleDateString('en-US', { month: 'short' });
      return {
        month,
        label,
        income: Math.round(data.income * 100) / 100,
        expenses: Math.round(data.expenses * 100) / 100,
      };
    });
  });

  // ── All expense categories for exclusion filter ────────────
  allExpenseCategories = computed(() =>
    this.categoryService.categories().filter(c => c.kind === 'expense')
  );

  toggleCategoryExclusion(categoryId: string) {
    const current = new Set(this.excludedCategories());
    if (current.has(categoryId)) {
      current.delete(categoryId);
    } else {
      current.add(categoryId);
    }
    this.excludedCategories.set(current);
  }

  isCategoryExcluded(categoryId: string): boolean {
    return this.excludedCategories().has(categoryId);
  }

  // ── Format helpers ─────────────────────────────────────────
  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  formatCurrencyShort(n: number): string {
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }

  accountName(id?: string): string {
    if (!id) return '';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? `${a.icon} ${a.name}` : '';
  }

  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  // ── Charts ─────────────────────────────────────────────────
  constructor() {
    effect(() => {
      // React to data changes and update charts
      const catData = this.categoryBreakdown();
      const trendData = this.monthlyTrend();
      if (this.chartsReady) {
        this.updateDonut(catData);
        this.updateBar(trendData);
      }
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
          borderColor: 'transparent',
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
            // Position tooltip outside the chart
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

    this.barChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Income',
            data: data.map(d => d.income),
            backgroundColor: 'rgba(128, 128, 128, 0.5)', // neutral grey works in both modes
            borderColor: 'rgba(128, 128, 128, 0.8)',
            borderWidth: 1,
            borderRadius: 4,
            barPercentage: 0.55,
            categoryPercentage: 0.7,
          },
          {
            label: 'Spending',
            data: data.map(d => d.expenses),
            backgroundColor: '#00D64F',
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
              label: (ctx) =>
                ` ${ctx.dataset.label}: ${this.formatCurrency(ctx.raw as number)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#8A8A92', font: { size: 11 } }
          },
          y: {
            grid: { color: 'rgba(128,128,128,0.1)' },
            border: { display: false },
            ticks: {
              color: '#8A8A92',
              font: { size: 11 },
              callback: (val) => this.formatCurrencyShort(val as number)
            }
          }
        }
      }
    });
  }

  private updateDonut(data: typeof this.categoryBreakdown extends () => infer R ? R : never) {
    if (!this.donutChart) return;
    this.donutChart.data.labels = data.map(d => d.name);
    this.donutChart.data.datasets[0].data = data.map(d => d.amount);
    (this.donutChart.data.datasets[0] as any).backgroundColor = data.map(d => d.color);
    this.donutChart.update('none');
  }

  private updateBar(data: typeof this.monthlyTrend extends () => infer R ? R : never) {
    if (!this.barChart) return;
    this.barChart.data.labels = data.map(d => d.label);
    this.barChart.data.datasets[0].data = data.map(d => d.income);
    this.barChart.data.datasets[1].data = data.map(d => d.expenses);
    this.barChart.update('none');
  }
}