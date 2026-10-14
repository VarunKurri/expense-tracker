import { Component, computed, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { toSignal } from '@angular/core/rxjs-interop';
import { map } from 'rxjs';
import { ME, Transaction } from '../../../models';
import { GroupService } from '../../../services/group.service';
import { PersonService } from '../../../services/person.service';
import { TransactionService } from '../../../services/transaction.service';
import { ToastService } from '../../../services/toast.service';
import { Confirm } from '../../../components/confirm/confirm';
import { GroupForm } from '../../../components/group-form/group-form';
import { TransactionView } from '../../../components/transaction-view/transaction-view';
import { TransactionForm } from '../../transactions/transaction-form/transaction-form';
import { formatCurrency } from '../../../utils/format';
import { fromCents } from '../../../utils/money';
import { GroupBill, groupLedger } from '../../../utils/groups';
import type { Transfer } from '../../../utils/split/types';

/**
 * One group (a trip, a flat): where you stand, how to settle up, everyone's
 * balance, and the bills in it. The figures are `groupLedger()`
 * (utils/groups.ts); nothing here adds money up.
 */
@Component({
  selector: 'app-group-detail',
  standalone: true,
  imports: [Confirm, GroupForm, TransactionView, TransactionForm],
  templateUrl: './group-detail.html',
  styleUrl: './group-detail.scss',
})
export class GroupDetail {
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  groups = inject(GroupService);
  people = inject(PersonService);
  txService = inject(TransactionService);
  private toast = inject(ToastService);

  private id = toSignal(this.route.paramMap.pipe(map(p => p.get('id') ?? '')), { initialValue: '' });
  group = computed(() => this.groups.byId(this.id()));

  ledger = computed(() => {
    const g = this.group();
    return g ? groupLedger(g, this.txService.transactions(), [], t => this.txService.moneyBackEntriesFor(t)) : null;
  });

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
    const payers = b.paidByIds.map(id => (id === ME ? 'You' : this.people.nameOf(id)));
    const paid = payers.length ? `${payers.join(' and ')} paid ${this.money(b.totalCents)}` : this.money(b.totalCents);
    return `${paid} · your share ${this.money(b.myShareCents)}`;
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

  openBill(b: GroupBill) {
    if (b.tx) this.viewingTx.set(b.tx);
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
