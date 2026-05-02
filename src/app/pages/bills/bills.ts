import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { BillService } from '../../services/bill.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { BillForm } from './bill-form/bill-form';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { Confirm } from '../../components/confirm/confirm';
import { Bill, Transaction } from '../../models';

@Component({
  selector: 'app-bills',
  standalone: true,
  imports: [CommonModule, BillForm, TransactionForm, Confirm],
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

  // Transaction view panel — view first, then edit on button click
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  viewTxConfirmOpen = signal(false);
  txToDelete = signal<Transaction | null>(null);

  openTxView(tx: Transaction) {
    this.viewingTx.set(tx);
    document.body.style.overflow = 'hidden';
  }

  closeTxView() {
    this.viewingTx.set(null);
    document.body.style.overflow = '';
  }

  editFromTxView() {
    const tx = this.viewingTx();
    this.viewingTx.set(null);
    document.body.style.overflow = '';
    if (tx) {
      this.editingTx.set(tx);
      this.txFormOpen.set(true);
    }
  }

  closeTxForm() {
    this.txFormOpen.set(false);
    this.editingTx.set(null);
  }

  async handleTxSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const tx = this.editingTx();
    if (!tx?.id) return;
    try {
      await this.txService.update(tx.id, data);
      this.closeTxForm();
    } catch (err) {
      alert('Failed: ' + (err as Error).message);
    }
  }

  askTxDelete() {
    this.txToDelete.set(this.editingTx());
    this.txFormOpen.set(false);
    this.viewTxConfirmOpen.set(true);
  }

  async confirmTxDelete() {
    const tx = this.txToDelete();
    if (!tx?.id) return;
    try {
      await this.txService.remove(tx.id);
    } finally {
      this.viewTxConfirmOpen.set(false);
      this.txToDelete.set(null);
      this.editingTx.set(null);
    }
  }

  // Group bills by status
  overdue = computed(() => this.billService.overdueBills());
  upcoming = computed(() => this.billService.upcomingBills(30));

  futureBills = computed(() => {
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

  activeBills = computed(() =>
    this.billService.bills().filter(b => b.active)
  );

  // Payment history — transactions that are either:
  // 1. In the Subscriptions category (any subscription-tagged expense), OR
  // 2. Merchant name matches a known bill name exactly
  // The Costco issue was a miscategorization — those should not be in Subscriptions.
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

  totalHistorySpent = computed(() =>
    this.paymentHistory().reduce((s, t) => s + t.amount, 0)
  );

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
        label: new Date(month + '-01T00:00:00').toLocaleDateString('en-US', {
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

  // Yearly cost at current rate
  totalYearly = computed(() => this.totalMonthly() * 12);

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

      const subTxs = this.txService.transactions().filter(t =>
        t.type === 'expense' && t.categoryId === subCat.id && t.merchant
      );

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
          frequency: 'monthly',
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
    return d.toISOString().slice(0, 10);
  }

  // ── Mark as paid ──────────────────────────────────────────
  async markPaid(bill: Bill) {
    if (!bill.id) return;
    this.markingPaid.set(bill.id);
    try {
      await this.txService.add({
        type: 'expense',
        amount: bill.amount,
        date: new Date().toISOString().slice(0, 10),
        merchant: bill.name,
        accountId: bill.accountId,
        categoryId: bill.categoryId,
        notes: `${bill.frequency} bill — autopaid`,
      });

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
  categoryFor(id?: string) {
    if (!id) return null;
    return this.categoryService.categories().find(c => c.id === id) || null;
  }

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

  // Find best icon for a history transaction —
  // try bill name match first, then category icon, then generic
  historyIcon(tx: Transaction): string {
    const byName = this.billService.bills().find(b =>
      b.name.toLowerCase() === (tx.merchant || '').toLowerCase()
    );
    if (byName?.icon && byName.icon !== '📄') return byName.icon;

    const cat = this.categoryService.categories().find(c => c.id === tx.categoryId);
    if (cat?.icon) return cat.icon;

    return '📄';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(n);
  }

  // No cents for subtitle/summary numbers — cleaner
  formatCurrencyRounded(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      maximumFractionDigits: 0
    }).format(n);
  }

  formatFullDate(date: string): string {
    const d = new Date(date + 'T00:00:00');
    return d.toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
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

  // Safe local date parsing for the date pipe workaround
  localDate(dateStr: string): Date {
    return new Date(dateStr + 'T00:00:00');
  }
}