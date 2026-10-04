import { LoanMethod, LoanTerms, ManualAsset, ManualAssetType, Transaction } from '../models';
import { localDateString, parseLocalDate } from './date';

/**
 * Loans: what a payment is, how much is still owed, and what is left to pay.
 *
 * Two interest methods, both in common use:
 *
 *  - **Reducing balance (EMI).** How banks, car lenders and mortgages work.
 *      EMI = P·r·(1+r)ⁿ / ((1+r)ⁿ − 1),   r = annual rate ÷ 12
 *    Each month's interest is charged on what is still owed, so early payments
 *    are mostly interest and later ones mostly principal.
 *
 *  - **Flat rate.** Interest on the original amount for the whole term,
 *      interest = P × rate × years,   EMI = (P + interest) ÷ n
 *    Every payment carries the same interest. A flat rate costs far more than
 *    the same number as a reducing rate — `equivalentReducingRate` says how much.
 *
 * Plus interest-free loans (family, friends): EMI = P ÷ n.
 *
 * The balance is driven by payments that actually happened, not by assuming
 * the schedule was followed. Interest builds up on each due date; a payment
 * clears that interest first and the rest reduces the principal. So a missed
 * month leaves interest owing, a double payment catches up, and an extra
 * payment goes straight to principal — whichever method the loan uses.
 *
 * Pure functions: the Net worth page, the loan page and the tests share them.
 */

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Loan types you owe on. Everything else with terms is money you lent. */
export const BORROWED_TYPES: ManualAssetType[] = ['mortgage', 'auto-loan', 'student-loan', 'personal-loan', 'other-liability'];

export type LoanDirection = 'borrowed' | 'lent';

export function loanDirection(type: ManualAssetType): LoanDirection {
  return BORROWED_TYPES.includes(type) ? 'borrowed' : 'lent';
}

/** Types that are loans with terms. "Other debt" (a medical bill, say) is just an amount. */
export const LOAN_TYPES: ManualAssetType[] = ['auto-loan', 'mortgage', 'student-loan', 'personal-loan', 'loan-given'];

export function isLoanType(type: ManualAssetType): boolean {
  return LOAN_TYPES.includes(type);
}

/** Lent on someone else's behalf (Dad's loan, repaid to you): tracked, not yours. */
export function countsInNetWorth(asset: ManualAsset): boolean {
  return !(asset.loan && loanDirection(asset.type) === 'lent' && asset.loan.owedTo === 'someone-else');
}

// ── Formulas ─────────────────────────────────────────────────

export function monthlyPayment(principal: number, ratePct: number, months: number, method: LoanMethod): number {
  if (principal <= 0 || months <= 0) return 0;
  if (method === 'none' || ratePct <= 0) return round2(principal / months);
  if (method === 'flat') return round2((principal + flatInterest(principal, ratePct, months)) / months);
  const r = ratePct / 1200;
  const f = Math.pow(1 + r, months);
  return round2(principal * r * f / (f - 1));
}

/** Total interest on a flat-rate loan: P × rate × years. */
export function flatInterest(principal: number, ratePct: number, months: number): number {
  return round2(principal * (ratePct / 100) * (months / 12));
}

/**
 * The reducing-balance rate that costs the same as a flat rate — the honest
 * number. 4.2% flat over 5 years is about 7.8% the way banks quote it.
 */
export function equivalentReducingRate(flatRatePct: number, months: number): number {
  if (flatRatePct <= 0 || months <= 0) return 0;
  const target = monthlyPayment(1000, flatRatePct, months, 'flat');
  let lo = 0, hi = 100;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (monthlyPayment(1000, mid, months, 'reducing') < target) lo = mid; else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 100) / 100;
}

/** Interest that builds up on one due date. */
function periodInterest(terms: LoanTerms, principalLeft: number): number {
  if (terms.method === 'none' || terms.rate <= 0) return 0;
  if (terms.method === 'flat') return round2(flatInterest(terms.amountFinanced, terms.rate, terms.termMonths) / terms.termMonths);
  return round2(principalLeft * terms.rate / 1200);
}

// ── Dates ────────────────────────────────────────────────────

