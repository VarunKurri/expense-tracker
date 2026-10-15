import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { ME, SharedBill, Transaction, UntrackedReturn } from '../../models';
import { TransactionService } from '../../services/transaction.service';
import { PersonService } from '../../services/person.service';
import { GroupService } from '../../services/group.service';
import { SharedBillService } from '../../services/shared-bill.service';
import { SharedBalanceService } from '../../services/shared-balance.service';
import { ToastService } from '../../services/toast.service';
import { Modal } from '../../components/modal/modal';
import { Confirm } from '../../components/confirm/confirm';
import { TransactionView } from '../../components/transaction-view/transaction-view';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { GroupForm } from '../../components/group-form/group-form';
import { SharedBillForm } from '../../components/shared-bill-form/shared-bill-form';
import { SharedBillView } from '../../components/shared-bill-view/shared-bill-view';
import { TransactionPicker } from '../../components/transaction-picker/transaction-picker';
import { formatCurrency } from '../../utils/format';
import { fromCents, toCents } from '../../utils/money';
import { isMoneyBackIncome, newReturnId } from '../../utils/money-back';
import { localDateString } from '../../utils/date';
import {
  GroupPart, OwedBill, PaidOut, PersonBalance, BillShare, repayableCents, spreadRepayment, stillOwedCents,
} from '../../utils/shared';
import { spreadReceived } from '../../utils/groups';

const COUNT_WORDS = ['No one', 'One friend', 'Two friends', 'Three friends', 'Four friends', 'Five friends',
  'Six friends', 'Seven friends', 'Eight friends', 'Nine friends'];

/**
 * Shared: everyone you've split a bill with, and what they still owe you,
 * across every bill. One repayment can cover several bills (it's spread
 * over them oldest first), whether it came as cash or as a bank payment.
 *
 * Figures come from `utils/shared.ts` and `utils/splits.ts`; nothing here
 * adds money up.
 */
@Component({
  selector: 'app-shared',
  standalone: true,
  imports: [FormsModule, RouterLink, Modal, Confirm, TransactionView, TransactionForm, GroupForm, SharedBillForm, SharedBillView, TransactionPicker],
  templateUrl: './shared.html',
  styleUrl: './shared.scss',
})
export class Shared {
  txService = inject(TransactionService);
  people = inject(PersonService);
  groups = inject(GroupService);
  sharedBills = inject(SharedBillService);
  private toast = inject(ToastService);
  private router = inject(Router);

  private shared = inject(SharedBalanceService);

  // ── Groups ─────────────────────────────────────────────────
  /** Every group's ledger (utils/groups.ts). */
  private ledgers = this.shared.ledgers;

  /** Each group not put away, with where you stand in it. */
  groupRows = computed(() => this.ledgers()
    .filter(({ group }) => !group.archived)
    .map(({ group, ledger }) => ({
      group, balanceCents: ledger.myBalanceCents, bills: ledger.bills.length, people: group.memberIds.length + 1,
    })));

  newGroupOpen = signal(false);

  onGroupCreated(id: string) {
    this.newGroupOpen.set(false);
    this.router.navigate(['/shared/groups', id]);
  }

  /** "4 people · 2 bills" */
  groupMeta(row: { people: number; bills: number }): string {
    return `${row.people} people${row.bills ? ` · ${row.bills} bill${row.bills === 1 ? '' : 's'}` : ''}`;
  }

  groupNote(row: { balanceCents: number; bills: number }): string {
    if (!row.bills) return 'No bills yet';
    if (row.balanceCents > 0) return `You're owed ${this.money(row.balanceCents)}`;
    if (row.balanceCents < 0) return `You owe ${this.money(-row.balanceCents)}`;
    return 'All square';
  }

  // ── People: everyone's total, groups included ──────────────
  /**
   * Each person's total with you, the way Splitwise shows a friend: bills
   * outside groups, plus what each group's settle-up plan has them paying you
   * (or you paying them).
   */
  balances = this.shared.balances;
  /** Everyone you're not square with: they owe you, or you owe them. */
  open = computed(() => this.balances().filter(b => b.netCents !== 0 || b.openBills.length > 0 || b.owedByMe.length > 0));
  owing = computed(() => this.balances().filter(b => b.netCents > 0));
  /** People you've split with who are square with you. */
  square = computed(() => this.balances().filter(b => b.netCents === 0 && !b.openBills.length && !b.owedByMe.length));
  totalOwedCents = this.shared.owedToMeCents;
  totalYouOweCents = this.shared.youOweCents;
  anythingOwed = computed(() => this.totalOwedCents() > 0);

