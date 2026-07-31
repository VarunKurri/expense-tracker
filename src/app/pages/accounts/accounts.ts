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
import { monthActivityForAccount } from '../../utils/finance';

type CardDueStatus = 'paid' | 'overdue' | 'due' | 'no-date';
interface CardDue {
  account: Account;
  amount: number;
  status: CardDueStatus;
  dueDate: string | null;
  paidDate: string | null;
  // 'statement' = Plaid Liabilities (statement balance); 'balance' = current balance
  // owed, used when the bank doesn't share Liabilities (e.g. Discover) + a manual due day.
  source: 'statement' | 'balance';
}

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
  Math = Math;

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

  // "YYYY-MM" for the current calendar month, local time.
  private currentMonth = (() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  })();

  monthActivityFor(account: Account): { in: number; out: number } {
    return monthActivityForAccount(this.transactionSvc.transactions(), account.id!, this.currentMonth);
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

  /** Exact currency (with cents) — for the credit-card payment amounts. */
  formatMoney(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }

  // ── Credit-card payments strip ─────────────────────────────
  // Upcoming/recent card payments for each linked credit card. Two tiers:
  //  • statement: the bank shares Liabilities (statement balance, due date, payment
  //    history) → we show the statement balance and a Paid/Due/Overdue status.
  //  • balance:   the bank doesn't share Liabilities (e.g. Discover) → we fall back to
  //    the current balance owed + the due date the user set on the card (or prompt for
  //    one). No paid-detection there, since the bank gives us no payment signal.
  creditCardDues = computed<CardDue[]>(() => {
    const rank: Record<CardDueStatus, number> = { overdue: 0, due: 1, 'no-date': 2, paid: 3 };
    return this.accountSvc.accounts()
      .filter(a => !a.archived && a.type === 'credit' && !!a.plaidAccountId)
      .map(a => this.toCardDue(a))
      .filter((d): d is CardDue => d !== null)
      .sort((x, y) => rank[x.status] - rank[y.status] || (x.dueDate ?? '').localeCompare(y.dueDate ?? ''));
  });

  private toCardDue(a: Account): CardDue | null {
    // Tier 1 — Plaid Liabilities available.
    if (a.statementBalance != null && a.statementBalance > 0 && a.paymentDueDate) {
      const paid = this.isStatementPaid(a);
      const status: CardDueStatus = paid ? 'paid'
        : a.statementOverdue === true ? 'overdue'
        : a.statementOverdue === false ? 'due'
        : this.daysUntil(a.paymentDueDate) < 0 ? 'overdue' : 'due';
      return {
        account: a, amount: a.statementBalance, dueDate: a.paymentDueDate,
        status, paidDate: paid ? (a.lastPaymentDate ?? null) : null, source: 'statement',
      };
    }
    // Tier 2 — no Liabilities: current balance owed + the user's manual due day.
    const owed = this.balanceFor(a); // credit: positive = owed
    if (owed <= 0) return null;
    const dueDate = a.paymentDueDay ? this.nextDueFromDay(a.paymentDueDay) : null;
    return {
      account: a, amount: owed, dueDate,
      status: dueDate ? 'due' : 'no-date', paidDate: null, source: 'balance',
    };
  }

  /** Statement is paid when a payment posted on/after it closed, covering ~the full balance. */
  private isStatementPaid(a: Account): boolean {
    if (!a.lastPaymentDate || !a.statementIssueDate || a.statementBalance == null) return false;
    if (a.lastPaymentDate < a.statementIssueDate) return false;
    return (a.lastPaymentAmount ?? 0) >= a.statementBalance - 0.01;
  }

  /** Next calendar occurrence of a day-of-month (1-31), as YYYY-MM-DD, local time. */
  private nextDueFromDay(day: number): string {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const daysIn = (y: number, m: number) => new Date(y, m + 1, 0).getDate();
    const mk = (y: number, m: number) => new Date(y, m, Math.min(day, daysIn(y, m)));
    let y = today.getFullYear(), m = today.getMonth();
    let cand = mk(y, m);
    if (cand.getTime() < today.getTime()) { m++; if (m > 11) { m = 0; y++; } cand = mk(y, m); }
    const mm = String(cand.getMonth() + 1).padStart(2, '0');
    const dd = String(cand.getDate()).padStart(2, '0');
    return `${cand.getFullYear()}-${mm}-${dd}`;
  }

  daysUntil(date: string): number {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    return Math.round((new Date(date + 'T00:00:00').getTime() - today.getTime()) / 86_400_000);
  }

  /** Short date, e.g. "Jul 22" — for the "Paid <date>" pill. */
  formatShort(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  /** Relative due label, e.g. "Due in 5d" / "Due today" / "Due Jul 23". */
  dueDateLabel(date: string): string {
    const d = this.daysUntil(date);
    if (d < 0) return `${Math.abs(d)}d overdue`;
    if (d === 0) return 'Due today';
    if (d === 1) return 'Due tomorrow';
    if (d <= 30) return `Due in ${d}d`;
    return `Due ${this.formatShort(date)}`;
  }

  /** Open the edit form for a card so the user can add a due date (Discover case). */
  openEditForm(account: Account) {
    this.editingAccount.set(account);
    this.formOpen.set(true);
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
    // Snapshot before the awaited bill-reassignment loop below — these are computed()s
    // over live data, so re-reading them afterward could pick up transactions/settings
    // that changed (e.g. a sync landing) while the loop was in flight.
    const bills = this.affectedBills();
    const deleteTransactionsToo = this.deleteTransactionsToo();
    const transactionIds = this.accountTransactions().map(t => t.id).filter((id): id is string => !!id);
    try {
      if (bills.length > 0) {
        const newAccountId = this.reassignAccountId() || undefined;
        for (const b of bills) {
          if (b.id) await this.billSvc.update(b.id, { accountId: newAccountId });
        }
      }
      if (deleteTransactionsToo && transactionIds.length > 0) {
        await this.transactionSvc.removeMany(transactionIds);
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