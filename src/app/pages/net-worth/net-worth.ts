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
import { ManualAssetService } from '../../services/manual-asset.service';
import { BillService } from '../../services/bill.service';
import { ThemeService } from '../../services/theme.service';
import { ToastService } from '../../services/toast.service';
import { ErrorBanner } from '../../components/error-banner/error-banner';
import { Confirm } from '../../components/confirm/confirm';
import { AssetForm, AssetFormSave } from './asset-form/asset-form';
import { countsInNetWorth, loanState } from '../../utils/loans';
import { Holding, RANGES, Range, changeOver, composition, earliestDate, holdingsOn, netWorthSeries, rangeDates } from '../../utils/net-worth';
import { forecast, projectNetWorth } from '../../utils/forecast';
import { localDateString, parseLocalDate } from '../../utils/date';
import { chartColors } from '../../utils/theme-colors';
import { ManualAsset } from '../../models';

Chart.register(LineController, LineElement, PointElement, Filler, CategoryScale, LinearScale, Tooltip);

const RANGE_WORDS: Record<Range, string> = {
  '1M': 'the past month',
  '3M': 'the past 3 months',
  '6M': 'the past 6 months',
  '1Y': 'the past year',
  'ALL': 'all time',
};

/**
 * Net worth — what you own minus what you owe, how it has moved, and what it
 * is made of. Accounts come from AccountService (balances rebuilt from
 * transactions, see utils/net-worth.ts); anything without a bank connection —
 * a home, a car, a loan — is a manual entry with dated valuations.
 */
@Component({
  selector: 'app-net-worth',
  standalone: true,
  imports: [CommonModule, RouterLink, ErrorBanner, Confirm, AssetForm],
  templateUrl: './net-worth.html',
  styleUrl: './net-worth.scss',
})
export class NetWorth implements OnDestroy {
  private accountService = inject(AccountService);
  private txService = inject(TransactionService);
  manualService = inject(ManualAssetService);
  private themeService = inject(ThemeService);
  private toast = inject(ToastService);
  private router = inject(Router);
  private billService = inject(BillService);

  readonly ranges = RANGES;
  readonly today = localDateString();

  range = signal<Range>('3M');
  /** Index of the chart point under the cursor; null shows today. */
  hoverIndex = signal<number | null>(null);

  // ── Data ───────────────────────────────────────────────────
  private accounts = computed(() => this.accountService.accounts());
  private manual = computed(() => this.manualService.items());
  private txs = computed(() => this.txService.transactions());

  /** Today's holdings, grouped — the two lists under the chart. */
  now = computed(() => composition(holdingsOn(this.accounts(), this.manual(), this.txs(), this.today)));

  series = computed(() => {
    const dates = rangeDates(this.range(), this.today, earliestDate(this.txs(), this.manual()));
    return netWorthSeries(this.accounts(), this.manual(), this.txs(), dates);
  });

  change = computed(() => changeOver(this.series()));

  // ── Projection ─────────────────────────────────────────────
  /** Continue the line six months ahead, on the forecast's numbers. */
  projecting = signal(false);

  /** Net worth at each of the next six month-ends — see utils/forecast.ts for what it assumes. */
  projection = computed(() => {
    if (!this.projecting()) return [];
    const f = forecast({
      accounts: this.accounts(), manual: this.manual(), bills: this.billService.bills(), txs: this.txs(),
      rules: this.txService.moneyRules(true),
      today: this.today, horizon: 7, baseMonths: 3,
    });
    if (f.thin) return [];
    return projectNetWorth(f, this.now().net, this.manual(), this.txs(), this.today);
  });

  /** What the chart draws: the history, then (if shown) the projection. */
  chartPoints = computed(() => [
    ...this.series().map(p => ({ date: p.date, net: p.net, projected: false })),
    ...this.projection().map(p => ({ date: p.date, net: p.net, projected: true })),
  ]);

