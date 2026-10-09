import {
  Component, ElementRef, OnDestroy, ViewChild, computed, effect, inject, signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import {
  CategoryScale, Chart, Filler, LineController, LineElement, LinearScale, PointElement, Tooltip,
} from 'chart.js';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { BillService } from '../../services/bill.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { ThemeService } from '../../services/theme.service';
import { CategoryService } from '../../services/category.service';
import { ForecastItem, ForecastMonth, cashOn, forecast, pastMonths, projectNetWorth } from '../../utils/forecast';
import { composition, holdingsOn } from '../../utils/net-worth';
import { MoneyRules } from '../../utils/reporting';
import { localDateString, parseLocalDate } from '../../utils/date';
import { categoryPalette, chartColors, otherColor } from '../../utils/theme-colors';

Chart.register(LineController, LineElement, PointElement, Filler, CategoryScale, LinearScale, Tooltip);

type Span = 3 | 6 | 12;
const EXCLUDED_KEY = 'trackr.forecast.excluded';

interface ChartPoint { date: string; cash: number; projected: boolean }

/**
 * Forecast: where your cash is heading if the coming months look like the
 * last few. Known money (bills on their dates, loan payments) plus typical
 * money (average income and everyday spending), month by month. The maths is
 * in utils/forecast.ts; this page only shows it and says what it assumes.
 */
@Component({
  selector: 'app-forecast',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './forecast.html',
  styleUrl: './forecast.scss',
})
export class Forecast implements OnDestroy {
  private accountService = inject(AccountService);
  private txService = inject(TransactionService);
  private billService = inject(BillService);
  private manualService = inject(ManualAssetService);
  private themeService = inject(ThemeService);
  private categoryService = inject(CategoryService);
  private router = inject(Router);

  readonly today = localDateString();
  readonly spans: Span[] = [3, 6, 12];

  /** How far ahead, in whole months after this one. */
  ahead = signal<Span>(6);
  /** How many past months the averages use. */
  basedOn = signal<Span>(3);
  /** Past months left out of the averages (a one-off laptop month). Kept on this device. */
  excluded = signal<string[]>(this.loadExcluded());
  /** The month whose detail is open in the table. */
  openMonth = signal<string | null>(null);
  hoverIndex = signal<number | null>(null);

  private rules: MoneyRules = this.txService.moneyRules(true);

  private txs = computed(() => this.txService.transactions());

  f = computed(() => forecast({
    accounts: this.accountService.accounts(),
    manual: this.manualService.items(),
    bills: this.billService.bills(),
    txs: this.txs(),
    rules: this.rules,
    today: this.today,
    horizon: this.ahead() + 1,   // the rest of this month, then whole months
    baseMonths: this.basedOn(),
    excluded: this.excluded(),
  }));

  /** Where net worth is heading by the same date. */
  netWorthAhead = computed(() => {
    const manual = this.manualService.items();
    const now = composition(holdingsOn(this.accountService.accounts(), manual, this.txs(), this.today)).net;
    const points = projectNetWorth(this.f(), now, manual, this.txs(), this.today);
    const last = points[points.length - 1];
    return last ? { now, then: last.net, date: last.date } : null;
  });

  /** Cash at the last six month-ends, today, then the forecast month-ends. */
  points = computed<ChartPoint[]>(() => {
    const accounts = this.accountService.accounts(), txs = this.txs();
    const past = pastMonths(this.today, 6).map(m => {
      const [y, mo] = m.split('-').map(Number);
      const end = localDateString(new Date(y, mo, 0));
      return { date: end, cash: cashOn(accounts, txs, end), projected: false };
    });
    const f = this.f();
    return [
      ...past,
      { date: this.today, cash: f.startCash, projected: false },
      ...f.months.map(m => ({ date: m.end, cash: m.cash, projected: true })),
    ];
  });

  /** The figure in the hero: the end of the window, or the point under the cursor. */
  shown = computed(() => {
    const i = this.hoverIndex(), p = this.points();
    if (i !== null && p[i]) return p[i];
    const f = this.f();
    return { date: f.months[f.months.length - 1]?.end ?? this.today, cash: f.endCash, projected: true };
  });

  eyebrow = computed(() => {
    const s = this.shown();
    if (s.date === this.today) return 'Cash today';
    return s.projected ? `Cash by ${this.formatDate(s.date)}` : `Cash on ${this.formatDate(s.date)}`;
  });

  /** The plain sentence under the figure: the pace, the biggest cost ahead, any dip below zero. */
  sentence = computed(() => {
    const f = this.f();
    const parts: string[] = [];
    const pace = f.monthlyNet;
    parts.push(pace >= 0
      ? `At your recent pace you put away about ${this.money(pace)} a month.`
      : `At your recent pace about ${this.money(pace)} more goes out than comes in each month.`);
    if (f.biggest) {
      parts.push(`${f.biggest.name} (${this.money(f.biggest.amount)}) ${f.biggest.overdue ? 'is overdue and' : 'on ' + this.formatShortDate(f.biggest.date)} is the biggest single cost ahead.`);
    }
    const low = f.months.find(m => m.cash < 0);
    if (low) parts.push(`Cash dips below zero in ${this.monthLong(low.month)}.`);
    return parts.join(' ');
  });

  /** Known payments in the next 30 days, soonest first. */
  comingUp = computed(() => {
    const until = this.plusDays(this.today, 30);
    return this.f().months.flatMap(m => m.items).filter(it => it.date <= until);
  });

  // ── Everyday spending, by category ─────────────────────────
  showAllCategories = signal(false);

  /**
   * What the everyday figure is made of: each category's monthly average,
   * less the bills that file under it. Eight hues is all the palette has, so
   * the colours stop at eight and the rest share the neutral.
   */
  everydayRows = computed(() => {
    const b = this.f().basis;
    const palette = categoryPalette();
    const total = b.categories.reduce((s, c) => s + c.everyday, 0);
    const rows = b.categories.map((c, i) => {
      const cat = c.categoryId === '__none__' ? null : this.categoryService.categories().find(x => x.id === c.categoryId);
      // Only worth a line when bills were taken out; otherwise it would repeat the figure.
      let sub = '';
      if (c.bills > 0) {
        const names = c.billNames.length > 2 ? `${c.billNames.slice(0, 2).join(', ')} +${c.billNames.length - 2}` : c.billNames.join(', ');
        sub = c.everyday > 0
          ? `${this.money(c.spent)} spent, less ${this.money(c.bills)} in bills (${names})`
          : `All bills (${names}), forecast on their dates`;
      }
      return {
        id: c.categoryId,
        name: cat?.name ?? 'Uncategorised',
        icon: cat?.icon ?? '📦',
        color: i < palette.length ? palette[i] : otherColor(),
        amount: c.everyday,
        share: total > 0 ? c.everyday / total : 0,
        sub,
      };
    });
    return this.showAllCategories() ? rows : rows.slice(0, 8);
  });

  /** "Groceries is the biggest part, at $520 (37%)." The total sits right above, so it is not repeated. */
  everydaySentence = computed(() => {
    const b = this.f().basis;
    const top = b.categories.find(c => c.everyday > 0);
    const hint = 'Click a category to see its transactions over these months.';
    if (!top) return hint;
    const name = top.categoryId === '__none__'
      ? 'Uncategorised spending'
      : this.categoryService.categories().find(c => c.id === top.categoryId)?.name ?? 'Uncategorised spending';
    const pct = b.everyday > 0 ? Math.round((top.everyday / b.everyday) * 100) : 0;
    return `${name} is the biggest part, at ${this.money(top.everyday)} (${pct}%). ${hint}`;
  });

  /** The category's transactions over the months the average is based on. */
  openCategory(categoryId: string) {
    const used = this.f().basis.months.filter(m => m.included);
    if (!used.length) return;
    const [y, m] = used[used.length - 1].month.split('-').map(Number);
    this.router.navigate(['/transactions'], {
      queryParams: {
        view: 'analysis', start: `${used[0].month}-01`, end: localDateString(new Date(y, m, 0)), excludeRefunded: true,
        ...(categoryId !== '__none__' ? { categoryId } : {}),
      },
    });
  }

  // ── Basis ──────────────────────────────────────────────────
  setAhead(s: Span) { this.hoverIndex.set(null); this.ahead.set(s); }
  setBasedOn(s: Span) { this.basedOn.set(s); }

  toggleMonth(month: string) {
    const ex = this.excluded();
    const next = ex.includes(month) ? ex.filter(m => m !== month) : [...ex, month];
    this.excluded.set(next);
    try { localStorage.setItem(EXCLUDED_KEY, JSON.stringify(next)); } catch { /* private mode: fine, just not kept */ }
  }

  private loadExcluded(): string[] {
    try {
      const raw = localStorage.getItem(EXCLUDED_KEY);
      const v = raw ? JSON.parse(raw) : [];
      return Array.isArray(v) ? v.filter((x: unknown) => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  toggleOpen(m: ForecastMonth) { this.openMonth.set(this.openMonth() === m.month ? null : m.month); }

  // ── Chart ──────────────────────────────────────────────────
  private chart: Chart | null = null;
  private canvas?: ElementRef<HTMLCanvasElement>;

  @ViewChild('chartCanvas') set chartCanvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvas = ref;
    if (!ref) { this.chart?.destroy(); this.chart = null; }
    else if (!this.chart) this.buildChart();
  }

  constructor() {
    effect(() => {
      const p = this.points();
      if (!this.chart) return;
      this.chart.data.labels = p.map(x => x.date);
      this.chart.data.datasets[0].data = this.actualData(p);
      this.chart.data.datasets[1].data = this.projectedData(p);
      this.chart.update('none');
    });
    effect(() => {
      this.themeService.theme();
      if (!this.canvas) return;
      this.chart?.destroy();
      this.chart = null;
      queueMicrotask(() => this.buildChart());
    });
  }

  ngOnDestroy() { this.chart?.destroy(); }

  /** Actual cash up to today; nothing after. */
  private actualData(p: ChartPoint[]) { return p.map(x => (x.projected ? null : x.cash)); }
  /** The projection starts at today's point so the two lines meet. */
  private projectedData(p: ChartPoint[]) {
    return p.map(x => (x.projected || x.date === this.today ? x.cash : null));
  }

  private buildChart() {
    const canvas = this.canvas?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || this.chart) return;
    const c = chartColors();
    const p = this.points();

    // Forward-looking money gets the blue wash, so it never reads as actual.
    const fill = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    fill.addColorStop(0, c.accent + '38');
    fill.addColorStop(1, c.accent + '00');

    const todayRule = {
      id: 'todayRule',
      afterDatasetsDraw: (chart: Chart) => {
        const i = this.points().findIndex(x => x.date === this.today);
        const meta = chart.getDatasetMeta(0);
        const el = meta.data[i];
        if (!el) return;
        const { top, bottom } = chart.chartArea;
        const g = chart.ctx;
        g.save();
        g.beginPath();
        g.moveTo(el.x, top);
        g.lineTo(el.x, bottom);
        g.lineWidth = 1;
        g.strokeStyle = c.grid;
        g.stroke();
        g.fillStyle = c.tick;
        g.font = '10px "Roboto Mono", monospace';
        g.textAlign = 'center';
        // Along the bottom, where it can't sit on the line.
        g.fillText('TODAY', el.x, bottom - 6);
        g.restore();
      },
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: p.map(x => x.date),
        datasets: [
          {
            label: 'Cash',
            data: this.actualData(p),
            borderColor: c.ink,
            borderWidth: 2,
            fill: false,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: c.ink,
            pointHoverBorderColor: c.surface,
            pointHoverBorderWidth: 2,
            spanGaps: false,
          },
          {
            label: 'Projected',
            data: this.projectedData(p),
            borderColor: c.accent,
            backgroundColor: fill,
            borderWidth: 2,
            borderDash: [5, 4],
            fill: true,
            cubicInterpolationMode: 'monotone',
            pointRadius: 0,
            pointHoverRadius: 4,
            pointHoverBackgroundColor: c.accent,
            pointHoverBorderColor: c.surface,
            pointHoverBorderWidth: 2,
            spanGaps: false,
          },
        ],
      },
      plugins: [todayRule],
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        interaction: { mode: 'index', intersect: false },
        onHover: (_e, els) => this.hoverIndex.set(els.length ? els[0].index : null),
        plugins: {
          legend: { display: false },
          tooltip: {
            displayColors: false,
            filter: (item, i, all) => item.raw !== null && all.findIndex(x => x.raw !== null) === i,
            callbacks: {
              title: items => this.formatDate(String(items[0].label)),
              label: item => `${this.points()[item.dataIndex]?.projected ? 'Projected ' : ''}${this.signedMoney(item.raw as number)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: c.tick, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8,
              callback: (_v, i) => this.formatTick(String(this.points()[i]?.date ?? '')),
            },
          },
          y: {
            grid: { color: c.grid },
            border: { display: false },
            ticks: { color: c.tick, font: { size: 10 }, maxTicksLimit: 5, callback: v => this.formatShort(v as number) },
          },
        },
      },
    });
  }

  // ── Formatting ─────────────────────────────────────────────
  money(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Math.abs(n));
  }

  signedMoney(n: number): string {
    return `${n < 0 ? '−' : ''}${this.money(n)}`;
  }

  signed(n: number): string {
    if (Math.abs(n) < 0.5) return this.money(0);
    return `${n < 0 ? '−' : '+'}${this.money(n)}`;
  }

  formatDate(d: string): string {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  formatShortDate(d: string): string {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  monthLong(month: string): string {
    const [y, m] = month.split('-').map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }

  itemSub(it: ForecastItem): string {
    const what = it.kind === 'bill' ? 'Bill' : it.kind === 'loan-out' ? 'Loan payment' : 'Repayment to you';
    return it.overdue ? `${what} · overdue, counted now` : what;
  }

  private formatTick(d: string): string {
    if (!d) return '';
    // Today and this month's end would both read "Oct 26".
    if (d === this.today) return 'Today';
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
  }

  private formatShort(n: number): string {
    const a = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
    return `${sign}$${a.toFixed(0)}`;
  }

  private plusDays(d: string, n: number): string {
    const x = parseLocalDate(d); x.setDate(x.getDate() + n); return localDateString(x);
  }
}
