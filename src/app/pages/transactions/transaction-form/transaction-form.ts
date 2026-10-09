import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, inject, signal, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { ErrorBanner } from '../../../components/error-banner/error-banner';
import { SplitEditor } from '../../../components/split-editor/split-editor';
import { ItemizedSplitEditor } from '../../../components/split-editor/itemized-split-editor';
import { AccountService } from '../../../services/account.service';
import { CategoryService } from '../../../services/category.service';
import { BillService } from '../../../services/bill.service';
import { TransactionTemplateService } from '../../../services/transaction-template.service';
import { TransactionService } from '../../../services/transaction.service';
import { formatCurrency } from '../../../utils/format';
import { fromCents, toCents } from '../../../utils/money';
import {
  ItemizedSplitState, QuickSplitState, buildItemizedSplit, buildQuickSplit, emptyItemizedState, emptyQuickState,
  itemizedStateFrom, myPaymentToCoverCents, quickStateFrom, splitProblems,
} from '../../../utils/splits';
import { BillAmountMode, BillDueDateMode, BillFrequency, Transaction, TransactionSplit, TransactionType } from '../../../models';
import { BILL_FREQUENCIES } from '../../../utils/bill-schedule';
import { TransactionTemplate } from '../../../models';
import { QuickAddService } from '../../../services/quick-add.service';
import { ToastService } from '../../../services/toast.service';
import { ReceiptScanService } from '../../../services/receipt-scan.service';
import { ReceiptService } from '../../../services/receipt.service';
import { ReceiptAttach } from '../../../components/receipt-attach/receipt-attach';
import { FittedImage } from '../../../utils/image';
import {
  ReceiptScan, itemizedFromScan, scanAmountCents, scanBillCents, scanMismatchCents, scanTaxAndFeesCents, scanTaxParts,
} from '../../../utils/receipt';

@Component({
  selector: 'app-transaction-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal, ErrorBanner, SplitEditor, ItemizedSplitEditor, ReceiptAttach],
  templateUrl: './transaction-form.html',
  styleUrl: './transaction-form.scss'
})
export class TransactionForm implements OnChanges {
  accounts = inject(AccountService);
  categories = inject(CategoryService);
  billService = inject(BillService);
  templateService = inject(TransactionTemplateService);
  private transactionService = inject(TransactionService);
  private toastService = inject(ToastService);
  private quickAddService = inject(QuickAddService);
  private receiptScanner = inject(ReceiptScanService);
  private receipts = inject(ReceiptService);

  @Input() open = false;
  @Input() transaction: Transaction | null = null;
  @Input() draft: Partial<Transaction> | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  // Core transaction fields
  type: TransactionType = 'expense';
  amount: number = 0;
  date: string = this.localDateString();
  notes: string = '';
  merchant = signal('');
  accountId: string = '';
  categoryId = signal('');
  fromAccountId: string = '';
  toAccountId: string = '';
  isInternalTransfer = false;
  saveAsTemplate = signal(false);
  templateName = signal('');

  formatCurrency = formatCurrency;

  // ── Bill splitting (expenses) ──────────────────────────────
  splitOn = signal(false);
  /** "Whole bill" (quick) or "Item by item" (itemized, with tax and tip). */
  splitKind = signal<'quick' | 'itemized'>('quick');
  splitState = signal<QuickSplitState>(emptyQuickState());
  itemizedState = signal<ItemizedSplitState>(emptyItemizedState());
  /** The split saved on the transaction being edited, if any. */
  private existingSplit: TransactionSplit | null = null;

  /** Switching modes keeps who's on the bill and who paid; each mode keeps its own details. */
  setSplitKind(kind: 'quick' | 'itemized') {
    if (kind === this.splitKind()) return;
    const from = kind === 'itemized' ? this.splitState() : this.itemizedState();
    const carried = { participantIds: [...from.participantIds], otherPayments: from.otherPayments.map(p => ({ ...p })) };
    if (kind === 'itemized') this.itemizedState.update(s => ({ ...s, ...carried }));
    else this.splitState.update(s => ({ ...s, ...carried }));
    this.splitKind.set(kind);
  }

  // ── Receipt (expenses) ─────────────────────────────────────
  // A photo of the receipt, kept with the transaction (ReceiptService). It can
  // also be read to fill in the form (ReceiptScanService) — but attaching one
  // and reading it are separate: a receipt is worth keeping either way.