  toggleProjection() {
    this.hoverIndex.set(null);
    this.projecting.set(!this.projecting());
  }

  /** The figure in the hero: today, or the hovered point while scrubbing the chart. */
  shown = computed(() => {
    const i = this.hoverIndex();
    const p = this.chartPoints();
    if (i !== null && p[i]) return { net: p[i].net, date: p[i].date, hovering: true, projected: p[i].projected };
    return { net: this.now().net, date: this.today, hovering: false, projected: false };
  });

  /** Change from the start of the range to the shown point. */
  shownChange = computed(() => {
    const s = this.series();
    if (!s.length) return { amount: 0, pct: null as number | null };
    const first = s[0].net;
    const amount = Math.round((this.shown().net - first) * 100) / 100;
    return { amount, pct: first !== 0 ? amount / Math.abs(first) : null };
  });

  changeWords = computed(() => {
    const shown = this.shown();
    if (shown.projected) return `since ${this.formatDate(this.series()[0]?.date ?? this.today)}, projected for ${this.formatDate(shown.date)}`;
    return shown.hovering
      ? `since ${this.formatDate(this.series()[0]?.date ?? this.today)}, as of ${this.formatDate(shown.date)}`
      : `over ${RANGE_WORDS[this.range()]}`;
  });

  /** The plain-English line under the chart — why the number is what it is. */
  sentence = computed(() => {
    const c = this.now();
    if (c.assets === 0 && c.liabilities === 0) return '';
    const own = `You own ${this.money(c.assets)} and owe ${this.money(c.liabilities)}.`;
    const top = [...c.assetGroups].sort((a, b) => b.total - a.total)[0];
    if (!top || c.assets === 0) return own;
    const pct = Math.round(top.share * 100);
    return pct >= 50
      ? `${own} ${top.label} make${top.label.endsWith('s') ? '' : 's'} up ${pct}% of what you own.`
      : own;
  });

  /** The two cards under the chart. */
  sides = computed(() => {
    const c = this.now();
    return [
      { kind: 'asset', label: 'Assets', total: c.assets, groups: c.assetGroups },
      { kind: 'liability', label: 'Liabilities', total: c.liabilities, groups: c.liabilityGroups },
    ];
  });

  /**
   * Loans repaid to you on someone else's behalf (Dad lent it, the friend pays
   * you). Followed here so you can find them, but not part of your net worth.
   */
  tracked = computed(() => {
    const txs = this.txs();
    return this.manual()
      .filter(m => m.loan && !m.archived && !countsInNetWorth(m))
      .map(m => {
        const s = loanState(m, txs, this.today);
        return { id: m.id!, name: m.name, owed: s.owed, made: s.paymentsMade, of: s.termMonths };
      });
  });

  /** "4 of 60 payments" under each loan in the lists. */
  loanProgress(h: Holding): string | null {
    if (h.kind !== 'manual') return null;
    const m = this.manual().find(x => x.id === h.id);
    if (!m?.loan) return null;
    const s = loanState(m, this.txs(), this.today);
    return `${s.paymentsMade} of ${s.termMonths} payments`;
  }

  hasManual = computed(() => this.manual().some(m => !m.archived));
  isEmpty = computed(() => this.now().assets === 0 && this.now().liabilities === 0);

  // ── Chart ──────────────────────────────────────────────────
  private chart: Chart | null = null;
  private canvas?: ElementRef<HTMLCanvasElement>;

  /** The canvas sits inside an @if; build the chart when it appears (see Dashboard's donut). */
  @ViewChild('chartCanvas') set chartCanvasRef(ref: ElementRef<HTMLCanvasElement> | undefined) {
    this.canvas = ref;
    if (!ref) { this.chart?.destroy(); this.chart = null; }
    else if (!this.chart) this.buildChart();
  }

