import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { ToastService } from '../../../services/toast.service';
import { TransactionService } from '../../../services/transaction.service';
import { AccountService } from '../../../services/account.service';
import { LoanMethod, LoanTerms, ManualAsset, ManualAssetType, Valuation } from '../../../models';
import { MANUAL_TYPES, manualType, sortedValuations, valueOn, withValuation } from '../../../utils/net-worth';
import {
  defaultDepreciation, equivalentReducingRate, flatInterest, isLoanType, loanDirection,
  loanPayments, monthlyPayment, schedule,
} from '../../../utils/loans';
import { localDateString, parseLocalDate } from '../../../utils/date';

export type AssetFormResult = Omit<ManualAsset, 'id' | 'createdAt' | 'updatedAt'>;

/** What the form hands back: the entry, plus the thing a new loan bought, if you asked for it. */
export interface AssetFormSave {
  entry: AssetFormResult;
  alsoCreate?: AssetFormResult;
}

const TERMS = [12, 24, 36, 48, 60, 72, 84, 120, 180, 240, 360];

/**
 * Add or edit something you own or owe that has no bank connection.
 *
 * Plain entries (a house, a watch) take a value and an "as of" date; changing
 * the value adds to its history rather than overwriting it.
 *
 * Loans take their terms instead — amount, interest method, rate, term — and
 * the balance then follows the payments that actually happen. A car bought on
 * finance can add the car in the same step, so net worth sees both sides.
 */