  /** The photo shown: a newly picked one, or the one already saved. */
  receiptImage = signal<string | null>(null);
  /** A photo picked in this form, stored when the transaction is saved. */
  private pendingReceipt: FittedImage | null = null;
  /** The saved photo was removed in this form; deleted when the transaction is saved. */
  private receiptRemoved = false;
  receiptLoading = signal(false);
  scanning = signal(false);
  /** The last receipt read into this form — kept for the note and saved as aiExtracted. */
  scanned = signal<ReceiptScan | null>(null);

  /**
   * A photo was taken or picked. It's attached; and on a blank new expense —
   * the "snap the receipt to log it" case — it's read straight away too.
   */
  async attachReceipt(file: File) {
    try {
      const photo = await this.receipts.fit(file);
      this.pendingReceipt = photo;
      this.receiptRemoved = false;
      this.receiptImage.set(photo.dataUrl);
    } catch (err: any) {
      this.toastService.error(err?.message || "Couldn't open that photo.");
      return;
    }
    const blank = !this.transaction && !Number(this.amount) && !this.merchant().trim();
    if (blank) await this.readReceipt();
  }

  removeReceipt() {
    this.pendingReceipt = null;
    this.receiptRemoved = !!this.transaction?.receiptId;
    this.receiptImage.set(null);
  }

  /** "Fill in from it": read the attached photo and fill in what's missing. */
  async readReceipt() {
    const image = this.receiptImage();
    if (!image || this.scanning()) return;
    this.scanning.set(true);
    try {
      const scan = await this.receiptScanner.scanImage(image);
      if (!scan.isReceipt) {
        this.toastService.error("That doesn't look like a receipt, so nothing was filled in. It's still attached.");
        return;
      }
      this.applyScan(scan);
    } catch (err: any) {
      this.toastService.error(err?.message || "Couldn't read that receipt.");
    } finally {
      this.scanning.set(false);
    }
  }

  /** The line under "Receipt attached". */
  receiptNote(): string {
    return 'Saved with this transaction, encrypted like the rest of your data. “Fill in from it” has OpenAI read it; OpenAI doesn’t keep it.';
  }

  /** Fetch the saved photo of the transaction being edited. */
  private loadReceipt(tx: Transaction) {
    this.pendingReceipt = null;
    this.receiptRemoved = false;
    this.receiptImage.set(null);
    if (!tx.receiptId) { this.receiptLoading.set(false); return; }
    const id = tx.receiptId;
    this.receiptLoading.set(true);
    this.receipts.load(id)
      .then(r => { if (this.transaction?.receiptId === id && !this.pendingReceipt) this.receiptImage.set(r?.image ?? null); })
      .catch(() => this.toastService.error("Couldn't load the receipt photo."))
      .finally(() => this.receiptLoading.set(false));
  }

  /**
   * What the receipt fills in. It never overwrites what you've typed: the
   * merchant only when empty, the date only on a new transaction still set to
   * today, the amount only when there isn't one. The items, tax and tip always
   * go into "Item by item", ready for when you split the bill.
   */
  applyScan(scan: ReceiptScan) {
    if (scan.merchant && !this.merchant().trim()) this.onMerchantChange(scan.merchant);
    if (scan.date && !this.transaction && this.date === this.localDateString()) this.date = scan.date;
    if (!Number(this.amount)) this.amount = fromCents(scanAmountCents(scan));
    if (this.splitKind() !== 'itemized') this.setSplitKind('itemized');
    this.itemizedState.update(s => itemizedFromScan(scan, s));
    this.scanned.set(scan);
  }

  /** "1 item · tax & fees −$4.71 · tip $0.00 · total $37.26" */
  scanSummary(scan: ReceiptScan): string {
    const n = scan.items.length;
    const parts = [`${n} item${n === 1 ? '' : 's'}`, `tax & fees ${this.signedMoney(scanTaxAndFeesCents(scan))}`, `tip ${this.signedMoney(scan.tipCents)}`];
    if (scan.totalCents !== null) parts.push(`total ${this.signedMoney(scan.totalCents)}`);
    return parts.join(' · ');
  }

  /**
   * What "Tax & fees" is made of, when it's more than the tax alone:
   * "Tax $3.64 · Discount −$2.10 · DoorDash Credits −$6.25". Empty otherwise.
   */
  scanTaxBreakdown(scan: ReceiptScan): string {
    if (!scan.fees.length && !scan.discounts.length) return '';
    return scanTaxParts(scan).map(p => `${p.name} ${this.signedMoney(p.cents)}`).join(' · ');
  }

