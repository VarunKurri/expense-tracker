import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ME, SharedBill, TransactionSplit } from '../../models';
import { SharedBillService } from '../../services/shared-bill.service';
import { GroupService } from '../../services/group.service';
import { PersonService } from '../../services/person.service';
import { CategoryService } from '../../services/category.service';
import { ReceiptService } from '../../services/receipt.service';
import { ReceiptScanService } from '../../services/receipt-scan.service';
import { ToastService } from '../../services/toast.service';
import { Modal } from '../modal/modal';
import { Confirm } from '../confirm/confirm';
import { ReceiptAttach } from '../receipt-attach/receipt-attach';
import { SplitEditor } from '../split-editor/split-editor';
import { ItemizedSplitEditor } from '../split-editor/itemized-split-editor';
import { localDateString } from '../../utils/date';
import { fromCents, toCents } from '../../utils/money';
import { FittedImage } from '../../utils/image';
import {
  ItemizedSplitState, QuickSplitState, buildItemizedSplit, buildQuickSplit, emptyItemizedState, emptyQuickState,
  itemizedStateFrom, quickStateFrom, splitProblems,
} from '../../utils/splits';
import {
  ReceiptScan, itemizedFromScan, scanAmountCents, scanSummaryText, scanTaxBreakdownText, scanWarningText,
} from '../../utils/receipt';

/**
 * A bill someone else paid: "Ben paid $200 for the tents, split four ways".
 * Not a transaction (no money left your accounts), so it has no account. Your
 * share becomes spending when you pay them back.
 *
 * The same split editors as an expense of yours, with the payer set to them;
 * the same receipt photo and reading, too.
 */
@Component({
  selector: 'app-shared-bill-form',
  standalone: true,
  imports: [FormsModule, Modal, Confirm, ReceiptAttach, SplitEditor, ItemizedSplitEditor],
  templateUrl: './shared-bill-form.html',
  styleUrl: './shared-bill-form.scss',
})
export class SharedBillForm {
  private bills = inject(SharedBillService);
  groups = inject(GroupService);
  people = inject(PersonService);
  categories = inject(CategoryService);
  private receipts = inject(ReceiptService);
  private scanner = inject(ReceiptScanService);
  private toast = inject(ToastService);

  open = input(false);
  /** The bill being edited; null for a new one. */
  bill = input<SharedBill | null>(null);
  /** For a new bill: the group it starts in (opened from a group's page). */
  groupId = input<string | null>(null);
  closed = output<void>();
  saved = output<string>();

  payerId = signal('');
  amount = signal<number | null>(null);
  merchant = signal('');
  date = signal(localDateString());
  categoryId = signal('');
  group = signal('');
  notes = signal('');
  kind = signal<'quick' | 'itemized'>('quick');
  quickState = signal<QuickSplitState>(emptyQuickState());
  itemizedState = signal<ItemizedSplitState>(emptyItemizedState());
  saving = signal(false);
  confirming = signal(false);

  /** Adding someone new as the payer. */
  newPayerName = signal('');
  addingPayer = signal(false);

  amountCents = computed(() => toCents(Number(this.amount()) || 0));
  expenseCategories = computed(() => this.categories.categories().filter(c => c.kind === 'expense' && !c.archived));
  groupChoices = computed(() => this.groups.groups().filter(g => g.id && (!g.archived || g.id === this.group())));
  /** Who could have paid: everyone saved, the group's members first. */
  payerChoices = computed(() => {
    const members = new Set(this.groups.byId(this.group())?.memberIds ?? []);
    return [...this.people.people()].filter(p => p.id)
      .sort((a, b) => Number(members.has(b.id!)) - Number(members.has(a.id!)) || a.name.localeCompare(b.name));
  });
  payerName = computed(() => (this.payerId() ? this.people.nameOf(this.payerId()) : 'they'));

  constructor() {
    effect(() => {
      if (!this.open()) return;
      const b = this.bill();
      const presetGroup = this.groupId();
      untracked(() => this.load(b, presetGroup));
    });
  }

