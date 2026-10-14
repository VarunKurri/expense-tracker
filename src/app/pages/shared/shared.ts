import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { FormsModule } from '@angular/forms';
import { Transaction, UntrackedReturn } from '../../models';
import { TransactionService } from '../../services/transaction.service';
import { PersonService } from '../../services/person.service';
import { GroupService } from '../../services/group.service';
import { ToastService } from '../../services/toast.service';
import { Modal } from '../../components/modal/modal';
import { Confirm } from '../../components/confirm/confirm';
import { TransactionView } from '../../components/transaction-view/transaction-view';
import { TransactionForm } from '../transactions/transaction-form/transaction-form';
import { GroupForm } from '../../components/group-form/group-form';
import { formatCurrency } from '../../utils/format';
import { fromCents, toCents } from '../../utils/money';
import { isMoneyBackIncome, newReturnId } from '../../utils/money-back';
import { localDateString } from '../../utils/date';
import { PersonBalance, SharedBill, balancesByPerson, spreadRepayment, totalOwedCents } from '../../utils/shared';
import { groupLedger } from '../../utils/groups';

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
  imports: [FormsModule, RouterLink, Modal, Confirm, TransactionView, TransactionForm, GroupForm],
  templateUrl: './shared.html',
  styleUrl: './shared.scss',
})
export class Shared {
  txService = inject(TransactionService);
  people = inject(PersonService);
  groups = inject(GroupService);
  private toast = inject(ToastService);
  private router = inject(Router);

  /** Bills in a group that still exists are settled with the group, not here. */
  private inGroup = (t: Transaction) => !!this.groups.byId(t.split?.groupId);

  balances = computed(() =>
    balancesByPerson(this.txService.transactions(), t => this.txService.moneyBackEntriesFor(t), this.inGroup));

  // ── Groups ─────────────────────────────────────────────────
  /** Each group not put away, with where you stand in it. */
  groupRows = computed(() => this.groups.groups()
    .filter(g => g.id && !g.archived)
    .map(g => {
      const ledger = groupLedger(g as typeof g & { id: string }, this.txService.transactions(), [],
        t => this.txService.moneyBackEntriesFor(t));
      return { group: g, balanceCents: ledger.myBalanceCents, bills: ledger.bills.length, people: g.memberIds.length + 1 };
    }));

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
  owing = computed(() => this.balances().filter(b => b.owedCents > 0));
  /** People you've split with who owe nothing now. */
  square = computed(() => this.balances().filter(b => b.owedCents === 0));
  /** Groups where you're owed money. */
  owingGroups = computed(() => this.groupRows().filter(r => r.balanceCents > 0));
  /** Everything owed to you: by people outside groups, and by your groups. */
  totalOwedCents = computed(() =>
    totalOwedCents(this.owing()) + this.owingGroups().reduce((sum, r) => sum + r.balanceCents, 0));
  anythingOwed = computed(() => this.owing().length > 0 || this.owingGroups().length > 0);

  /**
   * "Mrunaal owes you $85.00." / "Three friends owe you $180.00.", then the
   * groups: "Tahoe Trip owes you $570.00." / "Your groups owe you $640.00."
   */
  headline = computed(() => {
    const parts: string[] = [];
    const owing = this.owing();
    if (owing.length) {
      const total = this.money(totalOwedCents(owing));
      if (owing.length === 1) parts.push(`${this.people.nameOf(owing[0].personId)} owes you ${total}.`);
      else parts.push(`${COUNT_WORDS[owing.length] ?? `${owing.length} friends`} owe you ${total}.`);
    }
    const groups = this.owingGroups();
    if (groups.length) {
      const total = this.money(groups.reduce((sum, r) => sum + r.balanceCents, 0));
      parts.push(groups.length === 1 ? `${groups[0].group.name} owes you ${total}.` : `Your groups owe you ${total}.`);
    }
    return parts.join(' ');
  });

  /** Whose settled bills are showing. */
  showingHistory = signal<Set<string>>(new Set());
  toggleHistory(personId: string) {
    this.showingHistory.update(s => {
      const next = new Set(s);
      if (next.has(personId)) next.delete(personId); else next.add(personId);
      return next;
    });
  }
  settledBills(b: PersonBalance): SharedBill[] {
    return b.allBills.filter(x => !b.openBills.includes(x));
  }

  billNote(bill: SharedBill): string {
    const s = bill.status;
    if (s.state === 'closed') return `Won't be repaid · ${this.money(s.outstandingCents)}`;
    if (s.state === 'repaid') return `Repaid ${this.money(s.repaidCents)}`;
    if (s.dueToMeCents === 0) return `Share ${this.money(s.shareCents)} · paid their way`;
    if (s.repaidCents > 0) return `${this.money(s.repaidCents)} back · owes ${this.money(s.outstandingCents)}`;
    return `Owes ${this.money(s.outstandingCents)}`;
  }

  // ── Record a repayment, across bills ───────────────────────
  repaying = signal<PersonBalance | null>(null);
  /** Cash (or anything outside your accounts), or a payment that synced from the bank. */
  repayHow = signal<'cash' | 'bank'>('cash');
  repayAmount = signal<number | null>(null);
  repayDate = signal('');
  repayNote = signal('');
  repayIncomeId = signal('');
  saving = signal(false);

  /** Bank payments that could be this repayment: incomes not already money back, newest first. */
  incomeChoices = computed(() => this.txService.transactions()
    .filter(t => t.type === 'income' && !t.isInternalTransfer && !isMoneyBackIncome(t))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 40));

  private chosenIncome = computed(() => this.incomeChoices().find(t => t.id === this.repayIncomeId()) ?? null);

  repayCents = computed(() => this.repayHow() === 'bank'
    ? (this.chosenIncome() ? toCents(this.chosenIncome()!.amount) : 0)
    : toCents(Number(this.repayAmount()) || 0));

  /** How the repayment lands: which bills it pays, oldest first. */
  preview = computed(() => {
    const b = this.repaying();
    if (!b) return [];
    const parts = spreadRepayment(b.openBills, this.repayCents());
    return parts.map(p => {
      const bill = b.openBills.find(x => x.tx.id === p.expenseId)!;
      return { bill, amountCents: p.amountCents, clears: p.amountCents >= bill.status.outstandingCents };
    });
  });
  extraCents = computed(() => Math.max(0, this.repayCents() - (this.repaying()?.owedCents ?? 0)));

  openRepay(b: PersonBalance) {
    this.repaying.set(b);
    this.repayHow.set('cash');
    this.repayAmount.set(fromCents(b.owedCents));
    this.repayDate.set(localDateString());
    this.repayNote.set('');
    this.repayIncomeId.set('');
  }

  closeRepay() {
    this.repaying.set(null);
  }

  async saveRepay() {
    const b = this.repaying();
    if (!b || this.saving()) return;
    const cents = this.repayCents();
    if (this.repayHow() === 'bank' && !this.chosenIncome()) { this.toast.error('Pick the payment it came as.'); return; }
    if (cents <= 0) { this.toast.error('Enter how much they paid back.'); return; }
    const parts = spreadRepayment(b.openBills, cents);
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
        await this.txService.applyPatches(parts.map(p => {
          const tx = b.openBills.find(x => x.tx.id === p.expenseId)!.tx;
          const entry: UntrackedReturn = {
            id: newReturnId(), source: 'repayment', amountCents: p.amountCents, date, ...who, ...(note ? { note } : {}),
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

  incomeLabel(t: Transaction): string {
    return `${t.merchant || 'Income'} · ${this.formatDate(t.date)} · ${formatCurrency(t.amount)}`;
  }
}
