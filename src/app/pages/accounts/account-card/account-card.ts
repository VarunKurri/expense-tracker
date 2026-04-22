import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Account } from '../../../models';
import { formatCurrency } from '../../../utils/format';

@Component({
  selector: 'app-account-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-card.html',
  styleUrl: './account-card.scss'
})
export class AccountCard {
  @Input() account!: Account;
  @Input() balance = 0;
  @Output() edit = new EventEmitter<Account>();

  get displayBalance(): string {
    return formatCurrency(Math.abs(this.balance));
  }

  get isDebt(): boolean {
    return this.balance < 0;
  }

  get typeLabel(): string {
    const map: Record<string, string> = {
      checking:   'Checking',
      savings:    'Savings',
      credit:     'Credit Card',
      cash:       'Cash',
      investment: 'Investment',
    };
    return map[this.account.type] || this.account.type;
  }
}