  private load(b: SharedBill | null, presetGroup: string | null) {
    this.confirming.set(false);
    this.newPayerName.set('');
    this.scanned.set(null);
    this.pendingReceipt = null;
    this.receiptRemoved = false;
    this.receiptImage.set(null);
    if (b) {
      const payer = b.split.payments[0]?.personId ?? '';
      this.payerId.set(payer);
      this.amount.set(fromCents(b.split.payments[0]?.amountCents ?? 0));
      this.merchant.set(b.merchant);
      this.date.set(b.date);
      this.categoryId.set(b.categoryId ?? '');
      this.group.set(b.split.groupId ?? '');
      this.notes.set(b.notes ?? '');
      const itemized = b.split.mode === 'itemized';
      this.kind.set(itemized ? 'itemized' : 'quick');
      this.quickState.set(itemized ? emptyQuickState() : quickStateFrom(b.split, payer));
      this.itemizedState.set(itemized ? itemizedStateFrom(b.split, payer) : emptyItemizedState());
      this.loadReceipt(b);
    } else {
      this.payerId.set('');
      this.amount.set(null);
      this.merchant.set('');
      this.date.set(localDateString());
      this.categoryId.set('');
      this.notes.set('');
      this.kind.set('quick');
      this.quickState.set(emptyQuickState());
      this.itemizedState.set(emptyItemizedState());
      this.group.set('');
      if (presetGroup) this.setGroup(presetGroup);
    }
  }

  // ── Who paid, and which group ──────────────────────────────
  /** The payer is on the bill with you to start with (anyone can be taken off). */
  setPayer(id: string) {
    this.payerId.set(id);
    if (id) this.addPeople([id]);
  }

  async addPayerByName() {
    const name = this.newPayerName().trim();
    if (!name || this.addingPayer()) return;
    const known = this.people.people().find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (known?.id) { this.setPayer(known.id); this.newPayerName.set(''); return; }
    this.addingPayer.set(true);
    try {
      this.setPayer(await this.people.add({ name }));
      this.newPayerName.set('');
    } catch {
      this.toast.error(`Could not save ${name}. Please try again.`);
    } finally {
      this.addingPayer.set(false);
    }
  }

  /** Putting the bill in a group puts the group's members on it. */
  setGroup(id: string) {
    this.group.set(id);
    this.addPeople(this.groups.byId(id)?.memberIds ?? []);
  }

  private addPeople(ids: string[]) {
    this.quickState.update(s => {
      const add = ids.filter(m => !s.participantIds.includes(m));
      const weights = { ...s.weights };
      for (const m of add) if (!(m in weights)) weights[m] = s.mode === 'shares' ? 1 : 0;
      return { ...s, participantIds: [...s.participantIds, ...add], weights };
    });
    this.itemizedState.update(s => ({
      ...s, participantIds: [...s.participantIds, ...ids.filter(m => !s.participantIds.includes(m))],
    }));
  }

  /** Switching keeps who's on the bill and who else paid; each mode keeps its own details. */
  setKind(kind: 'quick' | 'itemized') {
    if (kind === this.kind()) return;
    const from = kind === 'itemized' ? this.quickState() : this.itemizedState();
    const carried = { participantIds: [...from.participantIds], otherPayments: from.otherPayments.map(p => ({ ...p })) };
    if (kind === 'itemized') this.itemizedState.update(s => ({ ...s, ...carried }));
    else this.quickState.update(s => ({ ...s, ...carried }));
    this.kind.set(kind);
  }

  useSplitAmount(cents: number) {
    this.amount.set(fromCents(cents));
  }

  // ── Receipt photo ──────────────────────────────────────────
  receiptImage = signal<string | null>(null);
  private pendingReceipt: FittedImage | null = null;
  private receiptRemoved = false;
  receiptLoading = signal(false);
  scanning = signal(false);
  scanned = signal<ReceiptScan | null>(null);

  scanSummary = scanSummaryText;
  scanTaxBreakdown = scanTaxBreakdownText;
  scanWarning = scanWarningText;

  async attachReceipt(file: File) {
    try {
      const photo = await this.receipts.fit(file);
      this.pendingReceipt = photo;
      this.receiptRemoved = false;
      this.receiptImage.set(photo.dataUrl);
    } catch (err: any) {
      this.toast.error(err?.message || "Couldn't open that photo.");
      return;
    }
    if (!this.bill() && !this.amountCents() && !this.merchant().trim()) await this.readReceipt();
  }

