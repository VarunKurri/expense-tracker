import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { ManualAssetService } from '../../../services/manual-asset.service';
import { TransactionService } from '../../../services/transaction.service';
import { ToastService } from '../../../services/toast.service';
import { Modal } from '../../../components/modal/modal';
import { Confirm } from '../../../components/confirm/confirm';
import { TransactionView } from '../../../components/transaction-view/transaction-view';
import { TransactionForm } from '../../transactions/transaction-form/transaction-form';
import { AssetForm, AssetFormSave } from '../asset-form/asset-form';
import { LoanTerms, LumpSum, ManualAsset, Transaction } from '../../../models';
import {
  LoanPayment, PaymentSplit, candidatePayments, dueModeOf, schedule, countsInNetWorth, loanDirection, loanOutlook, loanPayments,
  loanState, matchTolerance,
} from '../../../utils/loans';
import { entryValueOn, manualType, withValuation } from '../../../utils/net-worth';
import { localDateString, parseLocalDate } from '../../../utils/date';

/**
 * One loan in full: what is owed, how far through it you are, what it is
 * really costing, and every payment: made, missed and still to come.
 *
 * Payments are the loan's own list (linked by hand, or recognised by its
 * matching rule); linking and un-linking here only ever writes to the loan,
 * never to the transaction, so a bank sync can't undo it.
 */