  /** "Mrunaal owes you $85.00." / "Three friends owe you $180.00." */
  headline = computed(() => {
    const owing = this.owing();
    const total = this.money(this.totalOwedCents());
    if (owing.length === 1) return `${this.people.nameOf(owing[0].personId)} owes you ${total}.`;
    return `${COUNT_WORDS[owing.length] ?? `${owing.length} friends`} owe you ${total}.`;
  });

  /** "$57.44 across 4 bills and Tahoe & Cali Trip" */
  personSub(b: PersonBalance): string {
    const where: string[] = [];
    const bills = b.openBills.length + b.owedByMe.length;
    if (bills) where.push(`${bills} bill${bills === 1 ? '' : 's'}`);
    const groups = b.groups.filter(g => g.cents !== 0);
    if (groups.length === 1) where.push(groups[0].name);
    else if (groups.length > 1) where.push(`${groups.length} groups`);
    return where.length ? `across ${where.join(' and ')}` : '';
  }

  /** Whether a repayment from them has anything to pay off. */
  repayable(b: PersonBalance): boolean {
    return repayableCents(b) > 0;
  }

  groupPartNote(cents: number): string {
    return cents > 0 ? `Owes ${this.money(cents)}` : `You owe ${this.money(-cents)}`;
  }

  /** Whose settled bills are showing. */
  showingHistory = signal<Set<string>>(new Set());
  toggleHistory(personId: string) {
    this.showingHistory.update(s => {
      const next = new Set(s);
      if (next.has(personId)) next.delete(personId); else next.add(personId);
      return next;
    });
  }
  settledBills(b: PersonBalance): BillShare[] {
    return b.allBills.filter(x => !b.openBills.includes(x));
  }

  /** What "Show history" holds: your settled bills, their bills you've paid off, and what you've paid them. */
  historyCount(b: PersonBalance): number {
    return this.settledBills(b).length + b.settledOwed.length + b.paidOut.length;
  }

  /** "You owe $198.00 of $298.00" once you've paid part of it, or some was evened out. */
  owedNote(o: OwedBill): string {
    const done = (o.paidCents ?? 0) + (o.nettedCents ?? 0);
    return done ? `You owe ${this.money(o.cents)} of ${this.money(o.cents + done)}` : `You owe ${this.money(o.cents)}`;
  }

  /** A bill of theirs you no longer owe on: paid back, evened out, or both. */
  settledOwedNote(o: OwedBill): string {
    const paid = o.paidCents ?? 0, netted = o.nettedCents ?? 0;
    if (paid && netted) return `Paid back ${this.money(paid)} · ${this.money(netted)} evened out`;
    return paid ? `Paid back ${this.money(paid)}` : `Evened out against what they owed · ${this.money(netted)}`;
  }

  /**
   * A person's open bills, both ways, newest first, as Splitwise lists them:
   * your bills they owe on, and their bills you owe on.
   */
  openTimeline(b: PersonBalance): ({ kind: 'mine'; date: string; bill: BillShare } | { kind: 'theirs'; date: string; owed: OwedBill })[] {
    return [
      ...b.openBills.map(bill => ({ kind: 'mine' as const, date: bill.tx.date, bill })),
      ...b.owedByMe.map(owed => ({ kind: 'theirs' as const, date: owed.bill.date, owed })),
    ].sort((x, y) => y.date.localeCompare(x.date));
  }

  /** History, newest first: payments you made them, their bills you've settled, your settled bills. */
  historyTimeline(b: PersonBalance): ({ kind: 'paid'; date: string; paid: PaidOut } | { kind: 'theirs'; date: string; owed: OwedBill } | { kind: 'mine'; date: string; bill: BillShare })[] {
    return [
      ...b.paidOut.map(paid => ({ kind: 'paid' as const, date: paid.date, paid })),
      ...b.settledOwed.map(owed => ({ kind: 'theirs' as const, date: owed.bill.date, owed })),
      ...this.settledBills(b).map(bill => ({ kind: 'mine' as const, date: bill.tx.date, bill })),
    ].sort((x, y) => y.date.localeCompare(x.date));
  }