  constructor() {
    // New data or a new range: update in place.
    effect(() => {
      const p = this.chartPoints();
      if (!this.chart) return;
      this.chart.data.labels = p.map(x => x.date);
      this.chart.data.datasets[0].data = this.actualData(p);
      this.chart.data.datasets[1].data = this.projectedData(p);
      this.chart.update('none');
    });
    // Chart.js bakes colours in, so a theme flip rebuilds.
    effect(() => {
      this.themeService.theme();
      if (!this.canvas) return;
      this.chart?.destroy();
      this.chart = null;
      queueMicrotask(() => this.buildChart());
    });
  }

  ngOnDestroy() { this.chart?.destroy(); }

  private actualData(p: { net: number; projected: boolean }[]) { return p.map(x => (x.projected ? null : x.net)); }
  /** Starts at the last actual point so the dashed line carries straight on from it. */
  private projectedData(p: { net: number; projected: boolean }[]) {
    if (!p.some(x => x.projected)) return p.map(() => null);
    const lastActual = p.findIndex(x => x.projected) - 1;
    return p.map((x, i) => (x.projected || i === lastActual ? x.net : null));
  }

  private buildChart() {
    const canvas = this.canvas?.nativeElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx || this.chart) return;
    const c = chartColors();
    const s = this.chartPoints();

    const fill = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    fill.addColorStop(0, c.accent + '33');
    fill.addColorStop(1, c.accent + '00');
    const ahead = ctx.createLinearGradient(0, 0, 0, canvas.clientHeight || 260);
    ahead.addColorStop(0, c.accent + '38');
    ahead.addColorStop(1, c.accent + '00');

    // A thin vertical rule under the cursor, so you can see which day you are reading.
    const crosshair = {
      id: 'crosshair',
      afterDatasetsDraw: (chart: Chart) => {
        const active = chart.tooltip?.getActiveElements?.() ?? [];
        if (!active.length) return;
        const x = active[0].element.x;
        const { top, bottom } = chart.chartArea;
        const g = chart.ctx;
        g.save();
        g.beginPath();
        g.moveTo(x, top);
        g.lineTo(x, bottom);
        g.lineWidth = 1;
        g.strokeStyle = c.tick;
        g.setLineDash([3, 3]);
        g.stroke();
        g.restore();
      },
    };

