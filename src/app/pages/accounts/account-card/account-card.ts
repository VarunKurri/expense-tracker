import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { Account } from '../../../models';

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
  @Input() availableCredit = 0;
  @Output() edit = new EventEmitter<Account>();

  private router = inject(Router);

  get isCredit(): boolean { return this.account.type === 'credit'; }
  get isDebt(): boolean { return this.isCredit && this.balance > 0; }

  get typeLabel(): string {
    const map: Record<string, string> = {
      checking: 'Checking', savings: 'Savings',
      credit: 'Credit Card', cash: 'Cash', investment: 'Investment'
    };
    return map[this.account.type] || this.account.type;
  }

  get paymentDueDate(): string {
    if (!this.account.paymentDueDay) return '';
    const today = new Date();
    const due = new Date(today.getFullYear(), today.getMonth(), this.account.paymentDueDay);
    if (due < today) due.setMonth(due.getMonth() + 1);
    return due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD'
    }).format(Math.abs(n));
  }

  onClick() {
    if (this.isCredit) {
      this.router.navigate(['/accounts', this.account.id]);
    } else {
      this.router.navigate(['/accounts/overview', this.account.id]);
    }
  }
}