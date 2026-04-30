import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, signal, inject, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { AccountService } from '../../../services/account.service';
import { CategoryService } from '../../../services/category.service';
import { Bill, BillFrequency } from '../../../models';

@Component({
  selector: 'app-bill-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './bill-form.html',
  styleUrl: './bill-form.scss'
})
export class BillForm implements OnChanges {
  accounts = inject(AccountService);
  categories = inject(CategoryService);

  @Input() open = false;
  @Input() bill: Bill | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Bill, 'id' | 'createdAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  name = '';
  amount = 0;
  frequency: BillFrequency = 'monthly';
  nextDueDate = '';
  accountId = '';
  categoryId = '';
  autopayEnabled = true;
  icon = '📄';
  notes = '';
  active = true;

  submitting = signal(false);

  frequencies: { value: BillFrequency; label: string }[] = [
    { value: 'weekly',    label: 'Weekly' },
    { value: 'monthly',   label: 'Monthly' },
    { value: 'quarterly', label: 'Quarterly' },
    { value: 'yearly',    label: 'Yearly' },
  ];

  iconOptions = ['📄', '📺', '🎵', '🎮', '☁️', '📱', '🛒', '💪', '📰', '🎬', '🏠', '🚗', '💊', '✈️', '🍔'];

  activeAccounts = computed(() =>
    this.accounts.accounts().filter(a => !a.archived)
  );

  expenseCategories = computed(() =>
    this.categories.categories().filter(c => c.kind === 'expense' && !c.archived)
  );

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) this.load();
  }

  private load() {
    if (this.bill) {
      this.name = this.bill.name;
      this.amount = this.bill.amount;
      this.frequency = this.bill.frequency;
      this.nextDueDate = this.bill.nextDueDate;
      this.accountId = this.bill.accountId || '';
      this.categoryId = this.bill.categoryId || '';
      this.autopayEnabled = this.bill.autopayEnabled;
      this.icon = this.bill.icon || '📄';
      this.notes = this.bill.notes || '';
      this.active = this.bill.active;
    } else {
      this.name = '';
      this.amount = 0;
      this.frequency = 'monthly';
      this.nextDueDate = new Date().toISOString().slice(0, 10);
      this.accountId = this.activeAccounts()[0]?.id || '';
      // Default to Subscriptions category
      const subCat = this.expenseCategories().find(c =>
        c.name.toLowerCase().includes('subscription')
      );
      this.categoryId = subCat?.id || '';
      this.autopayEnabled = true;
      this.icon = '📄';
      this.notes = '';
      this.active = true;
    }
  }

  save() {
    if (!this.name.trim()) { alert('Name is required'); return; }
    if (!this.amount || this.amount <= 0) { alert('Amount must be greater than zero'); return; }
    if (!this.nextDueDate) { alert('Due date is required'); return; }

    const data: Omit<Bill, 'id' | 'createdAt'> = {
      name: this.name.trim(),
      amount: Number(this.amount),
      frequency: this.frequency,
      nextDueDate: this.nextDueDate,
      autopayEnabled: this.autopayEnabled,
      icon: this.icon,
      active: this.active,
    };

    if (this.accountId) data.accountId = this.accountId;
    if (this.categoryId) data.categoryId = this.categoryId;
    if (this.notes.trim()) data.notes = this.notes.trim();

    this.saved.emit(data);
  }
}