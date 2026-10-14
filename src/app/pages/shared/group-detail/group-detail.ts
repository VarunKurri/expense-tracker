import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { GroupPayment, ME, SharedBill, Transaction } from '../../../models';
import { GroupService } from '../../../services/group.service';
import { SharedBillService } from '../../../services/shared-bill.service';
import { PersonService } from '../../../services/person.service';
import { TransactionService } from '../../../services/transaction.service';
import { ToastService } from '../../../services/toast.service';
import { Confirm } from '../../../components/confirm/confirm';
import { Modal } from '../../../components/modal/modal';
import { GroupForm } from '../../../components/group-form/group-form';
import { SharedBillForm } from '../../../components/shared-bill-form/shared-bill-form';
import { SharedBillView } from '../../../components/shared-bill-view/shared-bill-view';
import { TransactionView } from '../../../components/transaction-view/transaction-view';
import { TransactionForm } from '../../transactions/transaction-form/transaction-form';
import { formatCurrency } from '../../../utils/format';
import { fromCents, toCents } from '../../../utils/money';
import { newReturnId } from '../../../utils/money-back';
import { localDateString } from '../../../utils/date';
import { GroupBill, GroupMove, UnassignedPayment, groupLedger, unassignedPayments } from '../../../utils/groups';
import type { Transfer } from '../../../utils/split/types';

/**
 * One group (a trip, a flat): where you stand, how to settle up, everyone's
 * balance, and the bills in it. The figures are `groupLedger()`
 * (utils/groups.ts); nothing here adds money up.
 */
