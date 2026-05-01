import { Component, inject, signal, computed, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { TransactionForm } from './transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';
import { Transaction } from '../../models';
import { QuickAddService } from '../../services/quick-add.service';

type FilterType = 'all' | 'income' | 'expense' | 'transfer';
type DateRange = 'last-30' | 'this-month' | 'last-month' | 'this-year' | 'all';

@Component({
  selector: 'app-transactions',
  standalone: true,
  imports: [CommonModule, FormsModule, TransactionForm, Confirm],
  templateUrl: './transactions.html',
  styleUrl: './transactions.scss',
})
export class Transactions {
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);
  private categoryService = inject(CategoryService);
  private route = inject(ActivatedRoute);
  quickAdd = inject(QuickAddService);

  // Modal state
  formOpen = signal(false);
  editing = signal<Transaction | null>(null);
  viewing = signal<Transaction | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<Transaction | null>(null);

  // Filter state — default is last 30 days
  filterType = signal<FilterType>('all');
  filterDateRange = signal<DateRange>('last-30');
  filterAccountId = signal('');
  filterCategoryId = signal('');
  search = signal('');

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
      default:
        return { start: '', end: '' };
    }
  });

  // Filtered transactions
  filtered = computed(() => {
    const { start, end } = this.dateRange();
    const q = this.search().toLowerCase();
    return this.txService.transactions().filter(t => {
      if (this.filterType() !== 'all' && t.type !== this.filterType()) return false;
      if (start && t.date < start) return false;
      if (end && t.date > end) return false;
      if (this.filterAccountId()) {
        if (t.type === 'transfer') {
          if (t.fromAccountId !== this.filterAccountId() &&
              t.toAccountId !== this.filterAccountId()) return false;
        } else {
          if (t.accountId !== this.filterAccountId()) return false;
        }
      }
      if (this.filterCategoryId() && t.categoryId !== this.filterCategoryId()) return false;
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
          if (t.type === 'income') return s + t.amount;
          if (t.type === 'expense') return s - t.amount;
          return s;
        }, 0)
      }));
  });

  // Totals
  totals = computed(() => {
    let income = 0, expense = 0;
    for (const t of this.filtered()) {
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expense += t.amount;
    }
    return { income, expense, net: income - expense };
  });

  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  allCategories = computed(() =>
    this.categoryService.categories().filter(c => !c.archived)
  );

  // Helpers
  accountName(id?: string): string {
    if (!id) return '—';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? `${a.icon} ${a.name}` : '—';
  }

  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id);
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

  hasActiveFilters = computed(() =>
    this.filterType() !== 'all' ||
    this.filterDateRange() !== 'last-30' ||
    !!this.filterAccountId() ||
    !!this.filterCategoryId() ||
    !!this.search()
  );

  resetFilters() {
    this.filterType.set('all');
    this.filterDateRange.set('last-30');
    this.filterAccountId.set('');
    this.filterCategoryId.set('');
    this.search.set('');
  }

  // ── View panel ────────────────────────────────────────────
  openView(tx: Transaction) {
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

  // ── CRUD ──────────────────────────────────────────────────
  openNew() {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  openEdit(tx: Transaction) {
    this.editing.set(tx);
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
    this.editing.set(null);
    this.quickAdd.close();
  }

  constructor() {
    // Pre-filter by account when navigated from account detail "View all"
    const accountId = this.route.snapshot.queryParamMap.get('accountId');
    if (accountId) {
      this.filterAccountId.set(accountId);
      this.filterDateRange.set('all'); // show full history for this account
    }

    effect(() => {
      if (this.quickAdd.open()) {
        setTimeout(() => {
          this.editing.set(null);
          this.formOpen.set(true);
        }, 0);
      }
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
      alert('Failed: ' + (err as Error).message);
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