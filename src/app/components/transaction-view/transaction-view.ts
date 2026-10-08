import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { ToastService } from '../../services/toast.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { Router } from '@angular/router';
import { loanDirection, loanPayments, loanState } from '../../utils/loans';
import { localDateString } from '../../utils/date';
import { Modal } from '../modal/modal';
import { ManualAsset, MoneyBackSource, Transaction, UntrackedReturn } from '../../models';
import { RefundState, newReturnId } from '../../utils/money-back';
import { fromCents, toCents } from '../../utils/money';

let nextLockId = 0;

/**
 * A single transaction in full, read-only, as a centred card on desktop and a
 * sheet that rises from the bottom on a phone.
 *
 * This is the *only* transaction view in the app. It started as a copy in
 * `dashboard.html` alongside near-identical ones in `analysis.html` and
 * `transactions.html`, and the copies had drifted: only the Transactions one
 * grew reimbursement linking, so the same transaction told you a different
 * story depending on which screen you opened it from — and the one place the
 * numbers most need explaining (an expense that was partly paid back) was the
 * part that was missing everywhere else.
 *
 * It reads the transaction back out of the service rather than trusting the
 * input, which is a snapshot taken when the panel opened. Linking or unlinking
 * a reimbursement has to be visible immediately, without the caller having to
 * know to re-feed it.
 */
@Component({
  selector: 'app-transaction-view',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './transaction-view.html',
  styleUrl: './transaction-view.scss',
})
export class TransactionView {
  private categoryService = inject(CategoryService);
  private accountService = inject(AccountService);
  private toast = inject(ToastService);
  private scrollLock = inject(ScrollLockService);
  txService = inject(TransactionService);

  /** Distinct per instance, so two overlays never cancel each other's lock. */
  private lockKey = `tx-view-${nextLockId++}`;

  transaction = input<Transaction | null>(null);

  closed = output<void>();
  editRequested = output<Transaction>();

  constructor() {
    effect(onCleanup => {
      this.scrollLock.set(this.lockKey, !!this.transaction());
      // Navigating away with the panel open would otherwise leave the whole
      // app unscrollable.
      onCleanup(() => this.scrollLock.unlock(this.lockKey));
    });
  }

  /**
   * The transaction as it stands now, not as it was when the panel opened.
   * Falls back to the input while the service is still loading.
   */
  tx = computed<Transaction | null>(() => {
    const snapshot = this.transaction();
    if (!snapshot?.id) return snapshot;
    return this.txService.transactions().find(t => t.id === snapshot.id) ?? snapshot;
  });

  // ── Money back: refunds and repayments ─────────────────────
  // One section for everything that came back on a purchase — see
  // utils/money-back.ts. Tracked money back is an income linked to the expense;
  // untracked (cash, store credit) is recorded on the expense itself.

  /** Incomes linked to this expense. */
  linkedIncomes = computed(() => this.txService.linkedIncomesFor(this.tx()));

  /** Money back recorded by hand on this expense. */
  untracked = computed<UntrackedReturn[]>(() => this.tx()?.moneyBack ?? []);

  /** The old "Mark as refunded" flag, shown as a full refund until removed. */
  legacyRefund = computed(() => {
    const t = this.tx();
    return !!t?.refunded && !(t.moneyBack ?? []).some(e => e.source === 'refund');
  });

  moneyBackTotal = computed(() => {
    const t = this.tx();
    return t ? this.txService.moneyBackFor(t) : 0;
  });

  refundState = computed<RefundState>(() => {
    const t = this.tx();
    return t ? this.txService.refundState(t) : 'none';
  });

  /**
   * The part of the money back that exceeds the expense — the difference
   * between "you still spent something" and "you came out ahead".
   */
  reimbursementSurplus = computed(() => {
    const t = this.tx();
    return t ? this.txService.reimbursementSurplus(t) : 0;
  });

  netExpense = computed(() => {
    const t = this.tx();
    return t ? this.txService.effectiveExpenseAmount(t) : 0;
  });

