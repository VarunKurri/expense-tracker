import { Component, inject, signal, computed, AfterViewInit, ViewChild, ElementRef, OnDestroy, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { CategoryService } from '../../services/category.service';
import { BillService } from '../../services/bill.service';
import { BudgetService } from '../../services/budget.service';
import { QuickAddService } from '../../services/quick-add.service';
import { Account } from '../../models';
import {
  Chart, ArcElement, DoughnutController,
  CategoryScale, LinearScale, BarElement, BarController,
  LineController, LineElement, PointElement, Filler,
  Tooltip, Legend
} from 'chart.js';

Chart.register(
  ArcElement, DoughnutController,
  CategoryScale, LinearScale, BarElement, BarController,
  LineController, LineElement, PointElement, Filler,
  Tooltip, Legend
);

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
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

  @ViewChild('miniDonutCanvas') miniDonutCanvas!: ElementRef<HTMLCanvasElement>;
  private miniDonut: Chart | null = null;
  private chartsReady = false;

  @ViewChild('cashFlowCanvas') cashFlowCanvas!: ElementRef<HTMLCanvasElement>;
  private cashFlowChart: Chart | null = null;

  activeRange = signal<'7D' | '30D' | '90D' | 'YTD'>('30D');

  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  balanceFor(account: Account): number {
    const txDelta = this.txService.balanceForAccount(account.id!);
    let balance: number;
    if (account.type === 'credit') {
      balance = account.openingBalance - txDelta;
    } else {
      balance = (account.openingBalance || 0) + txDelta;
    }
    return Math.round(balance * 100) / 100;
  }

  netWorth = computed(() => {
    let assets = 0;
    let liabilities = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit') {
        if (bal > 0) liabilities += bal;
        else assets += Math.abs(bal);
      } else {
        if (bal >= 0) assets += bal;
        else liabilities += Math.abs(bal);
      }
    }
    return Math.round((assets - liabilities) * 100) / 100;
  });

  netWorthChange = computed(() => {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const cutoff = thirtyDaysAgo.toISOString().slice(0, 10);
    const recentNet = this.txService.transactions()
      .filter(t => t.date >= cutoff)
      .reduce((s, t) => {
        if (t.type === 'income') return s + t.amount;
        if (t.type === 'expense') return s - t.amount;
        return s;
      }, 0);
    return Math.round(recentNet * 100) / 100;
  });

  cashFlowData = computed(() => {
    // Last 30 days, grouped by day
    const days: { date: string; label: string; income: number; expenses: number }[] = [];
    const now = new Date();

    for (let i = 29; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      const date = `${y}-${m}-${day}`;
      const label = i % 7 === 0 || i === 0
        ? d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '';
      days.push({ date, label, income: 0, expenses: 0 });
    }

    for (const t of this.txService.transactions()) {
      const entry = days.find(d => d.date === t.date);
      if (!entry) continue;
      if (t.type === 'income') entry.income += t.amount;
      if (t.type === 'expense') entry.expenses += t.amount;
    }

    return days;
  });

  cashFlowNet = computed(() => {
    return Math.round(this.cashFlowData()
      .reduce((s, d) => s + d.income - d.expenses, 0) * 100) / 100;
  });

  cashFlowIncome = computed(() =>
    Math.round(this.cashFlowData().reduce((s, d) => s + d.income, 0) * 100) / 100
  );

  cashFlowExpenses = computed(() =>
    Math.round(this.cashFlowData().reduce((s, d) => s + d.expenses, 0) * 100) / 100
  );

  private rangeStart = computed((): string => {
    const now = new Date();
    const y = now.getFullYear();
    const m = now.getMonth();
    switch (this.activeRange()) {
      case '7D': {
        const d = new Date(now);
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      }
      case '30D': {
        const d = new Date(now);
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      }
      case '90D': {
        const d = new Date(now);
        d.setDate(d.getDate() - 90);
        return d.toISOString().slice(0, 10);
      }
      case 'YTD': return `${y}-01-01`;
    }
  });

  rangeIncome = computed(() => {
    const start = this.rangeStart();
    return this.txService.transactions()
      .filter(t => t.type === 'income' && t.date >= start)
      .reduce((s, t) => s + t.amount, 0);
  });

  rangeExpenses = computed(() => {
    const start = this.rangeStart();
    return this.txService.transactions()
      .filter(t => t.type === 'expense' && t.date >= start)
      .reduce((s, t) => s + t.amount, 0);
  });

  savingsRate = computed(() => {
    const income = this.rangeIncome();
    if (!income) return null;
    return Math.round(((income - this.rangeExpenses()) / income) * 100);
  });

  // Recent transactions — last 8
  recentTransactions = computed(() =>
    this.txService.transactions().slice(0, 8)
  );

  // Category for a transaction
  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id);
  }

  accountName(id?: string): string {
    if (!id) return '';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? a.name : '';
  }

  // Time ago helper
  timeAgo(date: string): string {
    const now = new Date();
    const d = new Date(date + 'T00:00:00');
    const diff = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${diff}d ago`;
  }

  // Upcoming bills (next 7 days)
  upcomingBills = computed(() => this.billService.upcomingBills(7));

  daysUntil(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(date + 'T00:00:00');
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  // Budget summary for current month
  currentMonth = new Date().toISOString().slice(0, 7);

  budgetSummary = computed(() => {
    const month = this.currentMonth;
    const defaults = this.budgetService.defaultBudgets();

    return defaults.map(budget => {
      const effective = this.budgetService.getBudgetForCategory(budget.categoryId, month);
      if (!effective) return null;
      const cat = this.categoryService.categories().find(c => c.id === budget.categoryId);
      const spent = this.txService.transactions()
        .filter(t => t.type === 'expense' && t.categoryId === budget.categoryId && t.date.startsWith(month))
        .reduce((s, t) => s + t.amount, 0);
      const pct = effective.amount > 0 ? Math.round((spent / effective.amount) * 100) : 0;
      return {
        name: cat?.name || 'Unknown',
        icon: cat?.icon || '📦',
        spent: Math.round(spent * 100) / 100,
        budget: effective.amount,
        pct,
        status: pct >= 100 ? 'over' : pct >= 75 ? 'warn' : 'ok'
      };
    })
    .filter(Boolean)
    // Sort by % used descending — most critical first
    .sort((a, b) => b!.pct - a!.pct)
    // Show top 4
    .slice(0, 4);
  });

  // Mini donut — spending by category this month
  thisMonthExpenses = computed(() => {
    const month = new Date().toISOString().slice(0, 7);
    return this.txService.transactions()
      .filter(t => t.type === 'expense' && t.date.startsWith(month) && !t.refunded);
  });

  thisMonthTotal = computed(() =>
    Math.round(this.thisMonthExpenses().reduce((s, t) => s + t.amount, 0) * 100) / 100
  );

  categoryBreakdown = computed(() => {
    const byCat = new Map<string, number>();
    for (const t of this.thisMonthExpenses()) {
      const key = t.categoryId || '__none__';
      byCat.set(key, (byCat.get(key) || 0) + t.amount);
    }
    const total = this.thisMonthTotal();
    return [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
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

  // Format helpers
  formatWhole(n: number): string {
    const rounded = Math.round(Math.abs(n) * 100) / 100;
    return Math.floor(rounded).toLocaleString('en-US');
  }

  formatCents(n: number): string {
    const rounded = Math.round(Math.abs(n) * 100) / 100;
    const cents = Math.round((rounded % 1) * 100);
    return cents.toString().padStart(2, '0');
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  formatCurrencyShort(n: number): string {
    if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
    return '$' + Math.round(n);
  }

  isNegative(n: number): boolean { return n < 0; }
  navigate(path: string) { this.router.navigate([path]); }

  setRange(r: string) {
    this.activeRange.set(r as '7D' | '30D' | '90D' | 'YTD');
  }

  addMoney() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() =>
        setTimeout(() => this.quickAddService.trigger('income'), 150)
      );
    } else {
      this.quickAddService.trigger('income');
    }
  }

  addExpense() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() =>
        setTimeout(() => this.quickAddService.trigger('expense'), 150)
      );
    } else {
      this.quickAddService.trigger('expense');
    }
  }

  // Mini donut chart
  constructor() {
    effect(() => {
      const donutData = this.categoryBreakdown();
      const flowData = this.cashFlowData();
      if (this.chartsReady) {
        this.updateMiniDonut(donutData);
        this.updateCashFlow(flowData);
      }
    });
  }

  ngAfterViewInit() {
    setTimeout(() => {
      this.initMiniDonut();
      this.initCashFlow();
      this.chartsReady = true;
    }, 200);
  }

  ngOnDestroy() {
    this.miniDonut?.destroy();
    this.cashFlowChart?.destroy();
  }

  private initCashFlow() {
    const ctx = this.cashFlowCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;
    const data = this.cashFlowData();

    this.cashFlowChart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: data.map(d => d.label),
        datasets: [
          {
            label: 'Income',
            data: data.map(d => d.income),
            backgroundColor: 'rgba(128,128,128,0.5)',
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.6,
          },
          {
            label: 'Spending',
            data: data.map(d => d.expenses),
            backgroundColor: '#00D64F',
            borderRadius: 3,
            barPercentage: 0.6,
            categoryPercentage: 0.6,
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
              title: (items) => {
                const idx = items[0].dataIndex;
                return data[idx].date;
              },
              label: (ctx) =>
                ` ${ctx.dataset.label}: ${this.formatCurrency(ctx.raw as number)}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: { color: '#8A8A92', font: { size: 10 }, maxRotation: 0 }
          },
          y: {
            grid: { color: 'rgba(128,128,128,0.1)' },
            border: { display: false },
            ticks: {
              color: '#8A8A92',
              font: { size: 10 },
              callback: (val) => this.formatCurrencyShort(val as number)
            }
          }
        }
      }
    });
  }

  private updateCashFlow(data: any[]) {
    if (!this.cashFlowChart) return;
    this.cashFlowChart.data.labels = data.map(d => d.label);
    this.cashFlowChart.data.datasets[0].data = data.map(d => d.income);
    this.cashFlowChart.data.datasets[1].data = data.map(d => d.expenses);
    this.cashFlowChart.update('none');
  }

  private initMiniDonut() {
    const ctx = this.miniDonutCanvas?.nativeElement?.getContext('2d');
    if (!ctx) return;
    const data = this.categoryBreakdown();
    this.miniDonut = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: data.map(d => d.name),
        datasets: [{
          data: data.map(d => d.amount),
          backgroundColor: data.map(d => d.color),
          borderWidth: 2,
          borderColor: 'transparent',
          hoverOffset: 4,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.label}: ${this.formatCurrency(ctx.raw as number)}`
            }
          }
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