  /** Cents as "$3.64" or "−$2.10". */
  private signedMoney(cents: number): string {
    return cents < 0 ? `−${formatCurrency(fromCents(-cents))}` : formatCurrency(fromCents(cents));
  }

  /** When the lines and the printed total disagree, say so — a line was probably misread. */
  scanWarning(scan: ReceiptScan): string {
    const gap = scanMismatchCents(scan);
    if (gap !== 0) {
      return `The lines add up to ${formatCurrency(fromCents(scanBillCents(scan)))}, but the receipt's total is `
        + `${formatCurrency(fromCents(scan.totalCents ?? 0))}. A line may have been misread — check the items before saving.`;
    }
    if (scan.confidence < 0.6) return 'Parts of this receipt were hard to read. Check the numbers before saving.';
    return '';
  }

  /** "Use $X as the amount" from the itemized editor, when the receipt and the amount disagree. */
  useSplitAmount(cents: number) {
    this.amount = fromCents(cents);
  }

  /** What you paid, in cents: the amount field, which is your payment on the bill. */
  amountCents(): number {
    return toCents(Number(this.amount) || 0);
  }

  /** Money back already recorded on the expense being edited, for the note in place of the old refund toggle. */
  moneyBack(): number {
    return this.transaction?.type === 'expense' ? this.transactionService.moneyBackFor(this.transaction) : 0;
  }

