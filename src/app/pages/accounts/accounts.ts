import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountForm } from './account-form/account-form';
import { AccountCard } from './account-card/account-card';
import { SummaryBar } from './summary-bar/summary-bar';
import { Confirm } from '../../components/confirm/confirm';
import { Account } from '../../models';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, AccountForm, AccountCard, SummaryBar, Confirm],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss'
})
export class Accounts {
  accountSvc    = inject(AccountService);
  transactionSvc = inject(TransactionService);

  formOpen       = signal(false);
  editingAccount = signal<Account | null>(null);
  confirmOpen    = signal(false);
  accountToDelete = signal<Account | null>(null);

  activeAccounts = computed(() =>
    this.accountSvc.accounts().filter(a => !a.archived)
  );

  balanceFor(account: Account): number {
    return (account.openingBalance || 0) + this.transactionSvc.balanceForAccount(account.id!);
  }

  assets = computed(() => {
    let total = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (bal > 0) total += bal;
    }
    return total;
  });

  liabilities = computed(() => {
    let total = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (bal < 0) total += Math.abs(bal);
    }
    return total;
  });

  openNewForm() {
    this.editingAccount.set(null);
    this.formOpen.set(true);
  }

  openEditForm(account: Account) {
    this.editingAccount.set(account);
    this.formOpen.set(true);
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
      alert('Failed to save account: ' + (err as Error).message);
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
      alert('Failed to delete: ' + (err as Error).message);
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
