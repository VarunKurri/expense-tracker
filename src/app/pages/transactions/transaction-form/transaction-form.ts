import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { ErrorBanner } from '../../../components/error-banner/error-banner';
import { AccountService } from '../../../services/account.service';
import { CategoryService } from '../../../services/category.service';
import { BillService } from '../../../services/bill.service';
import { TransactionTemplateService } from '../../../services/transaction-template.service';
import { TransactionService } from '../../../services/transaction.service';
import { BillAmountMode, BillDueDateMode, Transaction, TransactionType } from '../../../models';
import { TransactionTemplate } from '../../../models';
import { QuickAddService } from '../../../services/quick-add.service';
import { ToastService } from '../../../services/toast.service';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal, ErrorBanner],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss'
})
export class TransactionForm implements OnChanges {
  accounts = inject(AccountService);
  categories = inject(CategoryService);
  billService = inject(BillService);
  templateService = inject(TransactionTemplateService);
  private transactionService = inject(TransactionService);
  private toastService = inject(ToastService);
  private quickAddService = inject(QuickAddService);

  @Input() open = false;
  @Input() transaction: Transaction | null = null;
  @Input() draft: Partial<Transaction> | null = null;
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
  isInternalTransfer = false;
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
  billAmountMode: BillAmountMode = 'fixed';
  billDueDateMode: BillDueDateMode = 'exact';
  billAutopay: boolean = true;

  submitting = signal(false);

  filteredCategories() {
    const kind = this.type === 'income' ? 'income' : 'expense';
    return this.categories.categories().filter(c => c.kind === kind && !c.archived);
  }

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