/** The k-th due date (0 = first), keeping the original day and clamping to month end. */
export function dueDate(firstPaymentDate: string, k: number): string {
  const first = parseLocalDate(firstPaymentDate);
  const target = new Date(first.getFullYear(), first.getMonth() + k, 1);
  const last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(first.getDate(), last));
  return localDateString(target);
}

// ── Planned schedule ─────────────────────────────────────────

export interface ScheduleRow {
  n: number;           // 1-based payment number
  date: string;
  payment: number;
  interest: number;
  principal: number;
  balance: number;     // principal left after this payment
}

/** The payment plan as agreed: every payment on time, nothing extra. */
export function schedule(terms: LoanTerms): ScheduleRow[] {
  const rows: ScheduleRow[] = [];
  let left = terms.amountFinanced;
  for (let k = 0; k < terms.termMonths && left > 0.004; k++) {
    const interest = periodInterest(terms, left);
    const last = k === terms.termMonths - 1;
    // The last payment settles whatever rounding left behind.
    const principal = last ? left : Math.min(left, round2(terms.payment - interest));
    left = round2(left - principal);
    rows.push({ n: k + 1, date: dueDate(terms.firstPaymentDate, k), payment: round2(interest + principal), interest, principal, balance: left });
  }
  return rows;
}

// ── Which transactions are payments ──────────────────────────

export interface LoanPayment {
  tx: Transaction;
  kind: 'payment' | 'down';
  /** Linked by hand, or recognised by the matching rule. */
  how: 'linked' | 'matched';
}

/** Whether a transaction moves money the way this loan's payments do. */
function rightDirection(asset: ManualAsset, t: Transaction): boolean {
  return loanDirection(asset.type) === 'borrowed' ? t.type === 'expense' : t.type === 'income';
}

/** How close an amount must be to the payment to be recognised automatically. */
export function matchTolerance(payment: number): number {
  return Math.max(5, payment * 0.05);
}

/**
 * The loan's payments, oldest first: everything linked by hand, plus every
 * transaction the matching rule recognises — right direction, on or after the
 * start, merchant/notes containing the text, close to the payment amount, and
 * not one you un-linked.
 */
export function loanPayments(asset: ManualAsset, txs: Transaction[]): LoanPayment[] {
  const terms = asset.loan;
  if (!terms) return [];
  const linked = new Set(terms.paymentIds ?? []);
  const ignored = new Set(terms.ignoredIds ?? []);
  const text = terms.match?.text?.trim().toLowerCase();
  const tol = matchTolerance(terms.payment);
  const out: LoanPayment[] = [];
  for (const t of txs) {
    if (!t.id || t.refunded) continue;
    if (t.id === terms.downPaymentId) { out.push({ tx: t, kind: 'down', how: 'linked' }); continue; }
    if (linked.has(t.id)) { out.push({ tx: t, kind: 'payment', how: 'linked' }); continue; }
    if (!text || ignored.has(t.id) || !rightDirection(asset, t) || t.date < terms.startDate) continue;
    if (terms.match?.accountId && t.accountId !== terms.match.accountId) continue;
    const hay = `${t.merchant ?? ''} ${t.notes ?? ''}`.toLowerCase();
    if (!hay.includes(text)) continue;
    if (Math.abs(t.amount - terms.payment) > tol) continue;
    out.push({ tx: t, kind: 'payment', how: 'matched' });
  }
  return out.sort((a, b) => a.tx.date.localeCompare(b.tx.date) || (a.tx.createdAt ?? 0) - (b.tx.createdAt ?? 0));
}

