import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { TransactionForm } from './transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';
import { Transaction } from '../../models';
import { QuickAddService } from '../../services/quick-add.service';
import { effect } from '@angular/core';

type FilterType = 'all' | 'income' | 'expense' | 'transfer';
type DateRange = 'this-month' | 'last-month' | 'this-year' | 'all';

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
  private quickAdd = inject(QuickAddService);

  // Modal state
  formOpen = signal(false);
  editing = signal<Transaction | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<Transaction | null>(null);

  // Filter state
  filterType = signal<FilterType>('all');
  filterDateRange = signal<DateRange>('this-month');
  filterAccountId = signal('');
  filterCategoryId = signal('');
  search = signal('');

  // Date range bounds
  private dateRange = computed(() => {
    const today = new Date();
    const y = today.getFullYear();
    const m = today.getMonth();
    switch (this.filterDateRange()) {
      case 'this-month':
        return {
          start: new Date(y, m, 1).toISOString().slice(0, 10),
          end: new Date(y, m + 1, 0).toISOString().slice(0, 10)
        };
      case 'last-month':
        return {
          start: new Date(y, m - 1, 1).toISOString().slice(0, 10),
          end: new Date(y, m, 0).toISOString().slice(0, 10)
        };
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
        const m = (t.merchant || '').toLowerCase();
        const n = (t.notes || '').toLowerCase();
        if (!m.includes(q) && !n.includes(q)) return false;
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
  accountName(id: string): string {
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
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === today.toDateString()) return 'Today';
    if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
    return d.toLocaleDateString('en-US', {
      weekday: 'long', month: 'short', day: 'numeric'
    });
  }

  hasActiveFilters = computed(() =>
    this.filterType() !== 'all' ||
    this.filterDateRange() !== 'this-month' ||
    !!this.filterAccountId() ||
    !!this.filterCategoryId() ||
    !!this.search()
  );

  resetFilters() {
    this.filterType.set('all');
    this.filterDateRange.set('this-month');
    this.filterAccountId.set('');
    this.filterCategoryId.set('');
    this.search.set('');
  }

  // CRUD
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
    effect(() => {
      if (this.quickAdd.open()) {
        // Run outside the effect to avoid signal update conflicts
        setTimeout(() => {
          this.formOpen.set(true);
          this.editing.set(null);
          this.quickAdd.close();
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