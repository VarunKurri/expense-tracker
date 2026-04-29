import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, signal
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { Account, AccountType } from '../../../models';

@Component({
  selector: 'app-account-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './account-form.html',
  styleUrl: './account-form.scss'
})
export class AccountForm implements OnChanges {
  @Input() open = false;
  @Input() account: Account | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Account, 'id' | 'createdAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  // Base fields
  name = '';
  type: AccountType = 'checking';
  openingBalance = 0;
  institution = '';
  last4 = '';
  icon = '🏦';
  color = '#3b82f6';

  // Credit card fields
  creditLimit = 0;
  statementClosingDay = 1;
  paymentDueDay = 1;
  autopayEnabled = false;
  minimumPayment = 0;

  submitting = signal(false);

  accountTypes: { value: AccountType; label: string; defaultIcon: string; defaultColor: string }[] = [
    { value: 'checking',   label: 'Checking',    defaultIcon: '🏦', defaultColor: '#3b82f6' },
    { value: 'savings',    label: 'Savings',     defaultIcon: '💰', defaultColor: '#10b981' },
    { value: 'credit',     label: 'Credit Card', defaultIcon: '💳', defaultColor: '#8b5cf6' },
    { value: 'cash',       label: 'Cash',        defaultIcon: '💵', defaultColor: '#22c55e' },
    { value: 'investment', label: 'Investment',  defaultIcon: '📈', defaultColor: '#f59e0b' },
  ];

  iconOptions = ['🏦', '💳', '💰', '💵', '📈', '🏧', '💼', '🪙', '💴', '💶', '💷', '💸'];
  colorOptions = ['#3b82f6', '#10b981', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#f97316'];
  days = Array.from({ length: 31 }, (_, i) => i + 1);

  get isCredit(): boolean { return this.type === 'credit'; }

  ngOnChanges(changes: SimpleChanges) {
    if ((changes['open'] || changes['account']) && this.open) {
      this.load();
    }
  }

  private load() {
    if (this.account) {
      this.name = this.account.name;
      this.type = this.account.type;
      this.openingBalance = this.account.openingBalance;
      this.institution = this.account.institution || '';
      this.last4 = this.account.last4 || '';
      this.icon = this.account.icon || '🏦';
      this.color = this.account.color || '#3b82f6';
      this.creditLimit = this.account.creditLimit || 0;
      this.statementClosingDay = this.account.statementClosingDay || 1;
      this.paymentDueDay = this.account.paymentDueDay || 1;
      this.autopayEnabled = this.account.autopayEnabled || false;
      this.minimumPayment = this.account.minimumPayment || 0;
    } else {
      this.name = '';
      this.type = 'checking';
      this.openingBalance = 0;
      this.institution = '';
      this.last4 = '';
      this.icon = '🏦';
      this.color = '#3b82f6';
      this.creditLimit = 0;
      this.statementClosingDay = 1;
      this.paymentDueDay = 1;
      this.autopayEnabled = false;
      this.minimumPayment = 0;
    }
  }

  onTypeChange() {
    const preset = this.accountTypes.find(t => t.value === this.type);
    if (preset && !this.account) {
      this.icon = preset.defaultIcon;
      this.color = preset.defaultColor;
    }
  }

  async save() {
    if (!this.name.trim()) {
      alert('Account name is required');
      return;
    }
    this.submitting.set(true);
    try {
      const data: Omit<Account, 'id' | 'createdAt'> = {
        name: this.name.trim(),
        type: this.type,
        openingBalance: Number(this.openingBalance) || 0,
        currency: 'USD',
        icon: this.icon,
        color: this.color,
        archived: false,
      };

      if (this.institution.trim()) data.institution = this.institution.trim();
      if (this.last4.trim()) data.last4 = this.last4.trim();

      if (this.isCredit) {
        data.creditLimit = Number(this.creditLimit) || 0;
        data.statementClosingDay = Number(this.statementClosingDay) || 1;
        data.paymentDueDay = Number(this.paymentDueDay) || 1;
        data.autopayEnabled = this.autopayEnabled;
        data.minimumPayment = Number(this.minimumPayment) || 0;
      }

      this.saved.emit(data);
    } finally {
      this.submitting.set(false);
    }
  }
}