@Component({
  selector: 'app-asset-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './asset-form.html',
  styleUrl: './asset-form.scss',
})
export class AssetForm implements OnChanges {
  private toast = inject(ToastService);
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);

  @Input() open = false;
  @Input() asset: ManualAsset | null = null;
  /** The entry this one is linked to (the car a loan bought), for display. */
  @Input() linkedName: string | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<AssetFormSave>();
  @Output() deleteRequested = new EventEmitter<void>();

  readonly owns = MANUAL_TYPES.filter(t => t.side === 'asset');
  readonly owes = MANUAL_TYPES.filter(t => t.side === 'liability');
  readonly terms = TERMS;
  readonly today = localDateString();

  type: ManualAssetType = 'property';
  name = '';
  notes = '';

  // Plain value
  value: number | null = null;
  asOf = this.today;
  history: Valuation[] = [];

  // Things that lose value
  purchasePrice: number | null = null;
  purchaseDate = this.today;
  depreciate = false;

  // Loans
  owedTo: 'me' | 'someone-else' = 'me';
  counterparty = '';
  method: LoanMethod = 'reducing';
  price: number | null = null;
  downPayment: number | null = null;
  amount: number | null = null;
  rate: number | null = null;
  termMonths = 60;
  customTerm = false;
  startDate = this.today;
  firstPaymentDate = '';
  payment: number | null = null;
  dueMode: 'exact' | 'flexible' | 'none' = 'exact';
  /** For a loan that began before Trackr: earlier payments were made on schedule. */
  settledEarlier = false;
  settledThrough = this.today;
  lateDays: number | null = 10;
  /** Set once you type your own payment; until then it follows the terms. */
  paymentEdited = false;
  matchText = '';
  matchAccountId = '';
  alsoAdd = true;
  private existingLoan: LoanTerms | undefined;

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) this.load();
  }

  private load() {
    const a = this.asset;
    this.type = a?.type ?? 'property';
    this.name = a?.name ?? '';
    this.notes = a?.notes ?? '';
    this.history = a ? sortedValuations(a) : [];
    this.asOf = this.today;
    this.value = a && !a.loan ? valueOn({ ...a, valuations: this.history }, this.today) : null;

    this.purchasePrice = a?.purchase?.price ?? null;
    this.purchaseDate = a?.purchase?.date ?? this.today;
    this.depreciate = (a?.depreciationRate ?? 0) > 0;

    const l = a?.loan;
    this.existingLoan = l;
    // An entry from before loans had terms: start from its first recorded balance.
    const first = this.history[0];
    this.owedTo = l?.owedTo ?? 'me';
    this.counterparty = l?.counterparty ?? '';
    this.method = l?.method ?? 'reducing';
    this.price = l?.price ?? null;
    this.downPayment = l?.downPayment ?? null;
    this.amount = l?.amountFinanced ?? (first && !l ? first.value : null);
    this.rate = l?.rate ?? null;
    this.termMonths = l?.termMonths ?? 60;
    this.customTerm = !TERMS.includes(this.termMonths);
    this.startDate = l?.startDate ?? (first && !l ? first.date : this.today);
    this.firstPaymentDate = l?.firstPaymentDate ?? this.oneMonthAfter(this.startDate);
    this.payment = l?.payment ?? null;
    this.dueMode = l?.dueMode ?? (this.type === 'loan-given' ? 'flexible' : 'exact');
    this.lateDays = l?.lateDays ?? 10;
    this.settledEarlier = !!l?.settledThrough;
    this.settledThrough = l?.settledThrough ?? this.today;
    this.paymentEdited = !!l && l.payment !== this.calculatedPayment;
    this.matchText = l?.match?.text ?? '';
    this.matchAccountId = l?.match?.accountId ?? '';
    this.alsoAdd = !a;
  }

  // ── What kind of thing ─────────────────────────────────────
  get isLoan() { return isLoanType(this.type); }
  get isLent() { return this.isLoan && loanDirection(this.type) === 'lent'; }
  get isDebt() { return manualType(this.type).side === 'liability'; }
  get losesValue() { return this.type === 'vehicle'; }
  /** Loans that usually buy something worth adding alongside. */
  get buysSomething() { return this.type === 'auto-loan' || this.type === 'mortgage'; }
  get boughtLabel() { return this.type === 'mortgage' ? 'home' : 'car'; }

  onTypeChange() {
    if (this.losesValue && !this.asset) this.depreciate = defaultDepreciation(this.type) > 0;
    // Money lent between people rarely lands on the same day each month.
    if (!this.existingLoan) this.dueMode = this.type === 'loan-given' ? 'flexible' : 'exact';
  }

  get namePlaceholder(): string {
    return ({
      property: 'e.g. Home', vehicle: 'e.g. 2021 Honda Civic', investment: 'e.g. Fidelity 401(k)',
      cash: 'e.g. Security deposit', valuable: 'e.g. Watch', 'loan-given': 'e.g. Loan to Ravi',
      'other-asset': 'e.g. Something you own',
      mortgage: 'e.g. Home mortgage', 'auto-loan': 'e.g. Corolla loan', 'student-loan': 'e.g. Federal student loan',
      'personal-loan': 'e.g. Loan from family', 'other-liability': 'e.g. Medical bill',
    } as Record<ManualAssetType, string>)[this.type];
  }

  // ── Loan maths, live ───────────────────────────────────────
  /** With a price, the amount borrowed is price − down payment. */
  get financed(): number {
    if (this.price && this.price > 0) return Math.max(0, this.price - (this.downPayment || 0));
    return Number(this.amount) || 0;
  }

  get calculatedPayment(): number {
    return monthlyPayment(this.financed, Number(this.rate) || 0, this.termMonths, this.method);
  }

  /** The payment used: yours if you typed one, otherwise the calculated EMI. */
  get effectivePayment(): number {
    return this.paymentEdited && this.payment ? Number(this.payment) : this.calculatedPayment;
  }

  /** The first payment has already come round — so there's a past to account for. */
  get startedInPast(): boolean {
    return !!this.firstPaymentDate && this.firstPaymentDate < this.today;
  }

  onTermsChange() {
    if (!this.paymentEdited) this.payment = this.calculatedPayment || null;
  }

  onPaymentInput(v: number | null) {
    this.payment = v;
    this.paymentEdited = v !== null && Number(v) !== this.calculatedPayment;
  }

  resetPayment() {
    this.paymentEdited = false;
    this.payment = this.calculatedPayment || null;
  }

  onStartChange() {
    if (!this.existingLoan) this.firstPaymentDate = this.oneMonthAfter(this.startDate);
  }

  setTerm(v: string) {
    if (v === 'custom') { this.customTerm = true; return; }
    this.customTerm = false;
    this.termMonths = Number(v);
    this.onTermsChange();
  }

  get summary() {
    const terms = this.draftTerms();
    if (!terms || terms.amountFinanced <= 0 || terms.payment <= 0) return null;
    const rows = schedule(terms);
    const interest = Math.round(rows.reduce((s, r) => s + r.interest, 0) * 100) / 100;
    return {
      payment: terms.payment,
      interest,
      total: Math.round((terms.amountFinanced + interest) * 100) / 100,
      months: rows.length,
      payoff: rows[rows.length - 1]?.date ?? null,
      equivalent: this.method === 'flat' && Number(this.rate) > 0
        ? equivalentReducingRate(Number(this.rate), this.termMonths) : null,
      flatInterest: this.method === 'flat' ? flatInterest(terms.amountFinanced, Number(this.rate) || 0, this.termMonths) : null,
    };
  }

  // ── Recognising payments ───────────────────────────────────
  accounts() { return this.accountService.accounts().filter(a => !a.archived); }

  /** What the matching rule would pick up right now — so you can see it work before saving. */
  get matchPreview() {
    const terms = this.draftTerms();
    if (!terms || !this.matchText.trim()) return null;
    const found = loanPayments({ type: this.type, loan: terms } as ManualAsset, this.txService.transactions())
      .filter(p => p.kind === 'payment' && p.how === 'matched');
    return { count: found.length, recent: found.slice(-3).reverse().map(p => p.tx) };
  }

  /** Terms as they'd be saved, for the live summary and preview. */
  private draftTerms(): LoanTerms | null {
    if (!this.isLoan) return null;
    const terms: LoanTerms = {
      method: this.method,
      startDate: this.startDate,
      amountFinanced: Math.round(this.financed * 100) / 100,
      rate: this.method === 'none' ? 0 : Number(this.rate) || 0,
      termMonths: Number(this.termMonths) || 0,
      firstPaymentDate: this.firstPaymentDate || this.oneMonthAfter(this.startDate),
      dueMode: this.dueMode,
      payment: this.effectivePayment,
      paymentIds: this.existingLoan?.paymentIds ?? [],
      ignoredIds: this.existingLoan?.ignoredIds ?? [],
    };
    if (this.startedInPast && this.settledEarlier && this.settledThrough) terms.settledThrough = this.settledThrough;
    if (this.dueMode === 'flexible') terms.lateDays = Math.max(0, Math.round(Number(this.lateDays) || 0));
    if (this.isLent) terms.owedTo = this.owedTo;
    if (this.counterparty.trim()) terms.counterparty = this.counterparty.trim();
    if (this.price && this.price > 0) terms.price = Number(this.price);
    if (this.downPayment && this.downPayment > 0) terms.downPayment = Number(this.downPayment);
    if (this.matchText.trim()) {
      terms.match = { text: this.matchText.trim() };
      if (this.matchAccountId) terms.match.accountId = this.matchAccountId;
    }
    if (this.existingLoan?.downPaymentId) terms.downPaymentId = this.existingLoan.downPaymentId;
    if (this.existingLoan?.corrections?.length) terms.corrections = this.existingLoan.corrections;
    return terms;
  }

  // ── Value history (plain entries) ──────────────────────────
  removeValuation(v: Valuation) {
    this.history = this.history.filter(h => h !== v);
  }

  // ── Save ───────────────────────────────────────────────────
  save() {
    const name = this.name.trim();
    if (!name) { this.toast.error('Give it a name.'); return; }
    if (this.isLoan) return this.saveLoan(name);

    const entry: AssetFormResult = { name, type: this.type, valuations: this.history };
    if (this.notes.trim()) entry.notes = this.notes.trim();

    if (this.losesValue && this.depreciate) {
      // The estimate needs a starting point: the price you paid, or failing
      // that, the value you're entering now.
      const hasPrice = !!this.purchasePrice && this.purchasePrice > 0;
      const hasValue = this.value !== null && (this.value as unknown) !== '' && Number(this.value) > 0;
      if (!hasPrice && !hasValue) { this.toast.error('Enter what you paid for it, or what it is worth now.'); return; }
      if (hasPrice && (!this.purchaseDate || this.purchaseDate > this.today)) { this.toast.error('Pick when you bought it.'); return; }
      entry.purchase = hasPrice
        ? { price: Number(this.purchasePrice), date: this.purchaseDate }
        : { price: Number(this.value), date: this.asOf };
      entry.depreciationRate = defaultDepreciation(this.type) || 0.15;
    } else if (this.losesValue && this.purchasePrice) {
      entry.purchase = { price: Number(this.purchasePrice), date: this.purchaseDate };
      entry.depreciationRate = 0;
    }

    // A value is required unless the estimate covers it.
    const v = this.value === null || (this.value as unknown) === '' ? null : Number(this.value);
    if (v !== null) {
      if (!isFinite(v) || v < 0) { this.toast.error('Enter a value of zero or more.'); return; }
      if (!this.asOf || this.asOf > this.today) { this.toast.error('Pick a date that isn\'t in the future.'); return; }
      const current = valueOn({ valuations: this.history } as ManualAsset, this.asOf);
      if (current !== v) entry.valuations = withValuation(this.history, this.asOf, v);
    }
    if (!entry.valuations.length && !entry.purchase) {
      this.toast.error(this.isDebt ? 'Enter how much you owe.' : 'Enter what it is worth.');
      return;
    }
    if (this.asset?.linkedId) entry.linkedId = this.asset.linkedId;
    this.saved.emit({ entry });
  }

  private saveLoan(name: string) {
    const terms = this.draftTerms()!;
    if (terms.amountFinanced <= 0) { this.toast.error(this.isLent ? 'Enter how much was lent.' : 'Enter how much you borrowed.'); return; }
    if (this.method !== 'none' && !(Number(this.rate) > 0)) { this.toast.error('Enter the interest rate, or choose "No interest".'); return; }
    if (!(terms.termMonths > 0)) { this.toast.error('Enter how many months the loan runs.'); return; }
    if (!this.startDate || this.startDate > this.today) { this.toast.error('Pick when the loan started (not in the future).'); return; }
    if (terms.firstPaymentDate < this.startDate) { this.toast.error('The first payment can\'t be before the loan starts.'); return; }
    if (terms.settledThrough && (terms.settledThrough > this.today || terms.settledThrough < this.startDate)) {
      this.toast.error('"Paid on schedule up to" must be between the start and today.');
      return;
    }
    if (!(terms.payment > 0)) { this.toast.error('Enter the monthly payment.'); return; }
    if (this.dueMode === 'flexible' && !(Number(this.lateDays) >= 0 && Number(this.lateDays) <= 27)) {
      this.toast.error('Enter how many days late a payment can be (0–27).');
      return;
    }

    // A loan's balance comes from its terms and payments; old plain values don't apply.
    const entry: AssetFormResult = { name, type: this.type, valuations: [], loan: terms };
    if (this.notes.trim()) entry.notes = this.notes.trim();
    if (this.asset?.linkedId) entry.linkedId = this.asset.linkedId;

    let alsoCreate: AssetFormResult | undefined;
    if (!this.asset && this.buysSomething && this.alsoAdd) {
      const isCar = this.type === 'auto-loan';
      alsoCreate = {
        name: isCar ? name.replace(/\s*loan$/i, '') || 'Car' : name.replace(/\s*mortgage$/i, '') || 'Home',
        type: isCar ? 'vehicle' : 'property',
        valuations: [],
        purchase: { price: terms.price ?? terms.amountFinanced + (terms.downPayment ?? 0), date: terms.startDate },
        depreciationRate: isCar ? 0.15 : 0,
      };
      // A home doesn't follow a curve; record its price as its value.
      if (!isCar) alsoCreate.valuations = [{ date: terms.startDate, value: alsoCreate.purchase!.price }];
    }
    this.saved.emit({ entry, alsoCreate });
  }

  // ── Helpers ────────────────────────────────────────────────
  private oneMonthAfter(date: string): string {
    const d = parseLocalDate(date);
    const target = new Date(d.getFullYear(), d.getMonth() + 1, 1);
    const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(d.getDate(), last));
    return localDateString(target);
  }

  formatDate(d: string) {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  money(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  termLabel(m: number) {
    return m % 12 === 0 ? `${m} months (${m / 12} yr${m === 12 ? '' : 's'})` : `${m} months`;
  }
}