  /** For an income that pays back an expense: the expense it pays back. */
  reimbursesExpense = computed<Transaction | null>(() => {
    const t = this.tx();
    if (t?.type !== 'income' || !t.reimbursesId) return null;
    return this.txService.transactions().find(x => x.id === t.reimbursesId) ?? null;
  });

  /** Shown on the income side too, so a surplus is visible from either end. */
  reimbursesSurplus = computed(() => {
    const exp = this.reimbursesExpense();
    return exp ? this.txService.reimbursementSurplus(exp) : 0;
  });

  reimbursesCovered = computed(() => {
    const exp = this.reimbursesExpense();
    if (!exp) return 0;
    return Math.min(exp.amount, this.txService.moneyBackFor(exp));
  });

  sourceLabel(source: MoneyBackSource): string {
    return source === 'refund' ? 'Refund' : 'Repayment';
  }

  /** A linked income's kind. Links from before refunds existed were repayments. */
  incomeSource(income: Transaction): MoneyBackSource {
    return income.moneyBackInfo?.source ?? 'repayment';
  }

  /** Fix a link's kind without unlinking and relinking. */
  async setIncomeSource(income: Transaction, source: MoneyBackSource) {
    if (!income.id || this.incomeSource(income) === source) return;
    try {
      await this.txService.update(income.id, { moneyBackInfo: { ...income.moneyBackInfo, source } });
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  saving = signal(false);

  // The "Add money back" dialog: money that never reached a tracked account
  // (cash, store credit). It asks refund or repayment because on a split bill
  // they differ — a refund lowers everyone's share, a repayment settles one
  // person's — and a bill can be split after its money back was recorded.
  draftOpen = signal(false);
  draftSource = signal<MoneyBackSource>('refund');
  /** "Everything came back": no amount or date to fill in. */
  draftFull = signal(false);
  draftAmount = signal<number | null>(null);
  draftDate = signal('');
  draftNote = signal('');

  /** What hasn't come back yet — what "The full amount / The rest" records. */
  remainingCents = computed(() => {
    const t = this.tx();
    if (!t) return 0;
    return Math.max(0, toCents(t.amount) - toCents(this.moneyBackTotal()));
  });

  openDraft() {
    this.draftOpen.set(true);
    this.draftSource.set('refund');
    this.draftFull.set(false);
    this.draftAmount.set(null);
    this.draftDate.set(localDateString());
    this.draftNote.set('');
  }

  closeDraft() {
    this.draftOpen.set(false);
  }

  async saveDraft() {
    const t = this.tx();
    if (!t?.id) return;
    const full = this.draftFull() && this.remainingCents() > 0;
    const amountCents = full ? this.remainingCents() : toCents(Number(this.draftAmount()));
    if (amountCents <= 0) { this.toast.error('Enter how much came back.'); return; }
    const date = full ? localDateString() : this.draftDate();
    if (!date) { this.toast.error('Pick the date it came back.'); return; }
    const note = this.draftNote().trim();
    const source = this.draftSource();
    const entry: UntrackedReturn = {
      id: newReturnId(), source, amountCents, date, ...(note ? { note } : {}),
    };
    const ok = await this.saveMoneyBack(t, [...(t.moneyBack ?? []), entry],
      source === 'refund' ? (full ? 'Marked as refunded.' : 'Refund added.') : (full ? 'Marked as paid back.' : 'Repayment added.'));
    if (ok) this.closeDraft();
  }

  async removeUntracked(entry: UntrackedReturn) {
    const t = this.tx();
    if (!t?.id) return;
    await this.saveMoneyBack(t, (t.moneyBack ?? []).filter(e => e.id !== entry.id), 'Removed.');
  }

  /** Clear the old flag. Nothing else used it, so the purchase simply counts again. */
  async removeLegacyRefund() {
    const t = this.tx();
    if (!t?.id) return;
    try {
      await this.txService.update(t.id, { refunded: undefined });
      this.toast.success('No longer marked as refunded.');
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  private async saveMoneyBack(t: Transaction, moneyBack: UntrackedReturn[], message: string): Promise<boolean> {
    if (!t.id || this.saving()) return false;
    this.saving.set(true);
    try {
      await this.txService.update(t.id, { moneyBack });
      this.toast.success(message);
      return true;
    } catch {
      this.toast.error('Could not save. Please try again.');
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  formatCents(cents: number): string {
    return this.formatCurrency(fromCents(cents));
  }

  // ── Loans ──────────────────────────────────────────────────
  private manualAssets = inject(ManualAssetService);
  private router = inject(Router);

  private loans = computed(() => this.manualAssets.items().filter(m => m.loan && !m.archived));

  /**
   * The loan this transaction belongs to, if any, and how it was split.
   * Worked out from the loan's own payment list, so it reads the same on
   * every page and a bank sync rewriting the transaction can't lose it.
   */
  loanLink = computed(() => {
    const tx = this.tx();
    if (!tx?.id) return null;
    const txs = this.txService.transactions();
    for (const loan of this.loans()) {
      const pays = loanPayments(loan, txs);
      const p = pays.find(x => x.tx.id === tx.id);
      if (!p) continue;
      if (p.kind === 'down') return { loan, kind: 'down' as const, how: p.how, split: null, termMonths: 0 };
      const state = loanState(loan, txs, localDateString(), pays);
      const split = state.splits.find(x => x.tx.id === tx.id) ?? null;
      return { loan, kind: 'payment' as const, how: p.how, split, termMonths: state.termMonths };
    }
    return null;
  });

  /** Loans this transaction could belong to: repayments go the loan's way. */
  loanOptions = computed(() => {
    const tx = this.tx();
    if (!tx || tx.type === 'transfer') return [];
    return this.loans().filter(l =>
      tx.type === 'expense' ? true /* a payment you made, or money you lent out */ : loanDirection(l.type) === 'lent');
  });

  linkLoanId = signal('');

  /** The loan picked in the Loan section (the only one, if there's just one). */
  selectedLoan = computed<ManualAsset | null>(() => {
    const opts = this.loanOptions();
    // Typed with null on purpose: with no loans the list is empty, and opts[0]
    // would be undefined even though TypeScript assumes an index always exists.
    return opts.find(l => l.id === this.linkLoanId()) ?? (opts.length ? opts[0] : null);
  });

  /** What this transaction can be on the selected loan. */
  loanRoles = computed(() => {
    const tx = this.tx(), loan = this.selectedLoan();
    if (!tx || !loan) return [];
    const lent = loanDirection(loan.type) === 'lent';
    if (tx.type === 'income') return [{ kind: 'payment' as const, label: 'Repayment' }];
    if (lent) return loan.loan?.owedTo === 'someone-else' ? [] : [{ kind: 'down' as const, label: 'Money I lent' }];
    return [
      { kind: 'payment' as const, label: 'Monthly payment' },
      { kind: 'down' as const, label: 'Down payment' },
    ];
  });

  async linkToLoan(kind: 'payment' | 'down') {
    const tx = this.tx();
    const loan = this.selectedLoan();
    if (!tx?.id || !loan?.id || !loan.loan) return;
    const t = loan.loan;
    const patch = kind === 'down'
      ? { ...t, downPaymentId: tx.id, downPayment: tx.amount }
      : { ...t, paymentIds: [...new Set([...(t.paymentIds ?? []), tx.id])], ignoredIds: (t.ignoredIds ?? []).filter(x => x !== tx.id) };
    try {
      await this.manualAssets.update(loan.id, { loan: patch });
      this.toast.success(`Linked to ${loan.name}.`);
    } catch {
      this.toast.error('Could not link. Please try again.');
    }
  }

  async unlinkFromLoan() {
    const link = this.loanLink();
    const tx = this.tx();
    if (!link?.loan.id || !link.loan.loan || !tx?.id) return;
    const t = { ...link.loan.loan, lumpSums: (link.loan.loan.lumpSums ?? []).filter(x => x.txId !== tx.id) };
    const patch = link.kind === 'down'
      ? { ...t, downPaymentId: undefined }
      : t.paymentIds?.includes(tx.id)
        ? { ...t, paymentIds: t.paymentIds.filter(x => x !== tx.id) }
        : { ...t, ignoredIds: [...new Set([...(t.ignoredIds ?? []), tx.id])] };
    try {
      await this.manualAssets.update(link.loan.id, { loan: patch });
      this.toast.success(`Unlinked from ${link.loan.name}.`);
    } catch {
      this.toast.error('Could not unlink. Please try again.');
    }
  }

  openLoan(loan: ManualAsset) {
    this.close();
    this.router.navigate(['/net-worth/loans', loan.id]);
  }

  // ── Link picker ────────────────────────────────────────────
  linkingFrom = signal<Transaction | null>(null);
  linkSearch = signal('');
  /** Repayment by default: a linked income is usually a friend's Venmo or Zelle. */
  linkSource = signal<MoneyBackSource>('repayment');

  /** Opposite-type transactions: an expense picks an income, and vice versa. */
  linkCandidates = computed<Transaction[]>(() => {
    const from = this.linkingFrom();
    if (!from) return [];
    const wantType = from.type === 'income' ? 'expense' : 'income';
    const q = this.linkSearch().trim().toLowerCase();
    return this.txService.transactions().filter(t =>
      t.type === wantType && t.id !== from.id &&
      // An income can only ever reimburse one expense.
      !(t.type === 'income' && !!t.reimbursesId) &&
      (!q || (t.merchant || '').toLowerCase().includes(q) || String(t.amount).includes(q))
    ).slice(0, 50);
  });

  openLinkPicker(tx: Transaction) {
    this.linkSearch.set('');
    this.linkSource.set('repayment');
    this.linkingFrom.set(tx);
  }

  closeLinkPicker() {
    this.linkingFrom.set(null);
    this.linkSearch.set('');
  }

  async confirmLink(candidate: Transaction) {
    const from = this.linkingFrom();
    if (!from) return;
    const income = from.type === 'income' ? from : candidate;
    const expense = from.type === 'expense' ? from : candidate;
    if (!income.id || !expense.id) return;
    try {
      await this.txService.update(income.id, {
        reimbursesId: expense.id,
        moneyBackInfo: { ...income.moneyBackInfo, source: this.linkSource() },
      });
      this.toast.success(this.linkSource() === 'refund' ? 'Refund linked.' : 'Repayment linked.');
      this.closeLinkPicker();
    } catch {
      this.toast.error('Could not link. Please try again.');
    }
  }

  async unlinkReimbursement(income: Transaction) {
    if (!income.id) return;
    try {
      await this.txService.update(income.id, { reimbursesId: undefined, moneyBackInfo: undefined });
      this.toast.success('Unlinked.');
    } catch {
      this.toast.error('Could not unlink. Please try again.');
    }
  }

  // ── Lookups & formatting ───────────────────────────────────
  categoryFor(id?: string) {
    return id ? this.categoryService.categories().find(c => c.id === id) ?? null : null;
  }

  accountName(id?: string): string {
    return id ? this.accountService.accounts().find(a => a.id === id)?.name ?? '' : '';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
      .format(Math.abs(n));
  }

  formatDate(date: string): string {
    return new Date(date + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  formatFullDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    // The dialogs sit on top of the panel, so Escape closes those first.
    if (this.draftOpen()) { this.closeDraft(); return; }
    if (this.linkingFrom()) { this.closeLinkPicker(); return; }
    if (this.transaction()) this.close();
  }

  close() {
    this.closeDraft();
    this.closeLinkPicker();
    this.closed.emit();
  }

  edit() {
    const t = this.tx();
    if (t) this.editRequested.emit(t);
  }
}
