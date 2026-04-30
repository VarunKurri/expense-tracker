import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { AccountService } from '../../../services/account.service';
import { CategoryService } from '../../../services/category.service';
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
  private quickAddService = inject(QuickAddService);

  @Input() open = false;
  @Input() transaction: Transaction | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  type: TransactionType = 'expense';
  amount: number = 0;
  date: string = new Date().toISOString().slice(0, 10);
  notes: string = '';
  merchant: string = '';
  accountId: string = '';
  categoryId: string = '';
  fromAccountId: string = '';
  toAccountId: string = '';
  refunded = false;

  submitting = signal(false);

  filteredCategories = computed(() => {
    const kind = this.type === 'income' ? 'income' : 'expense';
    return this.categories.categories().filter(c => c.kind === kind && !c.archived);
  });

  activeAccounts = computed(() =>
    this.accounts.accounts().filter(a => !a.archived)
  );

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
      this.categoryId = this.transaction.categoryId || '';
      this.fromAccountId = this.transaction.fromAccountId || '';
      this.toAccountId = this.transaction.toAccountId || '';
      this.refunded = this.transaction.refunded || false;
    } else {
      // Read directly from service — no timing issue
      this.type = this.quickAddService.defaultType() || 'expense';
      this.amount = 0;
      this.date = new Date().toISOString().slice(0, 10);
      this.notes = '';
      this.merchant = '';
      const first = this.activeAccounts()[0];
      this.accountId = first?.id || '';
      this.categoryId = '';
      this.fromAccountId = first?.id || '';
      const second = this.activeAccounts()[1];
      this.toAccountId = second?.id || '';
    }
  }

  setType(t: TransactionType) {
    this.type = t;
    this.categoryId = '';
  }

  save() {
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
      this.saved.emit({
        type: this.type,
        amount: Number(this.amount),
        date: this.date,
        merchant: this.merchant.trim(),
        accountId: this.accountId,
        ...(this.categoryId ? { categoryId: this.categoryId } : {}),
        ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
        refunded: this.refunded,
      });
    }
  }
}