  // Returns today's date as YYYY-MM-DD in LOCAL time — never UTC
  private localDateString(d: Date = new Date()): string {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Bill fields — shown when Subscriptions category is selected
  billFrequency: BillFrequency = 'monthly';
  billFrequencies = BILL_FREQUENCIES;
  billNextDueDate: string = '';
  billAmountMode: BillAmountMode = 'fixed';
  billDueDateMode: BillDueDateMode = 'exact';
  billAutopay: boolean = true;

  submitting = signal(false);

  filteredCategories() {
    const kind = this.type === 'income' ? 'income' : 'expense';
    return this.categories.categories().filter(c => c.kind === kind && !c.archived);
  }

  activeAccounts = computed(() =>
    this.accounts.accounts().filter(a => !a.archived)
  );

  // True when selected category is "Subscriptions" (or contains "subscription")
  isSubscription = computed(() => {
    if (!this.categoryId()) return false;
    const cat = this.categories.categories().find(c => c.id === this.categoryId());
    return cat?.name.toLowerCase().includes('subscription') ?? false;
  });

  hasExistingBill = computed(() => {
    const term = this.merchant().trim().toLowerCase();
    if (!term) return false;
    return this.billService.bills().some(b => b.name && b.name.toLowerCase() === term);
  });

  availableTemplates() {
    return this.templateService.templates()
      .filter(t => t.type === this.type)
      .slice(0, 6);
  }

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) {
      this.load();
    }
  }

  private load() {
    if (this.transaction) {
      this.type = this.transaction.type;
      this.amount = this.transaction.amount;
      this.date = this.transaction.date;
      this.notes = this.transaction.notes || '';
      this.merchant.set(this.transaction.merchant || '');
      this.accountId = this.transaction.accountId || '';
      this.categoryId.set(this.transaction.categoryId || '');
      this.fromAccountId = this.transaction.fromAccountId || '';
      this.toAccountId = this.transaction.toAccountId || '';
      this.isInternalTransfer = this.transaction.isInternalTransfer || false;
      this.existingSplit = this.transaction.split ?? null;
      this.splitOn.set(!!this.existingSplit && this.transaction.type === 'expense');
      const itemized = this.existingSplit?.mode === 'itemized';
      this.splitKind.set(itemized ? 'itemized' : 'quick');
      this.splitState.set(this.existingSplit && !itemized ? quickStateFrom(this.existingSplit) : emptyQuickState());
      this.itemizedState.set(this.existingSplit && itemized ? itemizedStateFrom(this.existingSplit) : emptyItemizedState());
      this.saveAsTemplate.set(false);
      this.templateName.set('');
      this.scanned.set(null);
      this.loadReceipt(this.transaction);
    } else {
      this.type = this.quickAddService.defaultType() || 'expense';
      this.amount = 0;
      this.date = this.localDateString(); // local date, not UTC
      this.notes = '';
      this.merchant.set('');
      this.applySmartDefaultsForType();
      this.applyDraft();
      this.existingSplit = null;
      this.splitOn.set(false);
      this.splitKind.set('quick');
      this.splitState.set(emptyQuickState());
      this.itemizedState.set(emptyItemizedState());
      this.saveAsTemplate.set(false);
      this.templateName.set('');
      this.scanned.set(null);
      this.pendingReceipt = null;
      this.receiptRemoved = false;
      this.receiptImage.set(null);
      this.receiptLoading.set(false);
    }

    // Default bill fields
    this.billFrequency = 'monthly';
    this.billNextDueDate = this.nextMonthDate(this.date);
    this.billAmountMode = 'fixed';
    this.billDueDateMode = 'exact';
    this.billAutopay = true;

    setTimeout(() => this.resetNotesHeight(), 0);
  }

  // When category changes, update nextDueDate default from current date
  onCategoryChange(val: string) {
    this.categoryId.set(val);
    if (this.isSubscription()) {
      this.billNextDueDate = this.nextMonthDate(this.date);
    }
  }

  setBillAmountMode(mode: BillAmountMode) {
    this.billAmountMode = mode;
    this.syncBillAutopay();
  }

  setBillDueDateMode(mode: BillDueDateMode) {
    this.billDueDateMode = mode;
    this.syncBillAutopay();
  }

  toggleBillAutopay() {
    if (!this.canAutopayBill()) return;
    this.billAutopay = !this.billAutopay;
  }

  canAutopayBill(): boolean {
    return this.billAmountMode === 'fixed' && this.billDueDateMode === 'exact';
  }

  billAmountLabel(): string {
    return this.billAmountMode === 'fixed' ? 'Fixed amount' : 'Variable amount';
  }

  billDateLabel(): string {
    return this.billDueDateMode === 'exact' ? 'Exact due date' : 'Flexible monthly reminder';
  }

  private syncBillAutopay() {
    if (!this.canAutopayBill()) {
      this.billAutopay = false;
    }
  }

  private nextMonthDate(fromDate: string): string {
    const d = new Date(fromDate + 'T00:00:00');
    d.setMonth(d.getMonth() + 1);
    return this.localDateString(d);
  }

  private applyDraft() {
    if (!this.draft) return;
    if (this.draft.type) this.type = this.draft.type;
    if (typeof this.draft.amount === 'number') this.amount = this.draft.amount;
    if (this.draft.date) this.date = this.draft.date;
    if (this.draft.notes) this.notes = this.draft.notes;
    if (this.draft.merchant) this.merchant.set(this.draft.merchant);
    if (this.draft.accountId) this.accountId = this.draft.accountId;
    if (this.draft.categoryId) this.categoryId.set(this.draft.categoryId);
    if (this.draft.fromAccountId) this.fromAccountId = this.draft.fromAccountId;
    if (this.draft.toAccountId) this.toAccountId = this.draft.toAccountId;
  }

  onNotesInput(event: Event) {
    const el = event.target as HTMLTextAreaElement;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 200) + 'px';
  }

  private resetNotesHeight() {
    const el = document.querySelector<HTMLTextAreaElement>('textarea[name="notes"]');
    if (!el) return;
    el.style.height = 'auto';
    if (el.value) {
      el.style.height = Math.min(el.scrollHeight, 200) + 'px';
    }
  }

  setType(t: TransactionType) {
    this.type = t;
    this.applySmartDefaultsForType();
    this.saveAsTemplate.set(false);
    this.templateName.set('');
  }

  onMerchantChange(value: string) {
    this.merchant.set(value);
    if (this.transaction || this.type === 'transfer') return;
    const match = this.findRecentMerchantMatch(value);
    if (!match) return;
    if (match.accountId && this.activeAccounts().some(a => a.id === match.accountId)) {
      this.accountId = match.accountId;
    }
    if (match.categoryId && this.filteredCategories().some(c => c.id === match.categoryId)) {
      this.categoryId.set(match.categoryId);
    }
  }

  private applySmartDefaultsForType() {
    const first = this.activeAccounts()[0];
    const second = this.activeAccounts()[1];
    const recent = this.findRecentByType(this.type);

    if (this.type === 'transfer') {
      this.categoryId.set('');
      this.accountId = '';
      this.fromAccountId = recent?.fromAccountId || first?.id || '';
      this.toAccountId = recent?.toAccountId || second?.id || '';
      if (this.fromAccountId === this.toAccountId) {
        this.toAccountId = this.activeAccounts().find(a => a.id !== this.fromAccountId)?.id || '';
      }
      return;
    }

    this.fromAccountId = first?.id || '';
    this.toAccountId = second?.id || '';
    this.accountId = recent?.accountId || first?.id || '';
    this.categoryId.set(recent?.categoryId || '');
  }

  private findRecentByType(type: TransactionType): Transaction | undefined {
    return this.transactionService.transactions().find(t => t.type === type);
  }

  private findRecentMerchantMatch(value: string): Transaction | undefined {
    const term = value.trim().toLowerCase();
    if (term.length < 2) return undefined;
    return this.transactionService.transactions().find(t =>
      t.type === this.type &&
      !!t.merchant &&
      t.merchant.trim().toLowerCase() === term
    );
  }

  async applyTemplate(template: TransactionTemplate) {
    this.type = template.type;
    this.amount = template.amount || 0;
    this.notes = template.notes || '';
    this.merchant.set(template.merchant || '');
    this.accountId = template.accountId || this.accountId;
    this.categoryId.set(template.categoryId || '');
    this.fromAccountId = template.fromAccountId || this.fromAccountId;
    this.toAccountId = template.toAccountId || this.toAccountId;
    this.saveAsTemplate.set(false);
    this.templateName.set('');
    if (template.id) {
      try {
        await this.templateService.recordUse(template.id);
      } catch (err) {
        this.toastService.error('Template loaded, but usage could not be updated.');
      }
    }
    setTimeout(() => this.resetNotesHeight(), 0);
  }

  async deleteTemplate(event: Event, template: TransactionTemplate) {
    event.stopPropagation();
    if (!template.id) return;
    try {
      await this.templateService.remove(template.id);
      this.toastService.success('Template deleted.');
    } catch (err) {
      this.toastService.error('Template could not be deleted.');
    }
  }

  templateLabel(template: TransactionTemplate): string {
    if (template.type === 'transfer') return template.name;
    const amount = template.amount ? `$${template.amount.toFixed(2)}` : '';
    return amount ? `${template.name} · ${amount}` : template.name;
  }

  defaultTemplateName(): string {
    if (this.type === 'transfer') return 'Transfer';
    return this.merchant().trim() || (this.type === 'income' ? 'Income' : 'Expense');
  }

  private async saveCurrentAsTemplate() {
    if (!this.saveAsTemplate() || this.transaction) return;
    const name = this.templateName().trim() || this.defaultTemplateName();
    const base = {
      name,
      type: this.type,
      amount: Number(this.amount),
      ...(this.notes.trim() ? { notes: this.notes.trim() } : {}),
    };

    if (this.type === 'transfer') {
      await this.templateService.add({
        ...base,
        fromAccountId: this.fromAccountId,
        toAccountId: this.toAccountId,
      });
    } else {
      await this.templateService.add({
        ...base,
        merchant: this.merchant().trim(),
        accountId: this.accountId,
        ...(this.categoryId() ? { categoryId: this.categoryId() } : {}),
      });
    }
  }

  async save() {
    if (this.submitting()) return;
    if (!this.amount || this.amount <= 0) {
      this.toastService.error('Amount must be greater than zero');
      return;
    }
    // Snapshot every field into locals up front. save() awaits saveCurrentAsTemplate()
    // and billService.add() below — if the modal gets closed/reopened for another add
    // while those are in flight (easy to trigger on a slow mobile connection: tap Save,
    // nothing visibly happens, tap Cancel, tap +Add again), ngOnChanges' load() resets
    // this.amount/fromAccountId/toAccountId/etc. Reading `this.x` again after an await
    // would then emit whatever the form was reset to, not what the user actually
    // entered — producing a stray blank transaction. Locals make that impossible.
    const type = this.type;
    const amount = Number(this.amount);
    const date = this.date;
    const notes = this.notes.trim();

    if (type === 'transfer') {
      const fromAccountId = this.fromAccountId;
      const toAccountId = this.toAccountId;
      if (!fromAccountId || !toAccountId) {
        this.toastService.error('Please select both accounts');
        return;
      }
      if (fromAccountId === toAccountId) {
        this.toastService.error('From and To must be different accounts');
        return;
      }
      this.submitting.set(true);
      try {
        await this.saveCurrentAsTemplate();
      } catch (err) {
        this.toastService.error('Transaction template could not be saved.');
        this.submitting.set(false);
        return;
      }
      this.saved.emit({
        type: 'transfer',
        amount,
        date,
        fromAccountId,
        toAccountId,
        ...(notes ? { notes } : {}),
      });
      this.submitting.set(false);
    } else {
      const merchant = this.merchant().trim();
      const accountId = this.accountId;
      const categoryId = this.categoryId();
      const isInternalTransfer = this.isInternalTransfer;
      // Same reasoning as the snapshot above: read before the await, not after,
      // so a form reset in flight can't swap in stale bill settings.
      const isSubscription = this.isSubscription();
      const canAutopayBill = this.canAutopayBill();
      const billAmountMode = this.billAmountMode;
      const billFrequency = this.billFrequency;
      const billNextDueDate = this.billNextDueDate;
      const billDueDateMode = this.billDueDateMode;
      const billAutopay = this.billAutopay;
      const isNewTransaction = !this.transaction;
      const scanned = type === 'expense' ? this.scanned() : null;
      const pendingReceipt = type === 'expense' ? this.pendingReceipt : null;
      const receiptRemoved = type === 'expense' && this.receiptRemoved;
      const oldReceiptId = this.transaction?.receiptId;
      if (!accountId) { this.toastService.error('Please select an account'); return; }
      if (!merchant) { this.toastService.error('Merchant or source is required'); return; }

      // The split is built here, from the amount as it is now, and checked before
      // anything is saved: "what you're owed" must rest on a bill that adds up.
      let split: TransactionSplit | undefined;
      if (type === 'expense' && this.splitOn()) {
        const itemized = this.splitKind() === 'itemized';
        split = itemized
          ? buildItemizedSplit(this.itemizedState(), toCents(amount), this.existingSplit)
          : buildQuickSplit(this.splitState(), toCents(amount), this.existingSplit);
        const problems = splitProblems(split, toCents(amount));
        if (problems.includes('no-one-else')) { this.toastService.error('Add someone to split this bill with.'); return; }
        if (problems.includes('unassigned')) {
          this.toastService.error(itemized ? "Some items aren't anyone's yet." : 'Give someone a share of the bill before saving.');
          return;
        }
        if (problems.includes('not-covered')) {
          const cover = formatCurrency(fromCents(myPaymentToCoverCents(this.itemizedState())));
          this.toastService.error(`The receipt says you paid ${cover}. Fix the items or the amount before saving.`);
          return;
        }
      }

      this.submitting.set(true);

      // A new photo is stored first, so the transaction can point at it.
      let receiptId = oldReceiptId;
      if (pendingReceipt) {
        try {
          receiptId = await this.receipts.save(pendingReceipt);
        } catch (err: any) {
          this.toastService.error(err?.message || "The receipt photo couldn't be saved. Try again, or remove it to save without it.");
          this.submitting.set(false);
          return;
        }
      } else if (receiptRemoved) {
        receiptId = undefined;
      }
      const receiptChanged = receiptId !== oldReceiptId;

      try {
        await this.saveCurrentAsTemplate();
      } catch (err) {
        this.toastService.error('Transaction template could not be saved.');
        this.submitting.set(false);
        return;
      }

      // Emit the transaction first
      this.saved.emit({
        type,
        amount,
        date,
        merchant,
        accountId,
        ...(categoryId ? { categoryId } : {}),
        ...(notes ? { notes } : {}),
        isInternalTransfer,
        // Filled in from a receipt: marked so it can be told apart later.
        ...(scanned ? { aiExtracted: true, aiConfidence: scanned.confidence } : {}),
        // A new receipt photo, or none any more (undefined is dropped when saved).
        ...(receiptChanged ? { receiptId } : {}),
        // Turning the split off on an edit clears it; undefined is dropped when saved.
        ...(split ? { split } : this.existingSplit ? { split: undefined } : {}),
      });

      // The photo it replaced, or that was removed, isn't needed any more.
      if (receiptChanged && oldReceiptId) {
        this.receipts.remove(oldReceiptId).catch(err => console.warn('Could not delete the old receipt photo:', err));
      }

      // If Subscriptions category selected, auto-create bill if one doesn't exist yet
      if (isSubscription && merchant && isNewTransaction) {
        const existing = this.billService.bills().find(
          b => b.name.toLowerCase() === merchant.toLowerCase()
        );
        if (!existing) {
          try {
            await this.billService.add({
              name: merchant,
              amount,
              amountMode: billAmountMode,
              frequency: billFrequency,
              nextDueDate: billNextDueDate || this.nextMonthDate(date),
              dueDateMode: billDueDateMode,
              accountId,
              categoryId,
              autopayEnabled: canAutopayBill && billAutopay,
              icon: '📄',
              active: true,
            });
          } catch (err) {
            console.warn('Could not auto-create bill:', err);
          }
        }
      }
      this.submitting.set(false);
    }
  }
}
