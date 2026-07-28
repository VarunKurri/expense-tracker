import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, ActivatedRoute } from '@angular/router';
import { TransactionService } from '../../../services/transaction.service';
import { CategoryService } from '../../../services/category.service';
import { filterForAnalysis } from '../../../utils/analysis-filter';

@Component({
  selector: 'app-category-breakdown',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './category-breakdown.html',
  styleUrl: './category-breakdown.scss'
})
export class CategoryBreakdown {
  private txService = inject(TransactionService);
  private categoryService = inject(CategoryService);
  private route = inject(ActivatedRoute);

  start = signal('');
  end = signal('');
  accountId = signal('');
  excludeRefunded = signal(true);
  excludedCategoryIds = signal<Set<string>>(new Set());

  constructor() {
    const qp = this.route.snapshot.queryParamMap;
    this.start.set(qp.get('start') || '');
    this.end.set(qp.get('end') || '');
    this.accountId.set(qp.get('accountId') || '');
    this.excludeRefunded.set(qp.get('excludeRefunded') !== 'false');
    const excluded = qp.get('excluded');
    if (excluded) this.excludedCategoryIds.set(new Set(excluded.split(',').filter(Boolean)));
  }

  private filtered = computed(() => filterForAnalysis(this.txService.transactions(), {
    start: this.start(),
    end: this.end(),
    accountId: this.accountId(),
    excludeRefunded: this.excludeRefunded(),
    excludedCategoryIds: this.excludedCategoryIds(),
  }));

  // Internal transfers are excluded here too — same rule as the Analysis page
  // this view is drilling in from.
  private expenses = computed(() =>
    this.filtered().filter(t => t.type === 'expense' && !t.isInternalTransfer)
  );

  totalExpenses = computed(() =>
    Math.round(this.expenses().reduce((s, t) => s + t.amount, 0) * 100) / 100
  );

  // Every category with spend in the period — no top-8 cap, unlike the Analysis
  // donut this page is drilling in from.
  categories = computed(() => {
    const byCat = new Map<string, number>();
    const total = this.totalExpenses();
    for (const t of this.expenses()) {
      const key = t.categoryId || '__none__';
      byCat.set(key, (byCat.get(key) || 0) + t.amount);
    }
    return [...byCat.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([id, amount]) => {
        const cat = id === '__none__'
          ? undefined
          : this.categoryService.categories().find(c => c.id === id);
        return {
          id,
          name: cat?.name ?? 'Uncategorized',
          icon: cat?.icon ?? '📦',
          color: cat?.color ?? '#6366f1',
          amount: Math.round(amount * 100) / 100,
          pct: total > 0 ? Math.round((amount / total) * 100) : 0,
        };
      });
  });

  rangeLabel = computed(() => {
    const s = this.start(), e = this.end();
    if (!s && !e) return 'All time';
    const fmt = (d: string) => new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    if (s && e) return `${fmt(s)} – ${fmt(e)}`;
    return s ? `Since ${fmt(s)}` : `Through ${fmt(e)}`;
  });

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }

  // Query params for drilling into Transactions, filtered to exactly this
  // category within the same period this whole page is scoped to. Also marks it
  // as an "analysis view" — same as Analysis' own "See all transactions" link —
  // so refunded/internal-transfer rows still show (this page's own category
  // totals already exclude them) but greyed out and struck through, rather than
  // silently vanishing and leaving the drill-through looking incomplete.
  transactionsParams(categoryId: string): Record<string, string> {
    const qp: Record<string, string> = {
      view: 'analysis',
      excludeRefunded: this.excludeRefunded() ? 'true' : 'false',
    };
    if (this.start()) qp['start'] = this.start();
    if (this.end()) qp['end'] = this.end();
    if (this.accountId()) qp['accountId'] = this.accountId();
    if (categoryId === '__none__') {
      qp['special'] = 'uncategorized';
    } else {
      qp['categoryId'] = categoryId;
    }
    return qp;
  }
}
