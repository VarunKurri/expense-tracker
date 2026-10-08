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
import { Confirm } from '../confirm/confirm';
import { ManualAsset, ME, MoneyBackSource, Transaction, UntrackedReturn } from '../../models';
import { PersonService } from '../../services/person.service';
import { PersonSplitStatus, outstandingFor, setClosed, splitStatus } from '../../utils/splits';
import { RefundState, incomeLinks, newReturnId } from '../../utils/money-back';
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
  imports: [CommonModule, FormsModule, Modal, Confirm],
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

  /** On an expense: the incomes linked to it, with the part of each that went here. */
  links = computed(() => this.txService.linksFor(this.tx()));

  /** True when an income was spread over several bills (so its row shows the part). */
  isSpread(income: Transaction): boolean {
    return incomeLinks(income).length > 1;
  }

  /** On an income that's money back: each purchase it paid back, and how much went to each. */
  moneyBackParts = computed(() => {
    const t = this.tx();
    if (!t) return [];
    const txs = this.txService.transactions();
    return incomeLinks(t)
      .map(l => ({ expense: txs.find(x => x.id === l.expenseId), amountCents: l.amountCents }))
      .filter((p): p is { expense: Transaction; amountCents: number } => !!p.expense);
  });

  /** For an income that pays back one expense: that expense. */
  reimbursesExpense = computed<Transaction | null>(() => {
    const parts = this.moneyBackParts();
    return parts.length === 1 ? parts[0].expense : null;
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

  // ── Split: who owes what, after money back ─────────────────
  people = inject(PersonService);
  readonly ME = ME;

  /** For a split expense: everyone's share, what they owed you, and what's come back. */
  split = computed(() => {
    const t = this.tx();
    return t?.type === 'expense' && t.split ? splitStatus(t.split, this.txService.moneyBackEntriesFor(t)) : null;
  });

  /** Everyone on the bill but you. */
  splitOthers = computed(() => (this.tx()?.split?.participantIds ?? []).filter(id => id !== ME));

  /** The status line under a person's name — plain words, no chip. */
  personStatus(p: PersonSplitStatus): string {
    switch (p.state) {
      case 'owed': return 'Owes you';
      case 'partial': return `Paid back ${this.formatCents(p.repaidCents)} of ${this.formatCents(p.dueToMeCents)}`;
      case 'repaid': return 'Paid you back';
      case 'closed': return "Won't be repaid";
      default: return p.paidCents > 0 ? 'Paid their own way' : 'Nothing to pay back';
    }
  }

  /** The figure on the right: what's still owed, or — once settled — what came back. */
  personAmountCents(p: PersonSplitStatus): number {
    if (p.state === 'repaid') return p.repaidCents;
    if (p.state === 'none') return p.shareCents;
    return p.outstandingCents;
  }

  /** Rows with something to act on: record a repayment, or reopen a closed one. */
  canOpenPerson(p: PersonSplitStatus): boolean {
    return p.state === 'owed' || p.state === 'partial' || p.state === 'closed';
  }

  personAriaLabel(p: PersonSplitStatus): string {
    const name = this.people.nameOf(p.personId);
    return p.state === 'closed' ? `Reopen ${name}'s share` : `Record a repayment from ${name}`;
  }

  /** Tapping a person: record what they paid back — or, if closed, offer to reopen. */
  openPerson(p: PersonSplitStatus) {
    if (p.state === 'closed') this.reopening.set(p.personId);
    else this.openDraft(p.personId);
  }

  /** The person whose closed share is being reopened (the confirm dialog). */
  reopening = signal<string | null>(null);

  reopenMessage = computed(() => {
    const id = this.reopening();
    const p = id ? this.split()?.people.find(x => x.personId === id) : null;
    if (!p) return '';
    return `${this.formatCents(p.outstandingCents)} counts as owed to you again. It's in your spending either way until it's paid back.`;
  });

  async confirmReopen() {
    const id = this.reopening();
    this.reopening.set(null);
    if (id) await this.setPersonClosed(id, false);
  }

  /** "Won't be repaid", from the repayment dialog opened on that person. */
  async closeDraftPerson() {
    const id = this.draftPersonId();
    if (!id) return;
    await this.setPersonClosed(id, true);
    this.closeDraft();
  }

  /** "Won't be repaid" / reopen. Their share stays in your spending either way. */
  async setPersonClosed(personId: string, closed: boolean) {
    const t = this.tx();
    if (!t?.id || !t.split) return;
    try {
      await this.txService.update(t.id, { split: setClosed(t.split, personId, closed) });
      this.toast.success(closed ? `${this.people.nameOf(personId)} won't be repaying this.` : 'Reopened.');
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  /** "Repayment from Mrunaal for Mrunaal and Priya" — who and whose share, when known. */
  fromLabel(e: { fromPersonId?: string; coversPersonIds?: string[] }): string {
    if (!e.fromPersonId) return '';
    const from = this.people.nameOf(e.fromPersonId);
    const covers = (e.coversPersonIds ?? []).filter(id => id !== e.fromPersonId);
    return covers.length
      ? ` from ${from} for ${[e.fromPersonId, ...covers].map(id => id === e.fromPersonId ? from : this.people.nameOf(id)).join(', ')}`
      : ` from ${from}`;
  }

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
  /** On a split bill, a repayment says who it's from and whose shares it covers. */
  draftFrom = signal('');
  draftCovers = signal<string[]>([]);
  /** Once the amount is typed, choosing people stops re-filling it. */
  private draftAmountTyped = false;
  /** Opened from a person's row: whose — so the footer can offer "Won't be repaid". */
  draftPersonId = signal<string | null>(null);

  /** Asking "from whom" only makes sense on a split bill, for a repayment. */
  askWho = computed(() => !!this.split() && this.draftSource() === 'repayment');
  /** The same question in the link picker, when linking from a split expense. */
  askLinkWho = computed(() =>
    !!this.split() && this.linkSource() === 'repayment' && this.linkingFrom()?.type === 'expense');

  /** What hasn't come back yet — what "The full amount / The rest" records. */
  remainingCents = computed(() => {
    const t = this.tx();
    if (!t) return 0;
    return Math.max(0, toCents(t.amount) - toCents(this.moneyBackTotal()));
  });

  /** Opened from a person's row, it's a repayment from them, filled in with what they owe. */
  openDraft(fromPersonId?: string) {
    this.draftOpen.set(true);
    this.draftPersonId.set(fromPersonId ?? null);
    this.draftSource.set(fromPersonId ? 'repayment' : 'refund');
    this.draftFull.set(false);
    this.draftAmount.set(null);
    this.draftDate.set(localDateString());
    this.draftNote.set('');
    this.draftAmountTyped = false;
    const from = fromPersonId ?? this.firstOwing();
    this.draftFrom.set(from);
    this.draftCovers.set(from ? [from] : []);
    if (fromPersonId) this.prefillRepayment();
  }

  setDraftSource(source: MoneyBackSource) {
    this.draftSource.set(source);
    if (this.askWho()) this.prefillRepayment();
  }

  setDraftAmount(value: number | null) {
    this.draftAmountTyped = true;
    this.draftAmount.set(value);
  }

  /** Changing who it's from: by default it covers just them. */
  setDraftFrom(personId: string) {
    this.draftFrom.set(personId);
    this.draftCovers.set([personId]);
    this.prefillRepayment();
  }

  toggleCover(personId: string) {
    this.draftCovers.update(ids => ids.includes(personId) ? ids.filter(id => id !== personId) : [...ids, personId]);
    this.prefillRepayment();
  }

  /** Whoever still owes, first — the likeliest person to be paying you back. */
  private firstOwing(): string {
    const s = this.split();
    return s?.people.find(p => p.outstandingCents > 0 && p.state !== 'closed')?.personId ?? this.splitOthers()[0] ?? '';
  }

  /** Fill the amount with what the covered people still owe, until it's typed by hand. */
  private prefillRepayment() {
    const s = this.split();
    if (!s || this.draftAmountTyped) return;
    const owed = outstandingFor(s, this.draftCovers());
    this.draftAmount.set(owed > 0 ? fromCents(owed) : null);
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
    if (this.askWho() && !this.draftFrom()) { this.toast.error('Choose who paid you back.'); return; }
    const entry: UntrackedReturn = {
      id: newReturnId(), source, amountCents, date, ...(note ? { note } : {}), ...this.whoFields(source),
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

  /** From / covers, for a repayment on a split bill; nothing otherwise. */
  private whoFields(source: MoneyBackSource): { fromPersonId?: string; coversPersonIds?: string[] } {
    if (!this.split() || source !== 'repayment' || !this.draftFrom()) return {};
    const covers = this.draftCovers().length ? this.draftCovers() : [this.draftFrom()];
    return { fromPersonId: this.draftFrom(), coversPersonIds: covers };
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
      !this.txService.isMoneyBackIncome(t) &&
      (!q || (t.merchant || '').toLowerCase().includes(q) || String(t.amount).includes(q))
    ).slice(0, 50);
  });

  openLinkPicker(tx: Transaction) {
    this.linkSearch.set('');
    this.linkSource.set('repayment');
    // Linking from a split expense asks who it was from, as "Add money back" does.
    const from = this.firstOwing();
    this.draftFrom.set(from);
    this.draftCovers.set(from ? [from] : []);
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
      const who = from.type === 'expense' ? this.whoFields(this.linkSource()) : {};
      await this.txService.update(income.id, {
        reimbursesId: expense.id,
        moneyBackInfo: { ...income.moneyBackInfo, source: this.linkSource(), ...who },
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
      // A payment spread over several bills unlinks as a whole, so its parts always
      // add up to what was actually paid.
      const bills = incomeLinks(income).length;
      await this.txService.update(income.id, { reimbursesId: undefined, moneyBackSplits: undefined, moneyBackInfo: undefined });
      this.toast.success(bills > 1 ? `Unlinked from ${bills} bills.` : 'Unlinked.');
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
