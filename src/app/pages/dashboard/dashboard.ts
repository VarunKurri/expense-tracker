import { Component, inject, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { QuickAddService } from '../../services/quick-add.service';
import { Account } from '../../models';
import { BillService } from '../../services/bill.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private accountService = inject(AccountService);
  private txService = inject(TransactionService);
  private router = inject(Router);
  private quickAddService = inject(QuickAddService);
  private billService = inject(BillService);

  upcomingBills = computed(() => this.billService.upcomingBills(7));

  activeRange = signal<'7D' | '30D' | '90D' | 'YTD'>('30D');

  activeAccounts = computed(() =>
    this.accountService.accounts().filter(a => !a.archived)
  );

  balanceFor(account: Account): number {
    const txDelta = this.txService.balanceForAccount(account.id!);
    let balance: number;
    if (account.type === 'credit') {
      balance = account.openingBalance - txDelta;
    } else {
      balance = (account.openingBalance || 0) + txDelta;
    }
    return Math.round(balance * 100) / 100;
  }

  netWorth = computed(() => {
    let assets = 0;
    let liabilities = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit') {
        if (bal > 0) liabilities += bal;
        else assets += Math.abs(bal);
      } else {
        if (bal >= 0) assets += bal;
        else liabilities += Math.abs(bal);
      }
    }
    return Math.round((assets - liabilities) * 100) / 100;
  });

  private rangeStart = computed((): string => {
    const today = new Date();
    const y = today.getFullYear();
    switch (this.activeRange()) {
      case '7D': {
        const d = new Date(today);
        d.setDate(d.getDate() - 7);
        return d.toISOString().slice(0, 10);
      }
      case '30D': {
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        return d.toISOString().slice(0, 10);
      }
      case '90D': {
        const d = new Date(today);
        d.setDate(d.getDate() - 90);
        return d.toISOString().slice(0, 10);
      }
      case 'YTD':
        return `${y}-01-01`;
    }
  });

  rangeIncome = computed(() => {
    const start = this.rangeStart();
    return this.txService.transactions()
      .filter(t => t.type === 'income' && t.date >= start)
      .reduce((s, t) => s + t.amount, 0);
  });

  rangeExpenses = computed(() => {
    const start = this.rangeStart();
    return this.txService.transactions()
      .filter(t => t.type === 'expense' && t.date >= start)
      .reduce((s, t) => s + t.amount, 0);
  });

  savingsRate = computed(() => {
    const income = this.rangeIncome();
    if (!income) return null;
    return Math.round(((income - this.rangeExpenses()) / income) * 100);
  });

  recentTransactions = computed(() =>
    this.txService.transactions().slice(0, 5)
  );

  // ── Format helpers ────────────────────────────────────────
  formatWhole(n: number): string {
    // Round to 2 decimal places first, then take the integer part
    const rounded = Math.round(Math.abs(n) * 100) / 100;
    return Math.floor(rounded).toLocaleString('en-US');
  }

  formatCents(n: number): string {
    const rounded = Math.round(Math.abs(n) * 100) / 100;
    const cents = Math.round((rounded % 1) * 100);
    return cents.toString().padStart(2, '0');
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD'
    }).format(Math.abs(n));
  }

  isNegative(n: number): boolean { return n < 0; }

  navigate(path: string) { this.router.navigate([path]); }

  setRange(r: string) {
    this.activeRange.set(r as '7D' | '30D' | '90D' | 'YTD');
  }

  // ── Quick actions ─────────────────────────────────────────
  addMoney() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() => {
        setTimeout(() => this.quickAddService.trigger('income'), 150);
      });
    } else {
      this.quickAddService.trigger('income');
    }
  }

  addExpense() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() => {
        setTimeout(() => this.quickAddService.trigger('expense'), 150);
      });
    } else {
      this.quickAddService.trigger('expense');
    }
  }
}