@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [FormsModule, Modal, Confirm, GroupForm, SharedBillForm, SharedBillView, TransactionView, TransactionForm],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.scss',
})
export class GroupDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  groups = inject(GroupService);
  sharedBills = inject(SharedBillService);
  people = inject(PersonService);
  txService = inject(TransactionService);
  private toast = inject(ToastService);

  private id = toSignal(this.route.paramMap.pipe(map(p => p.get('id') ?? '')), { initialValue: '' });
  group = computed(() => this.groups.byId(this.id()));

  ledger = computed(() => {
    const g = this.group();
    return g ? groupLedger(g, this.txService.transactions(), this.sharedBills.bills(), t => this.txService.moneyBackEntriesFor(t)) : null;
  });

  /** Money back on the group's expenses that doesn't say who sent it. */
  unassigned = computed(() => {
    const g = this.group();
    return g ? unassignedPayments(g.id, this.txService.transactions(), t => this.txService.linksFor(t)) : [];
  });

  /** Say who a payment came from, so the group credits the right person. */
  async assignPayment(p: UnassignedPayment, personId: string) {
    if (!personId) return;
    const who = { fromPersonId: personId, coversPersonIds: [personId] };
    try {
      if (p.income?.id) {
        await this.txService.update(p.income.id, {
          moneyBackInfo: { source: p.income.moneyBackInfo?.source ?? 'repayment', ...who },
        });
      } else if (p.expense?.id && p.entryId) {
        await this.txService.update(p.expense.id, {
          moneyBack: (p.expense.moneyBack ?? []).map(e => (e.id === p.entryId ? { ...e, ...who } : e)),
        });
      }
      this.toast.success(`Credited ${this.money(p.amountCents)} to ${this.name(personId)}.`);
    } catch {
      this.toast.error('Could not save. Please try again.');
    }
  }

  /** You, then the members, with where each stands. */
  balances = computed(() => this.ledger()?.balances ?? []);

  /** "Oct 3 – Oct 6 · You, Alex, Ben and Cara" */
  meta = computed(() => {
    const g = this.group();
    if (!g) return '';
    const names = ['You', ...g.memberIds.map(id => this.people.nameOf(id))];
    const who = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
    const when = g.startDate && g.endDate ? `${this.formatDate(g.startDate)} – ${this.formatDate(g.endDate)}`
      : g.startDate ? `From ${this.formatDate(g.startDate)}` : g.endDate ? `Until ${this.formatDate(g.endDate)}` : '';
    return [when, who].filter(Boolean).join(' · ');
  });

  // ── Wording ────────────────────────────────────────────────
  name(id: string): string {
    return id === ME ? 'You' : this.people.nameOf(id);
  }

  /** "Ben pays you" / "You pay Ben" / "Alex pays Ben" */
  transferText(t: Transfer): string {
    if (t.fromPersonId === ME) return `You pay ${this.name(t.toPersonId)}`;
    return `${this.name(t.fromPersonId)} pays ${t.toPersonId === ME ? 'you' : this.name(t.toPersonId)}`;
  }

  balanceText(netCents: number, id: string): string {
    if (netCents === 0) return 'Square';
    const you = id === ME;
    return netCents > 0
      ? `${you ? 'You get back' : 'Gets back'} ${this.money(netCents)}`
      : `${you ? 'You owe' : 'Owes'} ${this.money(-netCents)}`;
  }

  /** "You paid $120.00 · your share $30.00" */
  billNote(b: GroupBill): string {
    if (b.totalCents === 0) return 'Refunded in full · no shares';
    const payers = b.paidByIds.map(id => (id === ME ? 'You' : this.people.nameOf(id)));
    const paid = payers.length ? `${payers.join(' and ')} paid ${this.money(b.totalCents)}` : this.money(b.totalCents);
    return `${paid} · your share ${this.money(b.myShareCents)}`;
  }

  // ── Payments between friends ───────────────────────────────
  // Payments to or from you live on your own transactions (money back, or a
  // settle-up expense), so these are only between two other members: what
  // Splitwise lists as "Priya paid Nikhilesh $146.10".
  paymentOpen = signal(false);
  /** The payment being edited; null when recording a new one. */
  editingPayment = signal<GroupPayment | null>(null);
  payFrom = signal('');
  payTo = signal('');
  payAmount = signal<number | null>(null);
  payDate = signal(localDateString());
  payNote = signal('');
  payConfirm = signal(false);

  /** "Priya paid Nikhilesh" / "Vybhav paid you" / "You paid Ben" */
  moveText(m: GroupMove): string {
    if (m.fromPersonId === ME) return `You paid ${this.name(m.toPersonId)}`;
    return `${this.name(m.fromPersonId)} paid ${m.toPersonId === ME ? 'you' : this.name(m.toPersonId)}`;
  }

  /** A suggested payment between two friends can be marked paid; yours come in your transactions. */
  canMark(t: Transfer): boolean {
    return t.fromPersonId !== ME && t.toPersonId !== ME;
  }

  recordPayment(prefill?: Transfer) {
    this.editingPayment.set(null);
    this.payFrom.set(prefill?.fromPersonId ?? '');
    this.payTo.set(prefill?.toPersonId ?? '');
    this.payAmount.set(prefill ? fromCents(prefill.amountCents) : null);
    this.payDate.set(localDateString());
    this.payNote.set('');
    this.paymentOpen.set(true);
  }

  editPayment(m: GroupMove) {
    const p = this.group()?.payments.find(x => x.id === m.paymentId);
    if (!p) return;
    this.editingPayment.set(p);
    this.payFrom.set(p.fromPersonId);
    this.payTo.set(p.toPersonId);
    this.payAmount.set(fromCents(p.amountCents));
    this.payDate.set(p.date);
    this.payNote.set(p.note ?? '');
    this.paymentOpen.set(true);
  }

  async savePayment() {
    const g = this.group();
    if (!g) return;
    const from = this.payFrom(), to = this.payTo();
    const cents = toCents(Number(this.payAmount()) || 0);
    if (!from || !to) { this.toast.error('Choose who paid and who they paid.'); return; }
    if (from === to) { this.toast.error('Someone can’t pay themselves.'); return; }
    if (cents <= 0) { this.toast.error('Enter how much they paid.'); return; }
    const note = this.payNote().trim();
    const editing = this.editingPayment();
    const payment: GroupPayment = {
      id: editing?.id ?? newReturnId(), fromPersonId: from, toPersonId: to, amountCents: cents,
      date: this.payDate() || localDateString(), ...(note ? { note } : {}),
    };
    const payments = editing
      ? g.payments.map(p => (p.id === editing.id ? payment : p))
      : [...(g.payments ?? []), payment];
    try {
      await this.groups.update(g.id, { payments });
      this.paymentOpen.set(false);
    } catch {
      this.toast.error('Could not save the payment. Please try again.');
    }
  }

  async deletePayment() {
    const g = this.group(), editing = this.editingPayment();
    this.payConfirm.set(false);
    if (!g || !editing) return;
    try {
      await this.groups.update(g.id, { payments: g.payments.filter(p => p.id !== editing.id) });
      this.paymentOpen.set(false);
    } catch {
      this.toast.error('Could not delete the payment. Please try again.');
    }
  }

  // ── Editing the group ──────────────────────────────────────
  editing = signal(false);

  onDeleted() {
    this.editing.set(false);
    this.router.navigate(['/shared']);
  }

  // ── A bill: view, edit, delete ─────────────────────────────
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  private txToDelete = signal<Transaction | null>(null);

  /** Your expense opens the details sheet; a bill someone else paid opens to edit. */
  openBill(b: GroupBill) {
    if (b.tx) this.viewingTx.set(b.tx);
    else if (b.bill) this.openOtherPaid(b.bill);
  }

  // ── Bills someone else paid ────────────────────────────────
  billFormOpen = signal(false);
  editingBill = signal<SharedBill | null>(null);

  addOtherPaid() {
    this.editingBill.set(null);
    this.billFormOpen.set(true);
  }

  /** A bill someone else paid opens read-only; Edit takes it to the form. */
  viewingBill = signal<SharedBill | null>(null);

  openOtherPaid(bill: SharedBill) {
    this.viewingBill.set(bill);
  }

  editOtherPaid(bill: SharedBill) {
    this.viewingBill.set(null);
    this.editingBill.set(bill);
    this.billFormOpen.set(true);
  }

  closeBillForm() {
    this.billFormOpen.set(false);
    this.editingBill.set(null);
  }

  editFromTxView(tx: Transaction) {
    this.viewingTx.set(null);
    this.editingTx.set(tx);
    this.txFormOpen.set(true);
  }

  closeTxForm() { this.txFormOpen.set(false); this.editingTx.set(null); }

  async handleTxSave(data: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const tx = this.editingTx();
    if (!tx?.id) return;
    try { await this.txService.update(tx.id, data); this.closeTxForm(); }
    catch { this.toast.error('Could not save. Please try again.'); }
  }

  askTxDelete() {
    this.txToDelete.set(this.editingTx());
    this.txFormOpen.set(false);
    this.txConfirmOpen.set(true);
  }

  async confirmTxDelete() {
    const tx = this.txToDelete();
    if (!tx?.id) return;
    try { await this.txService.remove(tx.id); }
    catch { this.toast.error('Could not delete. Please try again.'); }
    finally {
      this.txConfirmOpen.set(false);
      this.txToDelete.set(null);
      this.editingTx.set(null);
    }
  }

  back() { this.router.navigate(['/shared']); }

  // ── Formatting ─────────────────────────────────────────────
  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }

  formatDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  abs(n: number) { return Math.abs(n); }
}
