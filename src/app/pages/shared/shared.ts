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
import {
  GroupPart, PersonBalance, SharedBill, balancesByPerson, repayableCents, spreadRepayment, totalOwedCents, totalYouOweCents, withGroups,
} from '../../utils/shared';
import { groupLedger, spreadReceived } from '../../utils/groups';

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

  // ── Groups ─────────────────────────────────────────────────
  /** Every group's ledger (utils/groups.ts), worked out once for the page. */
  private ledgers = computed(() => this.groups.groups()
    .filter(g => g.id)
    .map(g => ({
      group: g,
      ledger: groupLedger(g as typeof g & { id: string }, this.txService.transactions(), [],
        t => this.txService.moneyBackEntriesFor(t)),
    })));

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
  balances = computed(() => withGroups(
    balancesByPerson(this.txService.transactions(), t => this.txService.moneyBackEntriesFor(t), this.inGroup),
    this.ledgers().map(({ group, ledger }) => ({ groupId: group.id!, name: group.name, plan: ledger.plan })),
  ));
  /** Everyone you're not square with: they owe you, or you owe them. */
  open = computed(() => this.balances().filter(b => b.netCents !== 0 || b.openBills.length > 0));
  owing = computed(() => this.balances().filter(b => b.netCents > 0));
  /** People you've split with who are square with you. */
  square = computed(() => this.balances().filter(b => b.netCents === 0 && !b.openBills.length));
  totalOwedCents = computed(() => totalOwedCents(this.balances()));
  totalYouOweCents = computed(() => totalYouOweCents(this.balances()));
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
    if (b.openBills.length) where.push(`${b.openBills.length} bill${b.openBills.length === 1 ? '' : 's'}`);
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
                 amountCents: p.amountCents, ofCents: bill.status.outstandingCents };
      }),
      ...groups.map(g => ({ key: g.part.groupId, name: g.part.name, date: '', amountCents: g.cents, ofCents: g.part.cents })),
    ];
  });
  extraCents = computed(() => Math.max(0, this.repayCents() - (this.repaying() ? repayableCents(this.repaying()!) : 0)));

  openRepay(b: PersonBalance) {
    this.repaying.set(b);
    this.repayHow.set('cash');
    this.repayAmount.set(fromCents(repayableCents(b)));
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
        await this.txService.applyPatches(parts.map(p => {
          const tx = all.find(t => t.id === p.expenseId)!;
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
