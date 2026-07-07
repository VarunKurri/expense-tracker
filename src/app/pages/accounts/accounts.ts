import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountForm } from './account-form/account-form';
import { AccountCard } from './account-card/account-card';
import { SummaryBar } from './summary-bar/summary-bar';
import { Confirm } from '../../components/confirm/confirm';
import { Modal } from '../../components/modal/modal';
import { Account } from '../../models';
import { ToastService } from '../../services/toast.service';
import { PlaidService, PlaidItem } from '../../services/plaid.service';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, AccountForm, AccountCard, SummaryBar, Confirm, Modal],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss'
})
export class Accounts {
  private router = inject(Router);
  private toastService = inject(ToastService);
  accountSvc     = inject(AccountService);
  transactionSvc = inject(TransactionService);
  plaidSvc       = inject(PlaidService);

  formOpen        = signal(false);
  editingAccount  = signal<Account | null>(null);
  confirmOpen     = signal(false);
  accountToDelete = signal<Account | null>(null);

  disconnectOpen  = signal(false);
  itemToDisconnect = signal<PlaidItem | null>(null);

  // Connect flow: choose how much history to import before opening Plaid Link.
  connectChooserOpen = signal(false);
  historyChoice = signal<'30' | '90' | '180' | '365' | '730' | 'custom'>('90');
  customStartDate = signal('');
  todayStr = new Date().toISOString().slice(0, 10);

  activeAccounts = computed(() =>
    this.accountSvc.accounts().filter(a => !a.archived)
  );

  balanceFor(account: Account): number {
    const txDelta = this.transactionSvc.balanceForAccount(account.id!);
    if (account.type === 'credit') {
      return account.openingBalance - txDelta;
    }
    return (account.openingBalance || 0) + txDelta;
  }

  availableCreditFor(account: Account): number {
    if (!account.creditLimit) return 0;
    return account.creditLimit - this.balanceFor(account);
  }

  assets = computed(() => {
    let total = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit') continue;
      if (bal > 0) total += bal;
    }
    return total;
  });

  liabilities = computed(() => {
    let total = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit' && bal > 0) {
        total += bal;
      } else if (a.type !== 'credit' && bal < 0) {
        total += Math.abs(bal);
      }
    }
    return total;
  });

  netWorth = computed(() => this.assets() - this.liabilities());

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', {
      style: 'currency', currency: 'USD',
      maximumFractionDigits: 0   // no cents in the subtitle — cleaner
    }).format(Math.abs(n));
  }

  // Navigate to the appropriate detail page based on account type
  openAccount(account: Account) {
    if (account.type === 'credit') {
      this.router.navigate(['/accounts', account.id]);
    } else {
      this.router.navigate(['/accounts/overview', account.id]);
    }
  }

  openNewForm() {
    this.editingAccount.set(null);
    this.formOpen.set(true);
  }

  connectBank() {
    this.historyChoice.set('90');
    this.customStartDate.set('');
    this.connectChooserOpen.set(true);
  }

  private daysFromChoice(): number {
    const choice = this.historyChoice();
    if (choice === 'custom') {
      const d = this.customStartDate();
      if (!d) return 90;
      const days = Math.ceil((Date.now() - new Date(d + 'T00:00:00').getTime()) / 86_400_000);
      return Math.min(730, Math.max(1, days));
    }
    return Number(choice);
  }

  continueConnect() {
    const days = this.daysFromChoice();
    this.connectChooserOpen.set(false);
    this.plaidSvc.connectBank(days);
  }

  syncTransactions() {
    this.plaidSvc.syncTransactions();
  }

  askDisconnect(item: PlaidItem) {
    this.itemToDisconnect.set(item);
    this.disconnectOpen.set(true);
  }

  async confirmDisconnect() {
    const item = this.itemToDisconnect();
    this.disconnectOpen.set(false);
    if (item) await this.plaidSvc.disconnect(item);
    this.itemToDisconnect.set(null);
  }

  cancelDisconnect() {
    this.disconnectOpen.set(false);
    this.itemToDisconnect.set(null);
  }

  closeForm() {
    this.formOpen.set(false);
    this.editingAccount.set(null);
  }

  async handleSave(data: Omit<Account, 'id' | 'createdAt'>) {
    const editing = this.editingAccount();
    try {
      if (editing?.id) {
        await this.accountSvc.update(editing.id, data);
      } else {
        await this.accountSvc.add(data);
      }
      this.closeForm();
    } catch (err) {
      this.toastService.error('Failed to save account. Please try again.');
    }
  }

  askDelete() {
    const account = this.editingAccount();
    if (!account) return;
    this.accountToDelete.set(account);
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  async confirmDelete() {
    const account = this.accountToDelete();
    if (!account?.id) return;
    try {
      await this.accountSvc.remove(account.id);
    } catch (err) {
      this.toastService.error('Failed to delete. Please try again.');
    } finally {
      this.confirmOpen.set(false);
      this.accountToDelete.set(null);
      this.editingAccount.set(null);
    }
  }

  cancelDelete() {
    this.confirmOpen.set(false);
    this.accountToDelete.set(null);
  }
}