@Component({
  selector: 'app-loan-detail',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal, Confirm, TransactionView, TransactionForm, AssetForm],
  templateUrl: './loan-detail.html',
  styleUrl: './loan-detail.scss',
})
export class LoanDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  manualService = inject(ManualAssetService);
  private txService = inject(TransactionService);
  private toast = inject(ToastService);

  readonly today = localDateString();
  private id = this.route.snapshot.paramMap.get('id') ?? '';

  loan = computed(() => this.manualService.items().find(m => m.id === this.id && m.loan) ?? null);
  terms = computed(() => this.loan()?.loan ?? null);
  private txs = computed(() => this.txService.transactions());

  payments = computed<LoanPayment[]>(() => {
    const l = this.loan();
    return l ? loanPayments(l, this.txs()) : [];
  });

  state = computed(() => {
    const l = this.loan();
    return l ? loanState(l, this.txs(), this.today, this.payments()) : null;
  });

  outlook = computed(() => {
    const l = this.loan();
    return l ? loanOutlook(l, this.txs(), this.today, this.payments()) : null;
  });

  // ── Who owes whom ──────────────────────────────────────────
  lent = computed(() => !!this.loan() && loanDirection(this.loan()!.type) === 'lent');
  tracked = computed(() => !!this.loan() && !countsInNetWorth(this.loan()!));
  icon = computed(() => this.loan() ? manualType(this.loan()!.type).icon : '');

  eyebrow = computed(() => {
    const t = this.terms();
    if (!t) return '';
    const who = t.counterparty;
    if (this.tracked()) return who ? `${who} is repaying · to you` : 'Being repaid to you';
    if (this.lent()) return who ? `Owed to you by ${who}` : 'Owed to you';
    return who ? `Owed to ${who}` : 'Still owed';
  });

  /** How much of the amount borrowed has been repaid, 0–1. */
  progress = computed(() => {
    const t = this.terms(), s = this.state();
    if (!t || !s || t.amountFinanced <= 0) return 0;
    return Math.min(1, Math.max(0, (t.amountFinanced - s.principalLeft) / t.amountFinanced));
  });

  /** The one plain sentence: are things on track, and what happens next. */
  sentence = computed(() => {
    const t = this.terms(), s = this.state(), o = this.outlook();
    if (!t || !s || !o) return '';
    const verb = this.lent() ? 'received' : 'made';
    if (s.owed <= 0.004) return this.lent() ? 'Repaid in full. Nothing more to come.' : 'Paid off. Nothing left to pay.';
    if (o.behindBy > 0) {
      const months = o.missedDates.map(d => this.monthName(d));
      const one = months.length === 1;
      const which = one ? `${months[0]}'s payment`
        : months.length === 2 ? `${months[0]} and ${months[1]} payments`
        : `${months.length} payments`;
      return `${which} ${one ? "hasn't" : "haven't"} shown up yet. If ${one ? 'it was' : 'they were'} ${verb}, link ${one ? 'it' : 'them'} below.`;
    }
    const mode = dueModeOf(t);
    if (mode === 'none') {
      const pace = o.payoffDate ? ` At this pace, ${this.lent() ? 'repaid' : 'paid off'} around ${this.monthYear(o.payoffDate)}.` : '';
      return `${s.paymentsMade} of ${s.termMonths} payments ${this.lent() ? 'in' : 'made'} so far, roughly monthly.${pace}`;
    }
    if (!o.nextDue) return 'On track.';
    // Due date passed but still inside its window: on its way, not missed.
    if (o.nextIsLate) {
      return `${this.monthName(o.nextDue)}'s payment is on its way, expected by ${this.formatDate(o.nextDueBy!)}.`;
    }
    const when = mode === 'flexible'
      ? `expected around ${this.formatDate(o.nextDue)} (by ${this.formatDate(o.nextDueBy!)})`
      : `due ${this.formatDate(o.nextDue)}`;
    if (s.paymentsMade === 0) return `No payments yet. The first is ${when}.`;
    return `On track. Next payment of ${this.money(s.payment)} is ${when}.`;
  });

  /** What it bought, and what that's worth now: the other side of the loan. */
  bought = computed(() => {
    const l = this.loan();
    const other = l?.linkedId ? this.manualService.items().find(m => m.id === l.linkedId) : null;
    if (!other) return null;
    return { name: other.name, value: entryValueOn(other, this.txs(), this.today) ?? 0 };
  });

  /** The true cost of what you bought: price + all the interest over the loan. */
  trueCost = computed(() => {
    const t = this.terms(), o = this.outlook();
    if (!t || !o) return null;
    const price = t.price ?? t.amountFinanced + (t.downPayment ?? 0);
    return Math.round((price + o.lifetimeInterest) * 100) / 100;
  });

  downPayment = computed(() => this.payments().find(p => p.kind === 'down') ?? null);

  /**
   * Payments so far, newest first, with how each was split. `unusual` marks a
   * payment far from the regular amount at the time. Those are the ones worth asking
   * "was this a lump sum?" about.
   */
  made = computed(() => {
    const s = this.state(), t = this.terms();
    if (!s || !t) return [];
    const how = new Map(this.payments().map(p => [p.tx.id, p.how]));
    let inForce = t.payment;
    const rows = s.splits.map(sp => {
      const unusual = Math.abs(sp.tx.amount - inForce) > matchTolerance(inForce);
      const row = { ...sp, how: how.get(sp.tx.id) ?? 'matched', unusual, lumpNote: this.lumpNote(sp) };
      if (sp.lump) inForce = sp.lump.payment;
      return row;
    });
    return rows.reverse();
  });

  /** "Lump sum · payment lowered to $612.40" / "Lump sum · loan shortened to 20 payments". */
  private lumpNote(sp: PaymentSplit): string {
    if (!sp.lump) return '';
    return sp.lump.mode === 'reduce-emi'
      ? `Lump sum · payment lowered to ${this.money(sp.lump.payment)}`
      : `Lump sum · loan shortened to ${sp.lump.termMonths} payments`;
  }

  showAllMissed = signal(false);
  /** Three missing months is enough to make the point; the rest fold away. */
  visibleMissed = computed(() => {
    const all = this.outlook()?.missedDates ?? [];
    return this.showAllMissed() ? all : all.slice(0, 3);
  });

  /** What the payments assumed made on schedule add up to. */
  assumedTotal = computed(() => {
    const t = this.terms(), s = this.state();
    if (!t || !s?.assumedPayments) return 0;
    return Math.round(schedule(t).slice(0, s.assumedPayments).reduce((sum, r) => sum + r.payment, 0) * 100) / 100;
  });

  /** "Paid on schedule up to today": the past is settled, tracking starts now. */
  async settleToToday() {
    const l = this.loan();
    if (!l?.id || !l.loan) return;
    try {
      await this.manualService.update(l.id, { loan: { ...l.loan, settledThrough: this.today } });
      this.toast.success('Marked as paid on schedule up to today.');
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  async unsettle() {
    const l = this.loan();
    if (!l?.id || !l.loan) return;
    try {
      await this.manualService.update(l.id, { loan: { ...l.loan, settledThrough: undefined } });
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  showAllUpcoming = signal(false);
  upcoming = computed(() => {
    const rows = this.outlook()?.upcoming ?? [];
    return this.showAllUpcoming() ? rows : rows.slice(0, 6);
  });

  // ── Linking ────────────────────────────────────────────────
  /** What the picker is for: a monthly payment, or the down payment / money sent out. */
  linking = signal<'payment' | 'down' | null>(null);
  linkSearch = signal('');

  /**
   * What the picker offers. Repayments go the loan's way (money out for a
   * loan you took, money in for one you lent); a down payment or the money you
   * lent out is always money out, around the start date. Searching widens it
   * to everything of the right kind.
   */
  linkOptions = computed(() => {
    const l = this.loan();
    const mode = this.linking();
    if (!l?.loan || !mode) return [];
    const q = this.linkSearch().trim().toLowerCase();
    const taken = new Set(this.payments().map(p => p.tx.id));
    const type = mode === 'payment' && this.lent() ? 'income' : 'expense';
    const free = this.txs().filter(t => t.id && !taken.has(t.id) && t.type === type);

    let pool: Transaction[];
    if (q) {
      pool = free.filter(t =>
        `${t.merchant ?? ''} ${t.notes ?? ''}`.toLowerCase().includes(q) || t.amount.toFixed(2).includes(q));
    } else if (mode === 'payment') {
      pool = candidatePayments(l, this.txs(), 30);
    } else {
      const from = this.minusDays(l.loan.startDate, 45), to = this.plusDays(l.loan.startDate, 15);
      pool = free.filter(t => t.date >= from && t.date <= to);
    }
    return [...pool].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 40);
  });

  openLink(mode: 'payment' | 'down') { this.linkSearch.set(''); this.linking.set(mode); }
  closeLink() { this.linking.set(null); }

  async link(t: Transaction) {
    const l = this.loan();
    const mode = this.linking();
    if (!l?.id || !t.id || !mode) return;
    const terms = l.loan!;
    const patch = mode === 'down'
      ? { ...terms, downPaymentId: t.id, downPayment: t.amount }
      : { ...terms, paymentIds: [...new Set([...(terms.paymentIds ?? []), t.id])], ignoredIds: (terms.ignoredIds ?? []).filter(x => x !== t.id) };
    try {
      await this.manualService.update(l.id, { loan: patch });
      this.toast.success(mode === 'down' ? 'Down payment linked.' : 'Payment linked.');
      this.closeLink();
      // Well above the regular payment: ask what the extra should change.
      const regular = this.state()?.payment ?? terms.payment;
      if (mode === 'payment' && t.amount > regular + matchTolerance(regular)) this.openLump(t);
    } catch {
      this.toast.error('Could not link it. Please try again.');
    }
  }

  /** Un-link: a hand-linked payment comes off the list; an auto-matched one is ignored from now on. */
  async unlink(t: Transaction) {
    const l = this.loan();
    if (!l?.id || !t.id) return;
    const terms = l.loan!;
    const base = { ...terms, lumpSums: (terms.lumpSums ?? []).filter(x => x.txId !== t.id) };
    const patch = t.id === terms.downPaymentId
      ? { ...base, downPaymentId: undefined }
      : terms.paymentIds?.includes(t.id)
        ? { ...base, paymentIds: terms.paymentIds.filter(x => x !== t.id) }
        : { ...base, ignoredIds: [...new Set([...(terms.ignoredIds ?? []), t.id])] };
    try {
      await this.manualService.update(l.id, { loan: patch });
      this.toast.success('Unlinked. It still counts as a normal transaction.');
    } catch {
      this.toast.error('Could not unlink it. Please try again.');
    }
  }

  // ── Lump sums ──────────────────────────────────────────────
  /** The payment being marked as a lump sum, and the choices for it. */
  lumpTx = signal<Transaction | null>(null);
  lumpMode = signal<LumpSum['mode']>('reduce-tenure');
  lumpOnTop = signal(false);
  isLump = computed(() => !!this.lumpTx() && !!this.terms()?.lumpSums?.some(x => x.txId === this.lumpTx()!.id));

  openLump(tx: Transaction) {
    const existing = this.terms()?.lumpSums?.find(x => x.txId === tx.id);
    this.lumpMode.set(existing?.mode ?? 'reduce-tenure');
    // Another payment in the same month means this one came on top of it.
    this.lumpOnTop.set(existing ? !!existing.onTop : this.sharesMonth(tx));
    this.lumpTx.set(tx);
  }

  private sharesMonth(tx: Transaction): boolean {
    const month = tx.date.slice(0, 7);
    return (this.state()?.splits ?? []).some(sp => sp.tx.id !== tx.id && !sp.lump && sp.tx.date.slice(0, 7) === month);
  }

  /** The loan with this lump sum set as chosen, i.e. what Save would make it. */
  private withLump(l: ManualAsset, tx: Transaction, mode: LumpSum['mode'], onTop: boolean): LoanTerms {
    const t = l.loan!;
    const lump: LumpSum = { txId: tx.id!, mode, ...(onTop ? { onTop: true } : {}) };
    return {
      ...t,
      // Linked by hand, so it stays a payment whatever its amount.
      paymentIds: [...new Set([...(t.paymentIds ?? []), tx.id!])],
      ignoredIds: (t.ignoredIds ?? []).filter(x => x !== tx.id),
      lumpSums: [...(t.lumpSums ?? []).filter(x => x.txId !== tx.id), lump],
    };
  }

  /** What each choice would do: the payment from now on, when it ends, how many payments are left. */
  lumpPreview = computed(() => {
    const l = this.loan(), tx = this.lumpTx();
    if (!l?.loan || !tx?.id) return null;
    const preview = (mode: LumpSum['mode']) => {
      const asset = { ...l, loan: this.withLump(l, tx, mode, this.lumpOnTop()) };
      const pays = loanPayments(asset, this.txs());
      const s = loanState(asset, this.txs(), this.today, pays);
      const o = loanOutlook(asset, this.txs(), this.today, pays);
      return { payment: s.payment, payoff: o.payoffDate, left: o.paymentsLeft, interest: o.lifetimeInterest };
    };
    return { emi: preview('reduce-emi'), tenure: preview('reduce-tenure') };
  });

  async saveLump() {
    const l = this.loan(), tx = this.lumpTx();
    if (!l?.id || !l.loan || !tx?.id) return;
    try {
      await this.manualService.update(l.id, { loan: this.withLump(l, tx, this.lumpMode(), this.lumpOnTop()) });
      this.toast.success(this.lumpMode() === 'reduce-emi' ? 'Lump sum saved. The monthly payment is lower.' : 'Lump sum saved. The loan ends sooner.');
      this.lumpTx.set(null);
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  /** Back to an ordinary payment. */
  async removeLump() {
    const l = this.loan(), tx = this.lumpTx();
    if (!l?.id || !l.loan || !tx?.id) return;
    try {
      await this.manualService.update(l.id, { loan: { ...l.loan, lumpSums: (l.loan.lumpSums ?? []).filter(x => x.txId !== tx.id) } });
      this.toast.success('Counted as a regular payment again.');
      this.lumpTx.set(null);
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  // ── Statement balance ──────────────────────────────────────
  correcting = signal(false);
  correctionValue: number | null = null;
  correctionDate = this.today;

  openCorrection() {
    this.correctionValue = this.state()?.owed ?? null;
    this.correctionDate = this.today;
    this.correcting.set(true);
  }

  async saveCorrection() {
    const l = this.loan();
    const v = Number(this.correctionValue);
    if (!l?.id || this.correctionValue === null || !isFinite(v) || v < 0) { this.toast.error('Enter the balance from your statement.'); return; }
    if (!this.correctionDate || this.correctionDate > this.today || this.correctionDate < l.loan!.startDate) {
      this.toast.error('Pick a date between the loan start and today.');
      return;
    }
    try {
      await this.manualService.update(l.id, {
        loan: { ...l.loan!, corrections: withValuation(l.loan!.corrections ?? [], this.correctionDate, v) },
      });
      this.toast.success('Balance updated.');
      this.correcting.set(false);
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  async removeCorrection(date: string) {
    const l = this.loan();
    if (!l?.id) return;
    await this.manualService.update(l.id, {
      loan: { ...l.loan!, corrections: (l.loan!.corrections ?? []).filter(c => c.date !== date) },
    });
  }

  // ── Edit / delete the loan ─────────────────────────────────
  formOpen = signal(false);
  confirmOpen = signal(false);
  linkedName = computed(() => this.bought()?.name ?? null);

  async handleSave(save: AssetFormSave) {
    const l = this.loan();
    if (!l?.id) return;
    try {
      await this.manualService.update(l.id, { loan: undefined, purchase: undefined, depreciationRate: undefined, ...save.entry });
      this.toast.success(`${save.entry.name} saved.`);
      this.formOpen.set(false);
      // Changed into something that isn't a loan, so its page no longer applies.
      if (!save.entry.loan) this.router.navigate(['/net-worth']);
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  askDelete() { this.formOpen.set(false); this.confirmOpen.set(true); }

  async confirmDelete() {
    const l = this.loan();
    try {
      if (l?.id) {
        await this.manualService.remove(l.id);
        const other = l.linkedId ? this.manualService.items().find(m => m.id === l.linkedId) : null;
        if (other?.id) await this.manualService.update(other.id, { linkedId: undefined });
      }
      this.router.navigate(['/net-worth']);
    } catch {
      this.toast.error('Could not delete. Please try again.');
    } finally {
      this.confirmOpen.set(false);
    }
  }

  // ── The shared transaction view ────────────────────────────
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);

  editFromTxView(tx: Transaction) {
    this.viewingTx.set(null);
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  async handleTxSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const tx = this.editingTx();
    if (!tx?.id) return;
    try {
      await this.txService.update(tx.id, data);
      this.txFormOpen.set(false);
      this.editingTx.set(null);
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  back() { this.router.navigate(['/net-worth']); }

  // ── Formatting ─────────────────────────────────────────────
  money(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }

  formatDate(d: string) {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  monthName(d: string) {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'long' });
  }

  /** How an upcoming row names its date: exact, "around", or just the month. */
  dueLabel(date: string): string {
    const t = this.terms();
    const mode = t ? dueModeOf(t) : 'exact';
    if (mode === 'none') return `~${this.monthYear(date)}`;
    return mode === 'flexible' ? `Around ${this.formatDate(date)}` : this.formatDate(date);
  }

  /** The same, as a sentence: "Due Oct 24", "Due around Oct 24". */
  dueText(date: string): string {
    const t = this.terms();
    const mode = t ? dueModeOf(t) : 'exact';
    if (mode === 'none') return `Expected ${this.monthYear(date)}`;
    return `Due ${mode === 'flexible' ? 'around ' : ''}${this.formatDate(date)}`;
  }

  /** "Varies (up to 10 days late)", "No set day", or nothing for an exact day. */
  timingLabel(): string {
    const t = this.terms();
    if (!t) return '';
    const mode = dueModeOf(t);
    if (mode === 'flexible') return `Varies (up to ${t.lateDays ?? 10} days late)`;
    return mode === 'none' ? 'No set day' : '';
  }

  monthYear(d: string) {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  }

  methodLabel(): string {
    const t = this.terms();
    if (!t) return '';
    if (t.method === 'none') return 'No interest';
    return `${t.rate}% ${t.method === 'flat' ? 'flat' : 'APR'}`;
  }

  private minusDays(d: string, n: number) {
    const x = parseLocalDate(d); x.setDate(x.getDate() - n); return localDateString(x);
  }
  private plusDays(d: string, n: number) {
    const x = parseLocalDate(d); x.setDate(x.getDate() + n); return localDateString(x);
  }
}
