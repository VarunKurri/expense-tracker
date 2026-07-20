import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { BillService } from '../../services/bill.service';
import { AccountForm } from './account-form/account-form';
import { AccountCard } from './account-card/account-card';
import { SummaryBar } from './summary-bar/summary-bar';
import { Confirm } from '../../components/confirm/confirm';
import { Modal } from '../../components/modal/modal';
import { ErrorBanner } from '../../components/error-banner/error-banner';
import { Account, Bill } from '../../models';
import { ToastService } from '../../services/toast.service';
import { PlaidService, PlaidItem } from '../../services/plaid.service';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, FormsModule, AccountForm, AccountCard, SummaryBar, Confirm, Modal, ErrorBanner],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss'
})
export class Accounts {
  private router = inject(Router);
  private toastService = inject(ToastService);
  accountSvc     = inject(AccountService);
  transactionSvc = inject(TransactionService);
  billSvc        = inject(BillService);
  plaidSvc       = inject(PlaidService);

  formOpen        = signal(false);
  editingAccount  = signal<Account | null>(null);
  confirmOpen     = signal(false);
  accountToDelete = signal<Account | null>(null);

  // Safeguard: bills still pointing at the account being deleted, and where to
  // move them so a future "Pay bill" doesn't silently attach to a hidden account.
  affectedBills    = signal<Bill[]>([]);
  reassignAccountId = signal<string>('');

  // Optional: also delete every transaction on the account being removed (used to
  // clean up a manual duplicate account once its data lives on a Plaid account).
  deleteTransactionsToo = signal(false);

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

  refreshInstitutions() {
    this.plaidSvc.refreshInstitutions();
  }

  reconnectItem(item: PlaidItem) {
    this.plaidSvc.reconnect(item);
  }

  /** Friendly label for an item's raw Plaid status. */
  statusLabel(item: PlaidItem): string {
    if (item.status === 'login_required') return 'Needs reconnect';
    if (item.status === 'error') return 'Sync error';
    return item.status || '';
  }

  needsReconnect(item: PlaidItem): boolean {
    return item.status === 'login_required' || item.status === 'error';
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
    this.affectedBills.set(this.billSvc.bills().filter(b => b.accountId === account.id));
    this.reassignAccountId.set('');
    this.deleteTransactionsToo.set(false);
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  // Other active accounts a bill could move to instead of being left unlinked.
  reassignOptions = computed(() =>
    this.activeAccounts().filter(a => a.id !== this.accountToDelete()?.id)
  );

  // Every transaction that touches the account being deleted — as its account, or
  // as either side of a transfer. Shown for review and removed if the user opts in.
  accountTransactions = computed(() => {
    const id = this.accountToDelete()?.id;
    if (!id) return [];
    return this.transactionSvc.transactions().filter(t =>
      t.accountId === id || t.fromAccountId === id || t.toAccountId === id
    );
  });

  async confirmDelete() {
    const account = this.accountToDelete();
    if (!account?.id) return;
    try {
      const bills = this.affectedBills();
      if (bills.length > 0) {
        const newAccountId = this.reassignAccountId() || undefined;
        for (const b of bills) {
          if (b.id) await this.billSvc.update(b.id, { accountId: newAccountId });
        }
      }
      if (this.deleteTransactionsToo()) {
        const ids = this.accountTransactions().map(t => t.id).filter((id): id is string => !!id);
        if (ids.length > 0) await this.transactionSvc.removeMany(ids);
      }
      await this.accountSvc.remove(account.id);
    } catch (err) {
      this.toastService.error('Failed to delete. Please try again.');
    } finally {
      this.confirmOpen.set(false);
      this.accountToDelete.set(null);
      this.affectedBills.set([]);
      this.deleteTransactionsToo.set(false);
      this.editingAccount.set(null);
    }
  }

  cancelDelete() {
    this.confirmOpen.set(false);
    this.accountToDelete.set(null);
    this.affectedBills.set([]);
    this.deleteTransactionsToo.set(false);
  }
}