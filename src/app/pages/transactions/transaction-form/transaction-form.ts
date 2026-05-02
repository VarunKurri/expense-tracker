import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { AccountService } from '../../../services/account.service';
import { CategoryService } from '../../../services/category.service';
import { BillService } from '../../../services/bill.service';
import { Transaction, TransactionType } from '../../../models';
import { QuickAddService } from '../../../services/quick-add.service';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss'
})
export class TransactionForm implements OnChanges {
  accounts = inject(AccountService);
  categories = inject(CategoryService);
  billService = inject(BillService);
  private quickAddService = inject(QuickAddService);

  @Input() open = false;
  @Input() transaction: Transaction | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  // Core transaction fields
  type: TransactionType = 'expense';
  amount: number = 0;
  date: string = new Date().toISOString().slice(0, 10);
  notes: string = '';
  merchant: string = '';
  accountId: string = '';
  categoryId = signal('');  // signal so isSubscription() reacts reactively
  fromAccountId: string = '';
  toAccountId: string = '';
  refunded = false;

  // Bill fields — shown when Subscriptions category is selected
  billFrequency: 'weekly' | 'monthly' | 'quarterly' | 'yearly' = 'monthly';
  billNextDueDate: string = '';
  billAutopay: boolean = true;

  submitting = signal(false);

  filteredCategories = computed(() => {
    const kind = this.type === 'income' ? 'income' : 'expense';
    return this.categories.categories().filter(c => c.kind === kind && !c.archived);
  });

  activeAccounts = computed(() =>
    this.accounts.accounts().filter(a => !a.archived)
  );

  // True when selected category is "Subscriptions" (or contains "subscription")
  isSubscription = computed(() => {
    if (!this.categoryId()) return false;
    const cat = this.categories.categories().find(c => c.id === this.categoryId());
    return cat?.name.toLowerCase().includes('subscription') ?? false;
  });

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.load();
    }
  }

  private load() {
    if (this.transaction) {
      this.type = this.transaction.type;
      this.amount = this.transaction.amount;
      this.date = this.transaction.date;
      this.notes = this.transaction.notes || '';
      this.merchant = this.transaction.merchant || '';
      this.accountId = this.transaction.accountId || '';
      this.categoryId.set(this.transaction.categoryId || '');
      this.fromAccountId = this.transaction.fromAccountId || '';
      this.toAccountId = this.transaction.toAccountId || '';
      this.refunded = this.transaction.refunded || false;
    } else {
      this.type = this.quickAddService.defaultType() || 'expense';
      this.amount = 0;
      this.date = new Date().toISOString().slice(0, 10);
      this.notes = '';
      this.merchant = '';
      const first = this.activeAccounts()[0];
      this.accountId = first?.id || '';
      this.categoryId.set('');
      this.fromAccountId = first?.id || '';
      const second = this.activeAccounts()[1];
      this.toAccountId = second?.id || '';
    }

    // Default bill fields
    this.billFrequency = 'monthly';
    this.billNextDueDate = this.nextMonthDate(this.date);
    this.billAutopay = true;

    setTimeout(() => this.resetNotesHeight(), 0);
  }

  // When category changes, update nextDueDate default from current date
  onCategoryChange(val: string) {
    this.categoryId.set(val);
    if (this.isSubscription()) {
      this.billNextDueDate = this.nextMonthDate(this.date);
    }
  }

  private nextMonthDate(fromDate: string): string {
    const d = new Date(fromDate + 'T00:00:00');
    d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }

  onNotesInput(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  private resetNotesHeight() {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[name="notes"]');
    if (!el) return;
    el.style.height = 'auto';
    if (el.value) {
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }

  setType(t: TransactionType) {
    this.type = t;
    this.categoryId.set('');
  }

  async save() {
    if (!this.amount || this.amount <= 0) {
      alert('Amount must be greater than zero');
      return;
    }
    if (this.type === 'transfer') {
      if (!this.fromAccountId || !this.toAccountId) {
        alert('Select both accounts');
        return;
      }
      if (this.fromAccountId === this.toAccountId) {
        alert('From and To accounts must be different');
        return;
      }
      this.saved.emit({
        type: 'transfer',
        amount: Number(this.amount),
        date: this.date,
        fromAccountId: this.fromAccountId,
        toAccountId: this.toAccountId,
        ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
      });
    } else {
      if (!this.accountId) { alert('Select an account'); return; }
      if (!this.merchant.trim()) { alert('Merchant / source is required'); return; }

      // Emit the transaction first
      this.saved.emit({
        type: this.type,
        amount: Number(this.amount),
        date: this.date,
        merchant: this.merchant.trim(),
        accountId: this.accountId,
        ...(this.categoryId() ? { categoryId: this.categoryId() } : {}),
        ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
        refunded: this.refunded,
      });

      // If Subscriptions category selected, auto-create bill if one doesn't exist yet
      if (this.isSubscription() && this.merchant.trim() && !this.transaction) {
        const name = this.merchant.trim();
        const existing = this.billService.bills().find(
          b => b.name.toLowerCase() === name.toLowerCase()
        );
        if (!existing) {
          try {
            await this.billService.add({
              name,
              amount: Number(this.amount),
              frequency: this.billFrequency,
              nextDueDate: this.billNextDueDate || this.nextMonthDate(this.date),
              accountId: this.accountId,
              categoryId: this.categoryId(),
              autopayEnabled: this.billAutopay,
              icon: '📄',
              active: true,
            });
          } catch (err) {
            console.warn('Could not auto-create bill:', err);
          }
        }
      }
    }
  }
}