  removeReceipt() {
    this.pendingReceipt = null;
    this.receiptRemoved = !!this.bill()?.receiptId;
    this.receiptImage.set(null);
  }

  async readReceipt() {
    const image = this.receiptImage();
    if (!image || this.scanning()) return;
    this.scanning.set(true);
    try {
      const scan = await this.scanner.scanImage(image);
      if (!scan.isReceipt) {
        this.toast.error("That doesn't look like a receipt, so nothing was filled in. It's still attached.");
        return;
      }
      if (scan.merchant && !this.merchant().trim()) this.merchant.set(scan.merchant);
      if (scan.date && !this.bill() && this.date() === localDateString()) this.date.set(scan.date);
      if (!this.amountCents()) this.amount.set(fromCents(scanAmountCents(scan)));
      this.setKind('itemized');
      this.itemizedState.update(s => itemizedFromScan(scan, s));
      this.scanned.set(scan);
    } catch (err: any) {
      this.toast.error(err?.message || "Couldn't read that receipt.");
    } finally {
      this.scanning.set(false);
    }
  }

  private loadReceipt(b: SharedBill) {
    if (!b.receiptId) { this.receiptLoading.set(false); return; }
    const id = b.receiptId;
    this.receiptLoading.set(true);
    this.receipts.load(id)
      .then(r => { if (this.bill()?.receiptId === id && !this.pendingReceipt) this.receiptImage.set(r?.image ?? null); })
      .catch(() => this.toast.error("Couldn't load the receipt photo."))
      .finally(() => this.receiptLoading.set(false));
  }

  // ── Save / delete ──────────────────────────────────────────
  async save() {
    if (this.saving()) return;
    const payer = this.payerId();
    const cents = this.amountCents();
    if (!payer) { this.toast.error('Choose who paid.'); return; }
    if (cents <= 0) { this.toast.error('Enter how much they paid.'); return; }

    const existing = this.bill()?.split ?? null;
    let split: TransactionSplit = this.kind() === 'itemized'
      ? buildItemizedSplit(this.itemizedState(), cents, existing, payer)
      : buildQuickSplit(this.quickState(), cents, existing, payer);
    const groupId = this.group();
    if (groupId && this.groups.byId(groupId)) split = { ...split, groupId };

    const problems = splitProblems(split, cents, payer);
    if (problems.includes('no-one-else')) { this.toast.error('Add who shared it.'); return; }
    if (problems.includes('unassigned')) {
      this.toast.error(this.kind() === 'itemized' ? "Some items aren't anyone's yet." : 'Give someone a share of the bill.');
      return;
    }
    if (problems.includes('not-covered')) { this.toast.error(`The items don't add up to what ${this.payerName()} paid.`); return; }
    if (!split.participantIds.includes(ME) && !split.groupId) {
      this.toast.error("You're not on this bill. Add yourself, or pick the group it belongs to.");
      return;
    }

    this.saving.set(true);
    try {
      const old = this.bill();
      let receiptId = this.receiptRemoved ? undefined : old?.receiptId;
      if (this.pendingReceipt) receiptId = await this.receipts.save(this.pendingReceipt);
      const data: Omit<SharedBill, 'id' | 'createdAt' | 'updatedAt'> = {
        date: this.date() || localDateString(),
        merchant: this.merchant().trim() || 'Bill',
        categoryId: this.categoryId() || undefined,
        notes: this.notes().trim() || undefined,
        receiptId,
        split,
      };
      let id: string;
      if (old?.id) { await this.bills.update(old.id, data); id = old.id; }
      else id = await this.bills.add(data);
      // The old photo goes once the bill no longer points at it.
      if (old?.receiptId && old.receiptId !== receiptId) await this.receipts.remove(old.receiptId).catch(() => {});
      this.saved.emit(id);
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not save the bill. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    const b = this.bill();
    this.confirming.set(false);
    if (!b?.id) return;
    try {
      await this.bills.remove(b.id);
      this.toast.success(`Deleted ${b.merchant}.`);
      this.closed.emit();
    } catch {
      this.toast.error('Could not delete the bill. Please try again.');
    }
  }
}