    this.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: s.map(p => p.date),
        datasets: [{
          label: 'Net worth',
          data: this.actualData(s),
          borderColor: c.accent,
          backgroundColor: fill,
          borderWidth: 2,
          fill: true,
          // Monotone never overshoots, so a payday jump can't draw a dip that didn't happen.
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: c.accent,
          pointHoverBorderColor: c.surface,
          pointHoverBorderWidth: 2,
        }, {
          // The projection: dashed, on the forecast wash, so it never reads as actual.
          label: 'Projected',
          data: this.projectedData(s),
          borderColor: c.accent,
          backgroundColor: ahead,
          borderWidth: 2,
          borderDash: [5, 4],
          fill: true,
          cubicInterpolationMode: 'monotone',
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: c.accent,
          pointHoverBorderColor: c.surface,
          pointHoverBorderWidth: 2,
        }],
      },
      plugins: [crosshair],
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
            // Where the two lines meet both carry the point; show it once.
            filter: (item, i, all) => item.raw !== null && all.findIndex(x => x.raw !== null) === i,
            callbacks: {
              title: items => this.formatDate(String(items[0].label)),
              label: item => `${this.chartPoints()[item.dataIndex]?.projected ? 'Projected ' : ''}${this.money(item.raw as number)}`,
            },
          },
        },
        scales: {
          x: {
            grid: { display: false },
            border: { display: false },
            ticks: {
              color: c.tick, font: { size: 10 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 6,
              callback: (_v, i) => this.formatTick(String(this.chartPoints()[i]?.date ?? '')),
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

  clearHover() {
    this.hoverIndex.set(null);
  }

  setRange(r: Range) {
    this.hoverIndex.set(null);
    this.range.set(r);
  }

  // ── Rows ───────────────────────────────────────────────────
  open(h: Holding) {
    if (h.kind === 'manual') {
      const m = this.manual().find(x => x.id === h.id);
      if (m?.loan) this.router.navigate(['/net-worth/loans', m.id]);
      else if (m) this.openEdit(m);
      return;
    }
    const a = this.accounts().find(x => x.id === h.id);
    if (!a) return;
    this.router.navigate(a.type === 'credit' ? ['/accounts', a.id] : ['/accounts/overview', a.id]);
  }

  openLoan(id: string) { this.router.navigate(['/net-worth/loans', id]); }

  // ── Manual entries: add / edit / delete ────────────────────
  formOpen = signal(false);
  editing = signal<ManualAsset | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<ManualAsset | null>(null);

  openNew() { this.editing.set(null); this.formOpen.set(true); }
  openEdit(m: ManualAsset) { this.editing.set(m); this.formOpen.set(true); }
  closeForm() { this.formOpen.set(false); this.editing.set(null); }

  async handleSave(save: AssetFormSave) {
    const e = this.editing();
    const { entry, alsoCreate } = save;
    try {
      if (e?.id) {
        // Clear what the new version doesn't have (e.g. a loan turned into a plain debt).
        await this.manualService.update(e.id, {
          loan: undefined, purchase: undefined, depreciationRate: undefined, ...entry,
        });
      } else {
        const id = await this.manualService.add(entry);
        // A loan that bought a car: add the car and point the two at each other.
        if (alsoCreate) {
          const boughtId = await this.manualService.add({ ...alsoCreate, linkedId: id });
          await this.manualService.update(id, { linkedId: boughtId });
        }
      }
      this.toast.success(alsoCreate ? `${entry.name} and ${alsoCreate.name} added.` : `${entry.name} saved.`);
      this.closeForm();
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  /** Name of the entry linked to the one being edited (the car a loan bought). */
  linkedName = computed(() => {
    const id = this.editing()?.linkedId;
    return id ? this.manual().find(m => m.id === id)?.name ?? null : null;
  });

  askDelete() {
    this.toDelete.set(this.editing());
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  cancelDelete() { this.confirmOpen.set(false); this.toDelete.set(null); this.editing.set(null); }

  async confirmDelete() {
    const m = this.toDelete();
    try {
      if (m?.id) {
        await this.manualService.remove(m.id);
        // The car stays; it just no longer points at a loan that's gone.
        const other = m.linkedId && this.manual().find(x => x.id === m.linkedId);
        if (other && other.id) await this.manualService.update(other.id, { linkedId: undefined });
      }
    } catch {
      this.toast.error('Could not delete. Please try again.');
    } finally {
      this.cancelDelete();
    }
  }

  // ── Formatting ─────────────────────────────────────────────
  money(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }

  signed(n: number): string {
    return `${n < 0 ? '−' : '+'}${this.money(n)}`;
  }

  pct(p: number | null): string {
    if (p === null) return '';
    return `${(Math.abs(p) * 100).toFixed(Math.abs(p) < 0.1 ? 1 : 0)}%`;
  }

  formatDate(d: string): string {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private formatTick(d: string): string {
    if (!d) return '';
    const long = this.range() === '1Y' || this.range() === 'ALL' || this.projecting();
    return parseLocalDate(d).toLocaleDateString('en-US', long ? { month: 'short', year: '2-digit' } : { month: 'short', day: 'numeric' });
  }

  private formatShort(n: number): string {
    const a = Math.abs(n);
    const sign = n < 0 ? '−' : '';
    if (a >= 1_000_000) return `${sign}$${(a / 1_000_000).toFixed(1)}M`;
    if (a >= 1_000) return `${sign}$${(a / 1_000).toFixed(a >= 10_000 ? 0 : 1)}K`;
    return `${sign}$${a.toFixed(0)}`;
  }
}