/** Unlinked transactions that look like they could be payments — for one-click linking. */
export function candidatePayments(asset: ManualAsset, txs: Transaction[], limit = 20): Transaction[] {
  const terms = asset.loan;
  if (!terms) return [];
  const taken = new Set(loanPayments(asset, txs).map(p => p.tx.id));
  const tol = Math.max(matchTolerance(terms.payment), terms.payment * 0.25);
  return txs
    .filter(t => t.id && !taken.has(t.id) && !t.refunded && rightDirection(asset, t) && t.date >= terms.startDate)
    .filter(t => Math.abs(t.amount - terms.payment) <= tol)
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

// ── What happened: the running balance ───────────────────────

export interface PaymentSplit {
  tx: Transaction;
  n: number;            // 1-based count among real payments
  interest: number;
  principal: number;
  /** Paid beyond what was owed — nothing left to pay it against. */
  surplus: number;
  principalLeft: number;
}

export interface LoanState {
  /** Principal still to repay. */
  principalLeft: number;
  /** Interest that has built up on due dates and not been paid yet. */
  interestDue: number;
  /** What you'd need to clear it today: principal + interest due. */
  owed: number;
  paymentsMade: number;
  principalPaid: number;
  interestPaid: number;
  totalPaid: number;
  downPayment: number;
  splits: PaymentSplit[];
}

type Event =
  | { date: string; order: 0; kind: 'due' }
  | { date: string; order: 1; kind: 'pay'; tx: Transaction }
  | { date: string; order: 2; kind: 'correct'; value: number };

/**
 * The loan as it stands at the end of `asOf`. Interest is added on each due
 * date; payments clear interest first, then principal. A statement balance
 * you entered replaces the running figure on its date.
 */
export function loanState(asset: ManualAsset, txs: Transaction[], asOf: string, payments = loanPayments(asset, txs)): LoanState {
  const terms = asset.loan!;
  const events: Event[] = [];
  // Due dates keep coming after the term ends only if something is still owed
  // (a late loan keeps charging); cap generously so this can't run away.
  for (let k = 0; k < terms.termMonths * 2; k++) {
    const d = dueDate(terms.firstPaymentDate, k);
    if (d > asOf) break;
    events.push({ date: d, order: 0, kind: 'due' });
  }
  for (const p of payments) if (p.kind === 'payment' && p.tx.date <= asOf) events.push({ date: p.tx.date, order: 1, kind: 'pay', tx: p.tx });
  for (const c of terms.corrections ?? []) if (c.date <= asOf) events.push({ date: c.date, order: 2, kind: 'correct', value: c.value });
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  let principalLeft = terms.amountFinanced;
  let interestDue = 0;
  let dues = 0;
  let principalPaid = 0, interestPaid = 0, totalPaid = 0;
  const splits: PaymentSplit[] = [];

  for (const e of events) {
    if (e.kind === 'due') {
      dues++;
      if (principalLeft > 0 && (dues <= terms.termMonths || terms.method === 'reducing')) {
        interestDue = round2(interestDue + periodInterest(terms, principalLeft));
      }
    } else if (e.kind === 'pay') {
      const amount = e.tx.amount;
      const toInterest = Math.min(amount, interestDue);
      const toPrincipal = Math.min(principalLeft, round2(amount - toInterest));
      const surplus = round2(amount - toInterest - toPrincipal);
      interestDue = round2(interestDue - toInterest);
      principalLeft = round2(principalLeft - toPrincipal);
      interestPaid = round2(interestPaid + toInterest);
      principalPaid = round2(principalPaid + toPrincipal);
      totalPaid = round2(totalPaid + amount);
      splits.push({ tx: e.tx, n: splits.length + 1, interest: round2(toInterest), principal: round2(toPrincipal), surplus, principalLeft });
    } else {
      principalLeft = round2(e.value);
      interestDue = 0;
    }
  }

  const down = payments.find(p => p.kind === 'down' && p.tx.date <= asOf);
  return {
    principalLeft, interestDue, owed: round2(principalLeft + interestDue),
    paymentsMade: splits.length, principalPaid, interestPaid, totalPaid,
    downPayment: down ? down.tx.amount : (terms.downPayment ?? 0),
    splits,
  };
}

/** What the loan is worth to net worth on a date: nothing before it started. */
export function loanOwedOn(asset: ManualAsset, txs: Transaction[], date: string, payments?: LoanPayment[]): number | null {
  if (!asset.loan || date < asset.loan.startDate) return null;
  return loanState(asset, txs, date, payments).owed;
}

// ── What's ahead ─────────────────────────────────────────────

export interface LoanOutlook {
  /** Payments still to make at the regular amount. */
  paymentsLeft: number;
  /** Everything still to pay, interest included. */
  leftToPay: number;
  futureInterest: number;
  payoffDate: string | null;
  /** Interest over the whole life of the loan: paid so far + still to come. */
  lifetimeInterest: number;
  /** Due dates that have passed with no payment to show for them. */
  behindBy: number;
  /** Those due dates, oldest first. */
  missedDates: string[];
  nextDue: string | null;
  /** The payments still to come, if you keep paying the regular amount. */
  upcoming: ScheduleRow[];
}

/**
 * Carry on from today paying the regular amount on each remaining due date
 * until nothing is owed.
 */
export function loanOutlook(asset: ManualAsset, txs: Transaction[], today: string, payments = loanPayments(asset, txs)): LoanOutlook {
  const terms = asset.loan!;
  const now = loanState(asset, txs, today, payments);
  let principalLeft = now.principalLeft;
  let interestDue = now.interestDue;

  let k = 0;
  while (k < terms.termMonths * 2 && dueDate(terms.firstPaymentDate, k) <= today) k++;
  const duesPassed = k;
  // Allow a few days' grace before calling a payment missed.
  const graceCutoff = localDateString(new Date(parseLocalDate(today).getTime() - 5 * 86_400_000));
  let duesOverdue = 0;
  while (duesOverdue < terms.termMonths && dueDate(terms.firstPaymentDate, duesOverdue) <= graceCutoff) duesOverdue++;
  const behindBy = Math.max(0, Math.min(duesOverdue, terms.termMonths) - now.paymentsMade);

  const missedDates: string[] = [];
  for (let i = now.paymentsMade; i < Math.min(duesOverdue, terms.termMonths); i++) missedDates.push(dueDate(terms.firstPaymentDate, i));

  let leftToPay = 0, futureInterest = 0, paymentsLeft = 0;
  let payoffDate: string | null = null;
  const upcoming: ScheduleRow[] = [];
  let due = duesPassed;
  // Pay off anything already overdue on the next due date too.
  while ((principalLeft > 0.004 || interestDue > 0.004) && due < terms.termMonths * 3) {
    if (principalLeft > 0 && (due < terms.termMonths || terms.method === 'reducing')) {
      const i = periodInterest(terms, principalLeft);
      interestDue = round2(interestDue + i);
      futureInterest = round2(futureInterest + i);
    }
    const owedNow = round2(principalLeft + interestDue);
    // The final scheduled payment settles whatever rounding left behind, as lenders do.
    const pay = due < terms.termMonths - 1 ? Math.min(owedNow, terms.payment) : owedNow;
    const toInterest = Math.min(pay, interestDue);
    const toPrincipal = Math.min(principalLeft, round2(pay - toInterest));
    interestDue = round2(interestDue - toInterest);
    principalLeft = round2(principalLeft - toPrincipal);
    leftToPay = round2(leftToPay + pay);
    paymentsLeft++;
    payoffDate = dueDate(terms.firstPaymentDate, due);
    upcoming.push({
      n: now.paymentsMade + paymentsLeft, date: payoffDate, payment: round2(pay),
      interest: round2(toInterest), principal: round2(toPrincipal), balance: principalLeft,
    });
    due++;
  }

  return {
    paymentsLeft, leftToPay, futureInterest,
    payoffDate: now.owed > 0.004 ? payoffDate : null,
    lifetimeInterest: round2(now.interestPaid + futureInterest),
    behindBy,
    missedDates,
    upcoming,
    nextDue: duesPassed < terms.termMonths && now.owed > 0.004 ? dueDate(terms.firstPaymentDate, duesPassed) : null,
  };
}

// ── Things that lose value ───────────────────────────────────

/** A typical yearly loss of value for new entries of each type. */
export function defaultDepreciation(type: ManualAssetType): number {
  return type === 'vehicle' ? 0.15 : 0;
}

/**
 * Estimated value on a date: starting from the purchase price — or from the
 * latest real value you entered, which takes over — and losing
 * `depreciationRate` a year from there. Null before it was bought.
 */
export function estimatedValue(asset: ManualAsset, date: string): number | null {
  const p = asset.purchase;
  const rate = asset.depreciationRate ?? 0;
  if (!p || rate <= 0) return null;
  if (date < p.date) return null;
  let anchor = { date: p.date, value: p.price };
  for (const v of [...(asset.valuations ?? [])].sort((a, b) => a.date.localeCompare(b.date))) {
    if (v.date <= date && v.date >= anchor.date) anchor = v;
  }
  const years = (parseLocalDate(date).getTime() - parseLocalDate(anchor.date).getTime()) / (365.25 * 86_400_000);
  return round2(anchor.value * Math.pow(1 - rate, years));
}
