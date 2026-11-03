import { Component, HostListener, computed, effect, inject, input, output, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ME, SharedBill } from '../../models';
import { SharedBillService } from '../../services/shared-bill.service';
import { GroupService } from '../../services/group.service';
import { PersonService } from '../../services/person.service';
import { CategoryService } from '../../services/category.service';
import { ReceiptService } from '../../services/receipt.service';
import { ScrollLockService } from '../../services/scroll-lock.service';
import { ReceiptAttach } from '../receipt-attach/receipt-attach';
import { formatCurrency } from '../../utils/format';
import { fromCents } from '../../utils/money';
import { splitStatus } from '../../utils/splits';

let nextLockId = 0;

/**
 * The details of a bill someone else paid, read-only, with Edit at the top:
 * who paid, what it was, everyone's share and what you owe. The same sheet as
 * a transaction's (it shares app-transaction-view's stylesheet), with only
 * what belongs to their payment: no account, no money back.
 */
@Component({
  selector: 'app-shared-bill-view',
  standalone: true,
  imports: [ReceiptAttach],
  templateUrl: './shared-bill-view.html',
  styleUrl: '../transaction-view/transaction-view.scss',
})
export class SharedBillView {
  private bills = inject(SharedBillService);
  private groups = inject(GroupService);
  people = inject(PersonService);
  private categories = inject(CategoryService);
  private receipts = inject(ReceiptService);
  private scrollLock = inject(ScrollLockService);
  private router = inject(Router);
  private lockKey = `bill-view-${nextLockId++}`;

  bill = input<SharedBill | null>(null);
  closed = output<void>();
  editRequested = output<SharedBill>();

  /** The bill as it stands now (it may have been edited since it was opened). */
  b = computed(() => {
    const snapshot = this.bill();
    return snapshot?.id ? this.bills.byId(snapshot.id) ?? snapshot : snapshot;
  });

  status = computed(() => {
    const b = this.b();
    return b ? splitStatus(b.split) : null;
  });

  payerId = computed(() => this.b()?.split.payments[0]?.personId ?? '');
  /** Everyone who paid, and how much. */
  payers = computed(() => (this.b()?.split.payments ?? []).filter(p => p.amountCents > 0));
  group = computed(() => this.groups.byId(this.b()?.split.groupId) ?? null);
  category = computed(() => this.categories.categories().find(c => c.id === this.b()?.categoryId) ?? null);

  /** One row per person on the bill, you first: their share, and what they paid. */
  rows = computed(() => {
    const s = this.status();
    if (!s) return [];
    return s.summary.perPerson
      .map((p, i) => ({ personId: p.personId, paidCents: p.paidCents, shareCents: shareAt(s, i) }))
      .sort((a, b) => Number(b.personId === ME) - Number(a.personId === ME));
  });

  /** What you owe whoever paid: the bill's own settle-up. */
  youOwe = computed(() => (this.status()?.transfers ?? []).filter(t => t.fromPersonId === ME));

  constructor() {
    effect(onCleanup => {
      this.scrollLock.set(this.lockKey, !!this.bill());
      onCleanup(() => this.scrollLock.unlock(this.lockKey));
    });
  }

  // ── Receipt photo (read-only here; changed in Edit) ────────
  receiptImage = signal<string | null>(null);
  receiptLoading = signal(false);
  private receiptId = computed(() => this.b()?.receiptId);
  private receiptLoader = effect(onCleanup => {
    const id = this.receiptId();
    this.receiptImage.set(null);
    if (!id) { this.receiptLoading.set(false); return; }
    let current = true;
    onCleanup(() => { current = false; });
    this.receiptLoading.set(true);
    this.receipts.load(id)
      .then(r => { if (current) this.receiptImage.set(r?.image ?? null); })
      .catch(() => {})
      .finally(() => { if (current) this.receiptLoading.set(false); });
  });

  name(id: string): string {
    return id === ME ? 'You' : this.people.nameOf(id);
  }

  rowNote(r: { personId: string; paidCents: number }): string {
    if (r.paidCents > 0) return `Paid ${this.money(r.paidCents)} · ${r.personId === ME ? 'your' : 'their'} share`;
    return r.personId === ME ? 'Your share' : 'Their share';
  }

  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }

  formatFullDate(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  }

  openGroup(id: string) {
    this.close();
    this.router.navigate(['/shared/groups', id]);
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.bill()) this.close();
  }

  close() {
    this.closed.emit();
  }

  edit() {
    const b = this.b();
    if (b) this.editRequested.emit(b);
  }
}

/** A person's share after any refund (splitStatus keeps them in summary order). */
function shareAt(s: ReturnType<typeof splitStatus>, index: number): number {
  const id = s.summary.perPerson[index].personId;
  if (id === ME) return s.myShareCents;
  return s.people.find(p => p.personId === id)?.shareCents ?? s.summary.perPerson[index].totalCents;
}
