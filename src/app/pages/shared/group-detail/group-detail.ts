import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { GroupPayment, ME, SharedBill, Transaction, UntrackedReturn } from '../../../models';
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
import { TransactionPicker } from '../../../components/transaction-picker/transaction-picker';
import { formatCurrency } from '../../../utils/format';
import { fromCents, toCents } from '../../../utils/money';
import { isMoneyBackIncome, newReturnId } from '../../../utils/money-back';
import { localDateString } from '../../../utils/date';
import { GroupBill, GroupMove, UnassignedPayment, groupByCategory, groupLedger, spreadReceived, unassignedPayments } from '../../../utils/groups';
import { CategoryService } from '../../../services/category.service';
import type { Transfer } from '../../../utils/split/types';

/**
 * One group (a trip, a flat): where you stand, how to settle up, everyone's
 * balance, and the bills in it. The figures are `groupLedger()`
 * (utils/groups.ts); nothing here adds money up.
 */
@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [FormsModule, Modal, Confirm, GroupForm, SharedBillForm, SharedBillView, TransactionView, TransactionForm, TransactionPicker],
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

  // ── Where it went ──────────────────────────────────────────
  private categoryService = inject(CategoryService);

  /** Every bill by category, biggest first, with a bar against the biggest. */
  byCategory = computed(() => {
    const rows = groupByCategory(this.ledger()?.bills ?? []);
    const top = rows[0]?.totalCents ?? 0;
    const cats = this.categoryService.categories();
    return rows.map(r => {
      const cat = r.categoryId ? cats.find(c => c.id === r.categoryId) : undefined;
      return { ...r, key: r.categoryId ?? '', name: cat?.name ?? 'Uncategorized', icon: cat?.icon ?? '',
               pct: top ? Math.round((r.totalCents / top) * 100) : 0 };
    });
  });

  /** The category opened to show its bills ('' is Uncategorized); null when none is. */
  openCategory = signal<string | null>(null);

  toggleCategory(key: string) {
    this.openCategory.update(open => (open === key ? null : key));
  }

  /** A category's bills, newest first; each opens its sheet, where it can be edited. */
  categoryBills(key: string): GroupBill[] {
    return (this.ledger()?.bills ?? []).filter(b => (b.categoryId ?? '') === key && b.totalCents > 0);
  }

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

  // ── Payments ───────────────────────────────────────────────
  // Any member can pay any member any amount, and the balances follow, so
  // whatever Splitwise told people to send can be recorded as it happened.
  // Where each one lives depends on who's in it:
  //   - to you, by bank: the income (Zelle, Venmo…), linked as money back on
  //     your group expenses, so it stops counting as income and your spending
  //     drops to your share.
  //   - to you, in cash: money back on those same expenses, recorded by hand.
  //   - from you, by bank: the expense, marked as settling up with them.
  //   - from you in cash, or between two friends: on the group.
  paymentOpen = signal(false);
  /** A payment recorded on the group, being edited; null when recording a new one. */
  editingPayment = signal<GroupPayment | null>(null);
  payFrom = signal('');
  payTo = signal('');
  /** Payments to or from you: a transaction in your accounts, or not. */
  payHow = signal<'bank' | 'cash'>('bank');
  payIncomeId = signal('');
  payExpenseId = signal('');
  payAmount = signal<number | null>(null);
  payDate = signal(localDateString());
  payNote = signal('');
  payConfirm = signal(false);
  saving = signal(false);

  /** Who's in the dialog's "who paid" and "paid" lists: you, then the members. */
  everyone = computed(() => [ME, ...(this.group()?.memberIds ?? [])]);

  /** `received` (to you), `sent` (from you) or `between` (two friends). */
  payKind = computed<GroupMove['kind']>(() =>
    this.payFrom() === ME ? 'sent' : this.payTo() === ME ? 'received' : 'between');

  /** Whether the payment is a transaction in your accounts, which then says the amount. */
  payByBank = computed(() => !this.editingPayment() && this.payKind() !== 'between' && this.payHow() === 'bank');

  /** What Settle up suggested, if the dialog was opened from it: a payment of that amount is listed first. */
  paySuggestedCents = signal(0);

  /** Bank payments that could be money you got: incomes not already money back. The picker searches them. */
  incomeChoices = computed(() => this.txService.transactions()
    .filter(t => t.type === 'income' && !t.isInternalTransfer && !isMoneyBackIncome(t)));

  /** Expenses that could be money you sent: not split, not already settling up. */
  expenseChoices = computed(() => this.txService.transactions()
    .filter(t => t.type === 'expense' && !t.isInternalTransfer && !t.split && !t.settlement));

  private chosenIncome = computed(() => this.incomeChoices().find(t => t.id === this.payIncomeId()) ?? null);
  private chosenExpense = computed(() => this.expenseChoices().find(t => t.id === this.payExpenseId()) ?? null);

  payCents = computed(() => {
    if (this.payByBank()) {
      const t = this.payKind() === 'received' ? this.chosenIncome() : this.chosenExpense();
      return t ? toCents(t.amount) : 0;
    }
    return toCents(Number(this.payAmount()) || 0);
  });

  /** "After this, Vybhav owes $8.22.": paying more or less than suggested is fine, the balance just follows. */
  payAfter = computed(() => {
    const from = this.payFrom(), to = this.payTo(), cents = this.payCents();
    if (!from || !to || from === to || cents <= 0) return '';
    const who = from === ME ? to : from;
    const before = this.balances().find(b => b.personId === who)?.netCents ?? 0;
    const old = this.editingPayment();
    const undo = !old ? 0 : old.fromPersonId === who ? -old.amountCents : old.toPersonId === who ? old.amountCents : 0;
    const after = before + undo + (who === from ? cents : -cents);
    const name = this.name(who);
    if (after === 0) return `After this, ${name} is square.`;
    return after < 0 ? `After this, ${name} still owes ${this.money(-after)}.` : `After this, ${name} gets back ${this.money(after)}.`;
  });

  /** "Priya paid Nikhilesh" / "Vybhav paid you" / "You paid Ben" */
  moveText(m: GroupMove): string {
    if (m.fromPersonId === ME) return `You paid ${this.name(m.toPersonId)}`;
    return `${this.name(m.fromPersonId)} paid ${m.toPersonId === ME ? 'you' : this.name(m.toPersonId)}`;
  }

  /** How it was paid, for the Payments list: "Zelle from VYBHAV J", "Cash", "Not in your accounts". */
  moveVia(m: GroupMove): string {
    const txs = this.txService.transactions();
    if (m.guessed) return 'a guess: pick who sent it above';
    if (m.incomeId) return txs.find(t => t.id === m.incomeId)?.merchant || 'A bank payment';
    if (m.kind === 'sent' && m.txId) return txs.find(t => t.id === m.txId)?.merchant || 'A bank payment';
    if (m.paymentId) {
      const note = this.group()?.payments.find(p => p.id === m.paymentId)?.note;
      return m.kind === 'between' ? (note ?? '') : [note, 'not in your accounts'].filter(Boolean).join(' · ');
    }
    return 'cash';
  }

  /** Suggested payments can be recorded straight from Settle up. */
  markLabel(t: Transfer): string {
    return t.fromPersonId !== ME && t.toPersonId !== ME ? 'Mark as paid' : 'Record';
  }

  recordPayment(prefill?: Transfer) {
    this.editingPayment.set(null);
    this.payFrom.set(prefill?.fromPersonId ?? '');
    this.payTo.set(prefill?.toPersonId ?? '');
    this.payHow.set('bank');
    this.payIncomeId.set('');
    this.payExpenseId.set('');
    this.payAmount.set(prefill ? fromCents(prefill.amountCents) : null);
    this.paySuggestedCents.set(prefill?.amountCents ?? 0);
    this.payDate.set(localDateString());
    this.payNote.set('');
    this.paymentOpen.set(true);
  }

  /** A payment in the list: one on the group opens to edit; one on your transactions opens to read. */
  openMove(m: GroupMove) {
    const p = m.paymentId ? this.group()?.payments.find(x => x.id === m.paymentId) : undefined;
    if (!p) { this.viewingMove.set(m); return; }
    this.editingPayment.set(p);
    this.payFrom.set(p.fromPersonId);
    this.payTo.set(p.toPersonId);
    this.payHow.set('cash');
    this.payAmount.set(fromCents(p.amountCents));
    this.payDate.set(p.date);
    this.payNote.set(p.note ?? '');
    this.paymentOpen.set(true);
  }

  async savePayment() {
    const g = this.group();
    if (!g || this.saving()) return;
    const from = this.payFrom(), to = this.payTo(), cents = this.payCents();
    if (!from || !to) { this.toast.error('Choose who paid and who they paid.'); return; }
    if (from === to) { this.toast.error('Someone can’t pay themselves.'); return; }
    if (this.payByBank() && !cents) {
      this.toast.error(this.payKind() === 'received' ? 'Pick the payment it came as.' : 'Pick the payment you made.');
      return;
    }
    if (cents <= 0) { this.toast.error('Enter how much they paid.'); return; }
    const date = this.payDate() || localDateString();
    const note = this.payNote().trim();
    const kind = this.payKind();
    this.saving.set(true);
    try {
      if (!this.editingPayment() && kind === 'received') {
        await this.recordReceived(g.id, from, cents, date, note);
      } else if (this.payByBank() && kind === 'sent') {
        await this.txService.update(this.chosenExpense()!.id!, { settlement: { personId: to, groupId: g.id } });
      } else {
        const editing = this.editingPayment();
        const payment: GroupPayment = {
          id: editing?.id ?? newReturnId(), fromPersonId: from, toPersonId: to, amountCents: cents, date, ...(note ? { note } : {}),
        };
        const payments = editing ? g.payments.map(p => (p.id === editing.id ? payment : p)) : [...(g.payments ?? []), payment];
        await this.groups.update(g.id, { payments });
      }
      this.paymentOpen.set(false);
    } catch (e) {
      this.toast.error(e instanceof NothingToRecordAgainst ? e.message : 'Could not save the payment. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Money you got: money back on your group expenses, spread over them oldest
   * first (`spreadReceived`), so your spending comes down to your share. A
   * bank payment is linked once, in parts; cash is written on each expense
   * with one batch id, so either way it reads as one payment.
   */
  private async recordReceived(groupId: string, from: string, cents: number, date: string, note: string) {
    const txs = this.txService.transactions();
    const parts = spreadReceived(groupId, txs, t => this.txService.moneyBackEntriesFor(t), cents);
    if (!parts.length) throw new NothingToRecordAgainst();
    const who = { fromPersonId: from, coversPersonIds: [from] };
    if (this.payHow() === 'bank') {
      const income = this.chosenIncome()!;
      await this.txService.update(income.id!, parts.length === 1
        ? { reimbursesId: parts[0].expenseId, moneyBackSplits: undefined, moneyBackInfo: { source: 'repayment', ...who } }
        : { moneyBackSplits: parts, reimbursesId: undefined, moneyBackInfo: { source: 'repayment', ...who } });
      return;
    }
    const batchId = newReturnId();
    await this.txService.applyPatches(parts.map(p => {
      const tx = txs.find(t => t.id === p.expenseId)!;
      const entry: UntrackedReturn = {
        id: newReturnId(), source: 'repayment', amountCents: p.amountCents, date, ...who, batchId, ...(note ? { note } : {}),
      };
      return { id: p.expenseId, patch: { moneyBack: [...(tx.moneyBack ?? []), entry] } };
    }));
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

  // ── A payment on your transactions: read, or take out of the group ──
  viewingMove = signal<GroupMove | null>(null);
  moveConfirm = signal(false);

  /** The transaction a payment came as or went out as, if it's a bank one. */
  moveTx = computed(() => {
    const m = this.viewingMove();
    if (!m) return null;
    const id = m.incomeId ?? (m.kind === 'sent' ? m.txId : undefined);
    return id ? this.txService.transactions().find(t => t.id === id) ?? null : null;
  });

  /** The group's expenses a payment you got was put against. */
  moveBills = computed(() => {
    const m = this.viewingMove();
    if (!m || m.kind !== 'received') return [];
    const txs = this.txService.transactions();
    return (m.txIds ?? []).map(id => txs.find(t => t.id === id)).filter((t): t is Transaction => !!t);
  });

  /**
   * Take a payment out of the group: unlink the income, unmark the expense,
   * or remove the cash entries. The bank transaction itself stays.
   */
  async removeMove() {
    const m = this.viewingMove();
    this.moveConfirm.set(false);
    if (!m) return;
    try {
      if (m.incomeId) {
        await this.txService.update(m.incomeId, { reimbursesId: undefined, moneyBackSplits: undefined, moneyBackInfo: undefined });
      } else if (m.kind === 'sent' && m.txId) {
        await this.txService.update(m.txId, { settlement: undefined });
      } else if (m.entries?.length) {
        const txs = this.txService.transactions();
        const byTx = new Map<string, string[]>();
        for (const e of m.entries) byTx.set(e.txId, [...(byTx.get(e.txId) ?? []), e.entryId]);
        await this.txService.applyPatches([...byTx].map(([id, entryIds]) => {
          const tx = txs.find(t => t.id === id)!;
          return { id, patch: { moneyBack: (tx.moneyBack ?? []).filter(e => !entryIds.includes(e.id)) } };
        }));
      }
      this.viewingMove.set(null);
    } catch {
      this.toast.error('Could not remove the payment. Please try again.');
    }
  }

  /** "Zelle from VYBHAV J · Sep 20 · $99.86" */
  txLabel(t: Transaction): string {
    return `${t.merchant || (t.type === 'income' ? 'Income' : 'Expense')} · ${this.formatDate(t.date)} · ${formatCurrency(t.amount)}`;
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

/** A payment to you with no expense of yours in the group to put it against. */
class NothingToRecordAgainst extends Error {
  constructor() {
    super('There is no expense of yours in this group to record it against yet.');
  }
}