  availableTemplates() {
    return this.templateService.templates()
      .filter(t => t.type === this.type)
      .slice(0, 6);
  }

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
      this.isInternalTransfer = this.transaction.isInternalTransfer || false;
      this.saveAsTemplate.set(false);
      this.templateName.set('');
    } else {
      this.type = this.quickAddService.defaultType() || 'expense';
      this.amount = 0;
      this.date = this.localDateString(); // local date, not UTC
      this.notes = '';
      this.merchant.set('');
      this.applySmartDefaultsForType();
      this.applyDraft();
      this.saveAsTemplate.set(false);
      this.templateName.set('');
    }

    // Default bill fields
    this.billFrequency = 'monthly';
    this.billNextDueDate = this.nextMonthDate(this.date);
    this.billAmountMode = 'fixed';
    this.billDueDateMode = 'exact';
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

  setBillAmountMode(mode: BillAmountMode) {
    this.billAmountMode = mode;
    this.syncBillAutopay();
  }

  setBillDueDateMode(mode: BillDueDateMode) {
    this.billDueDateMode = mode;
    this.syncBillAutopay();
  }

  toggleBillAutopay() {
    if (!this.canAutopayBill()) return;
    this.billAutopay = !this.billAutopay;
  }

  canAutopayBill(): boolean {
    return this.billAmountMode === 'fixed' && this.billDueDateMode === 'exact';
  }

  billAmountLabel(): string {
    return this.billAmountMode === 'fixed' ? 'Fixed amount' : 'Variable amount';
  }

  billDateLabel(): string {
    return this.billDueDateMode === 'exact' ? 'Exact due date' : 'Flexible monthly reminder';
  }

  private syncBillAutopay() {
    if (!this.canAutopayBill()) {
      this.billAutopay = false;
    }
  }

  private nextMonthDate(fromDate: string): string {
    const d = new Date(fromDate + 'T00:00:00');
    d.setMonth(d.getMonth() + 1);
    return this.localDateString(d);
  }

  private applyDraft() {
    if (!this.draft) return;
    if (this.draft.type) this.type = this.draft.type;
    if (typeof this.draft.amount === 'number') this.amount = this.draft.amount;
    if (this.draft.date) this.date = this.draft.date;
    if (this.draft.notes) this.notes = this.draft.notes;
    if (this.draft.merchant) this.merchant.set(this.draft.merchant);
    if (this.draft.accountId) this.accountId = this.draft.accountId;
    if (this.draft.categoryId) this.categoryId.set(this.draft.categoryId);
    if (this.draft.fromAccountId) this.fromAccountId = this.draft.fromAccountId;
    if (this.draft.toAccountId) this.toAccountId = this.draft.toAccountId;
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
    this.applySmartDefaultsForType();
    this.saveAsTemplate.set(false);
    this.templateName.set('');
  }

  onMerchantChange(value: string) {
    this.merchant.set(value);
    if (this.transaction || this.type === 'transfer') return;
    const match = this.findRecentMerchantMatch(value);
    if (!match) return;
    if (match.accountId && this.activeAccounts().some(a => a.id === match.accountId)) {
      this.accountId = match.accountId;
    }
    if (match.categoryId && this.filteredCategories().some(c => c.id === match.categoryId)) {
      this.categoryId.set(match.categoryId);
    }
  }

  private applySmartDefaultsForType() {
    const first = this.activeAccounts()[0];
    const second = this.activeAccounts()[1];
    const recent = this.findRecentByType(this.type);

    if (this.type === 'transfer') {
      this.categoryId.set('');
      this.accountId = '';
      this.fromAccountId = recent?.fromAccountId || first?.id || '';
      this.toAccountId = recent?.toAccountId || second?.id || '';
      if (this.fromAccountId === this.toAccountId) {
        this.toAccountId = this.activeAccounts().find(a => a.id !== this.fromAccountId)?.id || '';
      }
      return;
    }

    this.fromAccountId = first?.id || '';
    this.toAccountId = second?.id || '';
    this.accountId = recent?.accountId || first?.id || '';
    this.categoryId.set(recent?.categoryId || '');
  }

  private findRecentByType(type: TransactionType): Transaction | undefined {
    return this.transactionService.transactions().find(t => t.type === type);
  }

  private findRecentMerchantMatch(value: string): Transaction | undefined {
    const term = value.trim().toLowerCase();
    if (term.length < 2) return undefined;
    return this.transactionService.transactions().find(t =>
      t.type === this.type &&
      !!t.merchant &&
      t.merchant.trim().toLowerCase() === term
    );
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
    if (this.submitting()) return;
    if (!this.amount || this.amount <= 0) {
      this.toastService.error('Amount must be greater than zero');
      return;
    }
    // Snapshot every field into locals up front. save() awaits saveCurrentAsTemplate()
    // and billService.add() below — if the modal gets closed/reopened for another add
    // while those are in flight (easy to trigger on a slow mobile connection: tap Save,
    // nothing visibly happens, tap Cancel, tap +Add again), ngOnChanges' load() resets
    // this.amount/fromAccountId/toAccountId/etc. Reading `this.x` again after an await
    // would then emit whatever the form was reset to, not what the user actually
    // entered — producing a stray blank transaction. Locals make that impossible.
    const type = this.type;
    const amount = Number(this.amount);
    const date = this.date;
    const notes = this.notes.trim();

    if (type === 'transfer') {
      const fromAccountId = this.fromAccountId;
      const toAccountId = this.toAccountId;
      if (!fromAccountId || !toAccountId) {
        this.toastService.error('Please select both accounts');
        return;
      }
      if (fromAccountId === toAccountId) {
        this.toastService.error('From and To must be different accounts');
        return;
      }
      this.submitting.set(true);
      try {
        await this.saveCurrentAsTemplate();
      } catch (err) {
        this.toastService.error('Transaction template could not be saved.');
        this.submitting.set(false);
        return;
      }
      this.saved.emit({
        type: 'transfer',
        amount,
        date,
        fromAccountId,
        toAccountId,
        ...(notes ? { notes } : {}),
      });
      this.submitting.set(false);
    } else {
      const merchant = this.merchant().trim();
      const accountId = this.accountId;
      const categoryId = this.categoryId();
      const refunded = this.refunded;
      const isInternalTransfer = this.isInternalTransfer;
      if (!accountId) { this.toastService.error('Please select an account'); return; }
      if (!merchant) { this.toastService.error('Merchant or source is required'); return; }

      this.submitting.set(true);
      try {
        await this.saveCurrentAsTemplate();
      } catch (err) {
        this.toastService.error('Transaction template could not be saved.');
        this.submitting.set(false);
        return;
      }

      // Emit the transaction first
      this.saved.emit({
        type,
        amount,
        date,
        merchant,
        accountId,
        ...(categoryId ? { categoryId } : {}),
        ...(notes ? { notes } : {}),
        refunded,
        isInternalTransfer,
      });

      // If Subscriptions category selected, auto-create bill if one doesn't exist yet
      const isSubscription = this.isSubscription();
      const canAutopayBill = this.canAutopayBill();
      if (isSubscription && merchant && !this.transaction) {
        const existing = this.billService.bills().find(
          b => b.name.toLowerCase() === merchant.toLowerCase()
        );
        if (!existing) {
          try {
            await this.billService.add({
              name: merchant,
              amount,
              amountMode: this.billAmountMode,
              frequency: this.billFrequency,
              nextDueDate: this.billNextDueDate || this.nextMonthDate(date),
              dueDateMode: this.billDueDateMode,
              accountId,
              categoryId,
              autopayEnabled: canAutopayBill && this.billAutopay,
              icon: '📄',
              active: true,
            });
          } catch (err) {
            console.warn('Could not auto-create bill:', err);
          }
        }
      }
      this.submitting.set(false);
    }
  }
}