  /** "Venmo to Nikhilesh" for a bank payment, "Cash · at dinner" otherwise. */
  paidOutVia(p: PaidOut): string {
    if (p.txId) return this.txService.transactions().find(t => t.id === p.txId)?.merchant || 'A bank payment';
    return p.note ? `Cash · ${p.note}` : 'Cash or other';
  }

  /** A bank payment opens its sheet (where it can be unlinked); cash asks to remove it. */
  openPaidOut(p: PaidOut) {
    if (p.txId) {
      const t = this.txService.transactions().find(x => x.id === p.txId);
      if (t) this.viewingTx.set(t);
    } else {
      this.removingCash.set(p);
    }
  }

  removingCash = signal<PaidOut | null>(null);

  async removeCash() {
    const p = this.removingCash();
    this.removingCash.set(null);
    const person = p && this.people.people().find(x => x.id === p.personId);
    if (!p || !person?.id) return;
    try {
      await this.people.update(person.id, { payments: (person.payments ?? []).filter(x => x.id !== p.paymentId) });
    } catch {
      this.toast.error('Could not remove it. Please try again.');
    }
  }

  billNote(bill: BillShare): string {
    const s = bill.status;
    const netted = bill.nettedCents ?? 0;
    if (netted > 0) {
      const left = stillOwedCents(bill);
      return left > 0 ? `Owes ${this.money(left)} of ${this.money(s.outstandingCents)}` : `Evened out against what you owed · ${this.money(netted)}`;
    }
    if (s.state === 'closed') return `Won't be repaid · ${this.money(s.outstandingCents)}`;
    if (s.state === 'repaid') return `Repaid ${this.money(s.repaidCents)}`;
    if (s.dueToMeCents === 0) return `Share ${this.money(s.shareCents)} · paid their way`;
    if (s.repaidCents > 0) return `${this.money(s.repaidCents)} back · owes ${this.money(s.outstandingCents)}`;
    return `Owes ${this.money(s.outstandingCents)}`;
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

  // ── Record a payment, either way, across bills ─────────────
  repaying = signal<PersonBalance | null>(null);
  /** `in`: they paid you back. `out`: you paid them back. */
  repayDir = signal<'in' | 'out'>('in');
  repayExpenseId = signal('');

  /** Anything to record with them: either of you owes the other, outside groups or in one. */
  canRecord(b: PersonBalance): boolean {
    return this.repayable(b) || b.iOweCents > 0 || b.groups.some(g => g.cents < 0);
  }

  /** Bank payments that could be what you sent: expenses not split and not already settling up. */
  expenseChoices = computed(() => this.txService.transactions()
    .filter(t => t.type === 'expense' && !t.isInternalTransfer && !t.split && !t.settlement));
  private chosenExpense = computed(() => this.expenseChoices().find(t => t.id === this.repayExpenseId()) ?? null);

  /**
   * What a payment to them pays back: their bills outside groups if you owe on
   * any, otherwise the group you owe them most in. One payment pays one of
   * those; to pay a group as well, record it from the group's page.
   */
  payTarget = computed<{ groupId?: string; name: string; owedCents: number } | null>(() => {
    const b = this.repaying();
    if (!b) return null;
    if (b.iOweCents > 0 || !b.groups.some(g => g.cents < 0)) return { name: 'their bills', owedCents: b.iOweCents };
    const g = [...b.groups].sort((x, y) => x.cents - y.cents)[0];
    return { groupId: g.groupId, name: g.name, owedCents: -g.cents };
  });

  /** A payment to them, oldest bill first, and how much of each it clears. */
  payPreview = computed(() => {
    const b = this.repaying(), target = this.payTarget();
    if (!b || !target) return [];
    if (target.groupId) return [{ key: target.groupId, name: target.name, date: '', amountCents: Math.min(this.repayCents(), target.owedCents), ofCents: target.owedCents }];
    let left = this.repayCents();
    return b.owedByMe.map(o => {
      const take = Math.min(left, o.cents);
      left -= take;
      return { key: o.bill.id!, name: o.bill.merchant, date: o.bill.date, amountCents: take, ofCents: o.cents };
    }).filter(r => r.amountCents > 0);
  });
  payExtraCents = computed(() => Math.max(0, this.repayCents() - (this.payTarget()?.owedCents ?? 0)));
  /** Cash (or anything outside your accounts), or a payment that synced from the bank. */
  repayHow = signal<'cash' | 'bank'>('cash');
  repayAmount = signal<number | null>(null);
  repayDate = signal('');
  repayNote = signal('');
  repayIncomeId = signal('');
  saving = signal(false);

  /** Bank payments that could be this repayment: incomes not already money back. The picker searches them. */
  incomeChoices = computed(() => this.txService.transactions()
    .filter(t => t.type === 'income' && !t.isInternalTransfer && !isMoneyBackIncome(t)));

  /** What they owe you in all, for the picker to list a payment of exactly that first. */
  repayableCents(b: PersonBalance): number {
    return repayableCents(b);
  }

  private chosenIncome = computed(() => this.incomeChoices().find(t => t.id === this.repayIncomeId()) ?? null);

  repayCents = computed(() => {
    if (this.repayHow() !== 'bank') return toCents(Number(this.repayAmount()) || 0);
    const t = this.repayDir() === 'out' ? this.chosenExpense() : this.chosenIncome();
    return t ? toCents(t.amount) : 0;
  });

  /**
   * How a repayment lands: bills outside groups first (oldest first), then
   * the groups they owe you in. Anything beyond all of it is extra (income),
   * on the newest bill. Money for a group goes on your group bills as money
   * back from them, so the group's balances and your spending both follow.
   */
  private repayParts(b: PersonBalance, cents: number) {
    let billCents = Math.min(cents, b.owedCents);
    let left = cents - billCents;
    const groupTakes: { part: GroupPart; cents: number }[] = [];
    for (const part of b.groups.filter(g => g.cents > 0)) {
      const take = Math.min(left, part.cents);
      if (take > 0) { groupTakes.push({ part, cents: take }); left -= take; }
    }
    if (left > 0) {
      if (b.openBills.length || !groupTakes.length) billCents += left;
      else groupTakes[groupTakes.length - 1].cents += left;
    }
    const txs = this.txService.transactions();
    const moneyBackFor = (t: Transaction) => this.txService.moneyBackEntriesFor(t);
    return {
      bills: spreadRepayment(b.openBills, billCents),
      groups: groupTakes.map(g => ({ ...g, links: spreadReceived(g.part.groupId, txs, moneyBackFor, g.cents) })),
    };
  }

  /** The repayment's preview: each bill and group it pays, and whether that clears it. */
  preview = computed(() => {
    const b = this.repaying();
    if (!b) return [];
    const { bills, groups } = this.repayParts(b, this.repayCents());
    return [
      ...bills.map(p => {
        const bill = b.openBills.find(x => x.tx.id === p.expenseId)!;
        return { key: p.expenseId, name: bill.tx.merchant || 'Expense', date: bill.tx.date,
                 amountCents: p.amountCents, ofCents: stillOwedCents(bill) };
      }),
      ...groups.map(g => ({ key: g.part.groupId, name: g.part.name, date: '', amountCents: g.cents, ofCents: g.part.cents })),
    ];
  });
  extraCents = computed(() => Math.max(0, this.repayCents() - (this.repaying() ? repayableCents(this.repaying()!) : 0)));

  openRepay(b: PersonBalance) {
    this.repaying.set(b);
    // Whoever owes is who's likely paying: you, when you owe them overall.
    const out = !this.repayable(b) || b.netCents < 0;
    this.repayDir.set(out ? 'out' : 'in');
    this.repayExpenseId.set('');
    this.repayHow.set('cash');
    this.repayAmount.set(fromCents(out ? (this.payTarget()?.owedCents ?? 0) : repayableCents(b)));
    this.repayDate.set(localDateString());
    this.repayNote.set('');
    this.repayIncomeId.set('');
  }

  closeRepay() {
    this.repaying.set(null);
  }

  /** Switch who paid; the amount follows to what that side owes. */
  setRepayDir(dir: 'in' | 'out') {
    const b = this.repaying();
    this.repayDir.set(dir);
    if (b) this.repayAmount.set(fromCents(dir === 'out' ? (this.payTarget()?.owedCents ?? 0) : repayableCents(b)));
  }

  async saveRepay() {
    const b = this.repaying();
    if (!b || this.saving()) return;
    if (this.repayDir() === 'out') { await this.savePayment(b); return; }
    const cents = this.repayCents();
    if (this.repayHow() === 'bank' && !this.chosenIncome()) { this.toast.error('Pick the payment it came as.'); return; }
    if (cents <= 0) { this.toast.error('Enter how much they paid back.'); return; }
    const { bills, groups } = this.repayParts(b, cents);
    // Bills outside groups and group bills never overlap, so these are distinct expenses.
    const parts = [...bills, ...groups.flatMap(g => g.links)];
    if (!parts.length) { this.toast.error('There is no bill of yours to record this against.'); return; }
    const who = { fromPersonId: b.personId, coversPersonIds: [b.personId] };
    this.saving.set(true);
    try {
      if (this.repayHow() === 'bank') {
        // One bank payment, spread over the bills it paid: kept out of income
        // once, and each bill nets only its own part.
        const income = this.chosenIncome()!;
        await this.txService.update(income.id!, parts.length === 1
          ? { reimbursesId: parts[0].expenseId, moneyBackSplits: undefined, moneyBackInfo: { source: 'repayment', ...who } }
          : { moneyBackSplits: parts, reimbursesId: undefined, moneyBackInfo: { source: 'repayment', ...who } });
      } else {
        const date = this.repayDate() || localDateString();
        const note = this.repayNote().trim();
        const all = this.txService.transactions();
        // One id across the parts, so a group reads them as one payment.
        const batchId = newReturnId();
        await this.txService.applyPatches(parts.map(p => {
          const tx = all.find(t => t.id === p.expenseId)!;
          const entry: UntrackedReturn = {
            id: newReturnId(), source: 'repayment', amountCents: p.amountCents, date, ...who, batchId, ...(note ? { note } : {}),
          };
          return { id: p.expenseId, patch: { moneyBack: [...(tx.moneyBack ?? []), entry] } };
        }));
      }
      this.toast.success(`Recorded ${this.money(cents)} from ${this.people.nameOf(b.personId)}.`);
      this.closeRepay();
    } catch {
      this.toast.error('Could not save. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * You paid them: a bank payment is that expense, marked as settling up with
   * them (it's spending, under what it paid for); cash goes on the person, or
   * on the group when it pays a group.
   */
  private async savePayment(b: PersonBalance) {
    const target = this.payTarget();
    const cents = this.repayCents();
    if (this.repayHow() === 'bank' && !this.chosenExpense()) { this.toast.error('Pick the payment you made.'); return; }
    if (cents <= 0 || !target) { this.toast.error('Enter how much you paid.'); return; }
    const date = this.repayDate() || localDateString();
    const note = this.repayNote().trim();
    this.saving.set(true);
    try {
      if (this.repayHow() === 'bank') {
        await this.txService.update(this.chosenExpense()!.id!, {
          settlement: { personId: b.personId, ...(target.groupId ? { groupId: target.groupId } : {}) },
        });
      } else if (target.groupId) {
        const g = this.groups.byId(target.groupId)!;
        await this.groups.update(target.groupId, { payments: [...(g.payments ?? []), {
          id: newReturnId(), fromPersonId: ME, toPersonId: b.personId, amountCents: cents, date, ...(note ? { note } : {}),
        }] });
      } else {
        const person = this.people.people().find(p => p.id === b.personId);
        if (!person?.id) throw new Error('No such person');
        await this.people.update(person.id, { payments: [...(person.payments ?? []), {
          id: newReturnId(), amountCents: cents, date, ...(note ? { note } : {}),
        }] });
      }
      this.toast.success(`Recorded ${this.money(cents)} to ${this.people.nameOf(b.personId)}.`);
      this.closeRepay();
    } catch {
      this.toast.error('Could not save. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  // ── Transaction view / edit ────────────────────────────────
  viewingTx = signal<Transaction | null>(null);
  editingTx = signal<Transaction | null>(null);
  txFormOpen = signal(false);
  txConfirmOpen = signal(false);
  private txToDelete = signal<Transaction | null>(null);

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

  // ── Formatting ─────────────────────────────────────────────
  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }

  formatDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
