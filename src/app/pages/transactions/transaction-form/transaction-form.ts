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
import { TransactionTemplateService } from '../../../services/transaction-template.service';
import { Transaction, TransactionType } from '../../../models';
import { TransactionTemplate } from '../../../models';
import { QuickAddService } from '../../../services/quick-add.service';
import { ToastService } from '../../../services/toast.service';

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
  templateService = inject(TransactionTemplateService);
  private toastService = inject(ToastService);
  private quickAddService = inject(QuickAddService);

  @Input() open = false;
  @Input() transaction: Transaction | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  // Core transaction fields
  type: TransactionType = 'expense';
  amount: number = 0;
  date: string = this.localDateString();
  notes: string = '';
  merchant = signal('');
  accountId: string = '';
  categoryId = signal('');
  fromAccountId: string = '';
  toAccountId: string = '';
  refunded = false;
  saveAsTemplate = signal(false);
  templateName = signal('');

  // Returns today's date as YYYY-MM-DD in LOCAL time — never UTC
  private localDateString(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

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

  hasExistingBill = computed(() => {
    const term = this.merchant().trim().toLowerCase();
    if (!term) return false;
    return this.billService.bills().some(b => b.name && b.name.toLowerCase() === term);
  });

  availableTemplates = computed(() =>
    this.templateService.templates()
      .filter(t => t.type === this.type)
      .slice(0, 6)
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
      this.merchant.set(this.transaction.merchant || '');
      this.accountId = this.transaction.accountId || '';
      this.categoryId.set(this.transaction.categoryId || '');
      this.fromAccountId = this.transaction.fromAccountId || '';
      this.toAccountId = this.transaction.toAccountId || '';
      this.refunded = this.transaction.refunded || false;
      this.saveAsTemplate.set(false);
      this.templateName.set('');
    } else {
      this.type = this.quickAddService.defaultType() || 'expense';
      this.amount = 0;
      this.date = this.localDateString(); // local date, not UTC
      this.notes = '';
      this.merchant.set('');
      const first = this.activeAccounts()[0];
      this.accountId = first?.id || '';
      this.categoryId.set('');
      this.fromAccountId = first?.id || '';
      const second = this.activeAccounts()[1];
      this.toAccountId = second?.id || '';
      this.saveAsTemplate.set(false);
      this.templateName.set('');
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
    return this.localDateString(d);
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
    this.saveAsTemplate.set(false);
    this.templateName.set('');
  }

  async applyTemplate(template: TransactionTemplate) {
    this.type = template.type;
    this.amount = template.amount || 0;
    this.notes = template.notes || '';
    this.merchant.set(template.merchant || '');
    this.accountId = template.accountId || this.accountId;
    this.categoryId.set(template.categoryId || '');
    this.fromAccountId = template.fromAccountId || this.fromAccountId;
    this.toAccountId = template.toAccountId || this.toAccountId;
    this.saveAsTemplate.set(false);
    this.templateName.set('');
    if (template.id) {
      try {
        await this.templateService.recordUse(template.id);
      } catch (err) {
        this.toastService.error('Template loaded, but usage could not be updated.');
      }
    }
    setTimeout(() => this.resetNotesHeight(), 0);
  }

  async deleteTemplate(event: Event, template: TransactionTemplate) {
    event.stopPropagation();
    if (!template.id) return;
    try {
      await this.templateService.remove(template.id);
      this.toastService.success('Template deleted.');
    } catch (err) {
      this.toastService.error('Template could not be deleted.');
    }
  }

  templateLabel(template: TransactionTemplate): string {
    if (template.type === 'transfer') return template.name;
    const amount = template.amount ? `$${template.amount.toFixed(2)}` : '';
    return amount ? `${template.name} · ${amount}` : template.name;
  }

  defaultTemplateName(): string {
    if (this.type === 'transfer') return 'Transfer';
    return this.merchant().trim() || (this.type === 'income' ? 'Income' : 'Expense');
  }

  private async saveCurrentAsTemplate() {
    if (!this.saveAsTemplate() || this.transaction) return;
    const name = this.templateName().trim() || this.defaultTemplateName();
    const base = {
      name,
      type: this.type,
      amount: Number(this.amount),
      ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
    };

    if (this.type === 'transfer') {
      await this.templateService.add({
        ...base,
        fromAccountId: this.fromAccountId,
        toAccountId: this.toAccountId,
      });
    } else {
      await this.templateService.add({
        ...base,
        merchant: this.merchant().trim(),
        accountId: this.accountId,
        ...(this.categoryId() ? { categoryId: this.categoryId() } : {}),
      });
    }
  }

  async save() {
    if (!this.amount || this.amount <= 0) {
      this.toastService.error('Amount must be greater than zero');
      return;
    }
    if (this.type === 'transfer') {
      if (!this.fromAccountId || !this.toAccountId) {
        this.toastService.error('Please select both accounts');
        return;
      }
      if (this.fromAccountId === this.toAccountId) {
        this.toastService.error('From and To must be different accounts');
        return;
      }
      try {
        await this.saveCurrentAsTemplate();
      } catch (err) {
        this.toastService.error('Transaction template could not be saved.');
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
      if (!this.accountId) { this.toastService.error('Please select an account'); return; }
      if (!this.merchant().trim()) { this.toastService.error('Merchant or source is required'); return; }

      try {
        await this.saveCurrentAsTemplate();
      } catch (err) {
        this.toastService.error('Transaction template could not be saved.');
        return;
      }

      // Emit the transaction first
      this.saved.emit({
        type: this.type,
        amount: Number(this.amount),
        date: this.date,
        merchant: this.merchant().trim(),
        accountId: this.accountId,
        ...(this.categoryId() ? { categoryId: this.categoryId() } : {}),
        ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
        refunded: this.refunded,
      });

      // If Subscriptions category selected, auto-create bill if one doesn't exist yet
      if (this.isSubscription() && this.merchant().trim() && !this.transaction) {
        const name = this.merchant().trim();
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
