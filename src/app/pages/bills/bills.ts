import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BillService } from '../../services/bill.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { BillForm } from './bill-form/bill-form';
import { Confirm } from '../../components/confirm/confirm';
import { Bill, Transaction } from '../../models';

@Component({
  selector: 'app-bills',
  standalone: true,
  imports: [CommonModule, BillForm, Confirm],
  templateUrl: './bills.html',
  styleUrl: './bills.scss'
})
export class Bills {
  Math = Math;

  billService = inject(BillService);
  txService = inject(TransactionService);
  accountService = inject(AccountService);
  categoryService = inject(CategoryService);

  formOpen = signal(false);
  editing = signal<Bill | null>(null);
  confirmOpen = signal(false);
  toDelete = signal<Bill | null>(null);
  importing = signal(false);
  importDone = signal(false);
  markingPaid = signal<string | null>(null);

  // Group bills by status
  overdue = computed(() => this.billService.overdueBills());
  upcoming = computed(() => this.billService.upcomingBills(30));

  futureBills = computed(() => {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date();
    future.setDate(future.getDate() + 30);
    const futureStr = future.toISOString().slice(0, 10);
    return this.billService.bills().filter(b =>
      b.active && b.nextDueDate > futureStr
    );
  });

  inactiveBills = computed(() =>
    this.billService.bills().filter(b => !b.active)
  );

  // All active bills (for the "All Active" section)
  activeBills = computed(() =>
    this.billService.bills().filter(b => b.active)
  );

  // Payment history — subscription transactions matching bill names or category
  paymentHistory = computed(() => {
    const subCat = this.categoryService.categories().find(c =>
      c.name.toLowerCase().includes('subscription')
    );
    const billNames = new Set(
      this.billService.bills().map(b => b.name.toLowerCase())
    );

    return this.txService.transactions()
      .filter(t => {
        if (t.type !== 'expense') return false;
        const matchesCategory = subCat && t.categoryId === subCat.id;
        const matchesBillName = t.merchant &&
          billNames.has(t.merchant.toLowerCase());
        return matchesCategory || matchesBillName;
      })
      .sort((a, b) => b.date.localeCompare(a.date));
  });

  // Total spent on subscriptions all time
  totalHistorySpent = computed(() =>
    this.paymentHistory().reduce((s, t) => s + t.amount, 0)
  );

  // Group payment history by month
  groupedHistory = computed(() => {
    const groups = new Map<string, Transaction[]>();
    for (const tx of this.paymentHistory()) {
      const month = tx.date.slice(0, 7);
      if (!groups.has(month)) groups.set(month, []);
      groups.get(month)!.push(tx);
    }
    return Array.from(groups.entries())
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, items]) => ({
        month,
        label: new Date(month + '-01').toLocaleDateString('en-US', {
          month: 'long', year: 'numeric'
        }),
        items,
        total: items.reduce((s, t) => s + t.amount, 0)
      }));
  });

  totalMonthly = computed(() => {
    return this.billService.bills()
      .filter(b => b.active)
      .reduce((sum, b) => {
        switch (b.frequency) {
          case 'weekly':    return sum + (b.amount * 52 / 12);
          case 'monthly':   return sum + b.amount;
          case 'quarterly': return sum + (b.amount / 3);
          case 'yearly':    return sum + (b.amount / 12);
        }
      }, 0);
  });

  // ── Import from existing subscription transactions ────────
  async importFromTransactions() {
    this.importing.set(true);
    try {
      const subCat = this.categoryService.categories().find(c =>
        c.name.toLowerCase().includes('subscription')
      );
      if (!subCat?.id) {
        alert('No "Subscriptions" category found. Make sure it exists in your categories.');
        return;
      }

      // Get all subscription transactions
      const subTxs = this.txService.transactions().filter(t =>
        t.type === 'expense' && t.categoryId === subCat.id && t.merchant
      );

      // Deduplicate by merchant name
      const seen = new Set<string>();
      const existing = new Set(this.billService.bills().map(b => b.name.toLowerCase()));
      let added = 0;

      for (const tx of subTxs) {
        const name = tx.merchant!.trim();
        const key = name.toLowerCase();
        if (seen.has(key) || existing.has(key)) continue;
        seen.add(key);

        await this.billService.add({
          name,
          amount: tx.amount,
          frequency: 'monthly',    // default — user can edit
          nextDueDate: this.nextMonthDate(tx.date),
          accountId: tx.accountId,
          categoryId: subCat.id,
          autopayEnabled: true,
          icon: '📄',
          active: true,
        });
        added++;
      }

      this.importDone.set(true);
      if (added === 0) {
        alert('No new subscription bills to import — all already exist.');
      }
    } finally {
      this.importing.set(false);
    }
  }

  private nextMonthDate(fromDate: string): string {
    const d = new Date(fromDate + 'T00:00:00');
    d.setMonth(d.getMonth() + 1);
    // Keep same day of month
    return d.toISOString().slice(0, 10);
  }

  // ── Mark as paid ──────────────────────────────────────────
  async markPaid(bill: Bill) {
    if (!bill.id) return;
    this.markingPaid.set(bill.id);
    try {
      // 1. Create expense transaction
      await this.txService.add({
        type: 'expense',
        amount: bill.amount,
        date: new Date().toISOString().slice(0, 10),
        merchant: bill.name,
        accountId: bill.accountId,
        categoryId: bill.categoryId,
        notes: `${bill.frequency} bill — autopaid`,
      });

      // 2. Advance next due date
      const nextDate = this.billService.nextDueDate(bill);
      await this.billService.update(bill.id, { nextDueDate: nextDate });

    } catch (err) {
      alert('Failed: ' + (err as Error).message);
    } finally {
      this.markingPaid.set(null);
    }
  }

  // ── CRUD ──────────────────────────────────────────────────
  openNew() {
    this.editing.set(null);
    this.formOpen.set(true);
  }

  openEdit(bill: Bill) {
    this.editing.set(bill);
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
    this.editing.set(null);
  }

  async handleSave(data: Omit<Bill, 'id' | 'createdAt'>) {
    const e = this.editing();
    try {
      if (e?.id) {
        await this.billService.update(e.id, data);
      } else {
        await this.billService.add(data);
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
    const b = this.toDelete();
    if (!b?.id) return;
    try {
      await this.billService.remove(b.id);
    } finally {
      this.confirmOpen.set(false);
      this.toDelete.set(null);
      this.editing.set(null);
    }
  }

  // ── Helpers ───────────────────────────────────────────────
  accountName(id?: string): string {
    if (!id) return '';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a ? `${a.icon} ${a.name}` : '';
  }

  accountIcon(id?: string): string {
    if (!id) return '';
    const a = this.accountService.accounts().find(a => a.id === id);
    return a?.icon || '';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(n);
  }

  formatDate(date: string): string {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      month: 'short', day: 'numeric', year: 'numeric'
    });
  }

  daysUntil(date: string): number {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(date + 'T00:00:00');
    return Math.round((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
  }

  frequencyLabel(f: string): string {
    const map: Record<string, string> = {
      weekly: 'Weekly', monthly: 'Monthly',
      quarterly: 'Quarterly', yearly: 'Yearly'
    };
    return map[f] || f;
  }
}