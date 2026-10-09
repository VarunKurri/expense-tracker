import { LoanMethod, LoanTerms, LumpSum, ManualAsset, ManualAssetType, Transaction } from '../models';
import { localDateString, parseLocalDate } from './date';
import { isFullyRefunded } from './money-back';
import { fromCents, toCents } from './money';

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
 * payment goes straight to principal — whichever method the loan uses. A
 * payment that arrives before its due date finds no interest owing yet, so all
 * of it is principal (and that month's interest is then charged on less).
 *
 * Two choices change that:
 *  - **Penalty waiver** (`onSchedule`): every payment counts as made on its due
 *    date, so payment N splits exactly like row N of the EMI table — early or
 *    late makes no difference, and nothing builds up between payments.
 *  - **Lump sums**: a payment you mark pays down principal early, then either
 *    lowers the monthly payment (same end date) or keeps it (ends sooner).
 *
 * Pure functions: the Net worth page, the loan page and the tests share them.
 *
 * **Money is integer cents inside.** Every running balance (principal left,
 * interest due, totals paid) is whole cents, and a formula's result — the EMI,
 * a month's interest — is rounded to a cent exactly once, where it becomes
 * money. The exported functions still take and return dollars, so callers
 * don't change; but 360 months of payments add up to the cent instead of
 * collecting float dust from re-rounding dollars at every step.
 */

/** A computed amount of cents (a formula's result), rounded to a whole cent. */
const roundCents = (c: number) => Math.round(c) + 0;

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
  return fromCents(paymentCents(toCents(principal), ratePct, months, method));
}

/** Total interest on a flat-rate loan: P × rate × years. */
export function flatInterest(principal: number, ratePct: number, months: number): number {
  return fromCents(flatInterestCents(toCents(principal), ratePct, months));
}

/** The regular payment, in cents. */
function paymentCents(principal: number, ratePct: number, months: number, method: LoanMethod): number {
  if (principal <= 0 || months <= 0) return 0;
  if (method === 'none' || ratePct <= 0) return roundCents(principal / months);
  if (method === 'flat') return roundCents((principal + flatInterestCents(principal, ratePct, months)) / months);
  const r = ratePct / 1200;
  const f = Math.pow(1 + r, months);
  return roundCents(principal * r * f / (f - 1));
}

function flatInterestCents(principal: number, ratePct: number, months: number): number {
  return roundCents(principal * (ratePct / 100) * (months / 12));
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

/** Interest that builds up on one due date, in cents, on `principalLeft` cents. */
function periodInterest(terms: LoanTerms, principalLeft: number): number {
  if (terms.method === 'none' || terms.rate <= 0) return 0;
  if (terms.method === 'flat') return roundCents(flatInterestCents(toCents(terms.amountFinanced), terms.rate, terms.termMonths) / terms.termMonths);
  return roundCents(principalLeft * terms.rate / 1200);
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

// ── When payments arrive ─────────────────────────────────────

export type DueMode = 'exact' | 'flexible' | 'none';

export function dueModeOf(terms: LoanTerms): DueMode {
  return terms.dueMode ?? 'exact';
}

/**
 * How many days after a due date a payment can still arrive before it counts
 * as missed. Bank autopay lands on the day, so a few days covers weekends;
 * a friend paying "around the 25th" might pay on the 2nd. With no set day,
 * nothing is ever missed.
 */
export function graceDays(terms: LoanTerms): number {
  switch (dueModeOf(terms)) {
    case 'flexible': return Math.max(0, terms.lateDays ?? 10);
    case 'none': return Infinity;
    default: return 5;
  }
}

/** The last day a payment for `due` still counts as on time. */
export function windowEnd(due: string, terms: LoanTerms): string | null {
  const g = graceDays(terms);
  if (!isFinite(g)) return null;
  const d = parseLocalDate(due);
  d.setDate(d.getDate() + g);
  return localDateString(d);
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
  const payment = toCents(terms.payment);
  let left = toCents(terms.amountFinanced);
  for (let k = 0; k < terms.termMonths && left > 0; k++) {
    const interest = periodInterest(terms, left);
    const last = k === terms.termMonths - 1;
    // The last payment settles whatever rounding left behind.
    const principal = last ? left : Math.min(left, payment - interest);
    left -= principal;
    rows.push({
      n: k + 1, date: dueDate(terms.firstPaymentDate, k),
      payment: fromCents(interest + principal), interest: fromCents(interest), principal: fromCents(principal), balance: fromCents(left),
    });
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

/**
 * What's left after the last scheduled payment that is just rounding — the
 * EMI is rounded to the cent, which over 30 years can leave a few dollars. It
 * rides along with the last payment, as lenders do. A real backlog (a missed
 * month) is far bigger and carries on at the regular amount instead.
 */
function roundingLeftover(payment: number): number {
  return Math.max(100, payment * 0.05); // cents: at least $1, or 5% of the payment
}

/** How close an amount must be to the payment to be recognised automatically. */
export function matchTolerance(payment: number): number {
  return Math.max(5, payment * 0.05);
}

/** The regular payment from a date on. A lump sum that lowered it starts a new one. */
interface RegularPayment { from: string; payment: number }

/**
 * The loan's payments, oldest first: everything linked by hand, plus every
 * transaction the matching rule recognises — right direction, on or after the
 * start, merchant/notes containing the text, close to the regular payment, and
 * not one you un-linked.
 */
export function loanPayments(asset: ManualAsset, txs: Transaction[]): LoanPayment[] {
  const terms = asset.loan;
  if (!terms) return [];
  let regular: RegularPayment[] = [{ from: '', payment: terms.payment }];
  let out = matchPayments(asset, txs, regular);
  // After a lump sum lowers the monthly payment, later payments are the new
  // amount — recognise those too. Each pass can only find more; it settles fast.
  if ((terms.lumpSums ?? []).some(l => l.mode === 'reduce-emi')) {
    for (let pass = 0; pass < 3; pass++) {
      const next = regularPayments(loanState(asset, txs, '9999-12-31', out), terms.payment);
      if (next.map(r => `${r.from}:${r.payment}`).join() === regular.map(r => `${r.from}:${r.payment}`).join()) break;
      regular = next;
      out = matchPayments(asset, txs, regular);
    }
  }
  return out;
}

function matchPayments(asset: ManualAsset, txs: Transaction[], regular: RegularPayment[]): LoanPayment[] {
  const terms = asset.loan!;
  const linked = new Set(terms.paymentIds ?? []);
  const ignored = new Set(terms.ignoredIds ?? []);
  const text = terms.match?.text?.trim().toLowerCase();
  const out: LoanPayment[] = [];
  for (const t of txs) {
    // A refunded payment isn't a payment. (Pure check: a refund *income* linked
    // from the bank isn't visible here — rare enough for a loan payment.)
    if (!t.id || isFullyRefunded(t)) continue;
    if (t.id === terms.downPaymentId) { out.push({ tx: t, kind: 'down', how: 'linked' }); continue; }
    if (linked.has(t.id)) { out.push({ tx: t, kind: 'payment', how: 'linked' }); continue; }
    if (!text || ignored.has(t.id) || !rightDirection(asset, t) || t.date < terms.startDate) continue;
    if (terms.match?.accountId && t.accountId !== terms.match.accountId) continue;
    const hay = `${t.merchant ?? ''} ${t.notes ?? ''}`.toLowerCase();
    if (!hay.includes(text)) continue;
    if (!closeToRegular(t, regular)) continue;
    out.push({ tx: t, kind: 'payment', how: 'matched' });
  }
  return out.sort((a, b) => a.tx.date.localeCompare(b.tx.date) || (a.tx.createdAt ?? 0) - (b.tx.createdAt ?? 0));
}

/** Close to the payment in force on its date — or to the original, if the payer never changed. */
function closeToRegular(t: Transaction, regular: RegularPayment[], widen = 1): boolean {
  const inForce = [...regular].reverse().find(r => r.from <= t.date) ?? regular[0];
  return [inForce.payment, regular[0].payment].some(p => Math.abs(t.amount - p) <= matchTolerance(p) * widen);
}

/** The regular payment over time: the original, then each one a lump sum set. */
function regularPayments(state: LoanState, original: number): RegularPayment[] {
  const out: RegularPayment[] = [{ from: '', payment: original }];
  for (const sp of state.splits) {
    if (sp.lump && sp.lump.payment !== out[out.length - 1].payment) out.push({ from: sp.tx.date, payment: sp.lump.payment });
  }
  return out;
}

/** Unlinked transactions that look like they could be payments — for one-click linking. */
export function candidatePayments(asset: ManualAsset, txs: Transaction[], limit = 20): Transaction[] {
  const terms = asset.loan;
  if (!terms) return [];
  const pays = loanPayments(asset, txs);
  const taken = new Set(pays.map(p => p.tx.id));
  const regular = regularPayments(loanState(asset, txs, '9999-12-31', pays), terms.payment);
  // Wider than automatic matching: a payer who rounds, or pays a little extra.
  const widen = (p: number) => Math.max(1, (p * 0.25) / matchTolerance(p));
  return txs
    .filter(t => t.id && !taken.has(t.id) && !isFullyRefunded(t) && rightDirection(asset, t) && t.date >= terms.startDate)
    .filter(t => closeToRegular(t, regular, widen(terms.payment)))
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit);
}

// ── What happened: the running balance ───────────────────────

export interface PaymentSplit {
  tx: Transaction;
  /** 1-based count among monthly payments. A lump sum on top shares the count of the one before. */
  n: number;
  /** Counts as one of the monthly payments (false for a lump sum paid on top). */
  installment: boolean;
  interest: number;
  principal: number;
  /** Paid beyond what was owed — nothing left to pay it against. */
  surplus: number;
  principalLeft: number;
  /** Marked as a lump sum: what the regular payment and the term became after it. */
  lump?: LumpSum & { payment: number; termMonths: number };
}

export interface LoanState {
  /** Principal still to repay. */
  principalLeft: number;
  /** Interest that has built up on due dates and not been paid yet. */
  interestDue: number;
  /** What you'd need to clear it today: principal + interest due. */
  owed: number;
  /** Payments counted so far — real ones, plus any assumed made on schedule. */
  paymentsMade: number;
  /** How many of those were assumed (paid on schedule before tracking began). */
  assumedPayments: number;
  /**
   * Due dates accounted for: payments made, or settled by "paid on schedule"
   * or a statement balance. What "4 of 60 payments" and missed months count against.
   */
  covered: number;
  /** Due dates reached so far. In the standard model their interest is already charged. */
  duesPassed: number;
  /** The regular payment now — the original, or what a lump sum lowered it to. */
  payment: number;
  /** How many monthly payments the loan runs for now — fewer after a lump sum that shortened it. */
  termMonths: number;
  principalPaid: number;
  interestPaid: number;
  totalPaid: number;
  downPayment: number;
  splits: PaymentSplit[];
}

type Event =
  | { date: string; order: 0; kind: 'due'; index: number }
  | { date: string; order: 1; kind: 'pay'; tx: Transaction }
  | { date: string; order: 2; kind: 'correct'; value: number };

/**
 * The loan as it stands at the end of `asOf`. Interest is added on each due
 * date; payments clear interest first, then principal. A statement balance
 * you entered replaces the running figure on its date.
 *
 * With the penalty waiver on, interest isn't added by date at all: each
 * monthly payment is charged its own installment's interest as it is applied,
 * just as if it had arrived on its due date.
 */
export function loanState(asset: ManualAsset, txs: Transaction[], asOf: string, payments = loanPayments(asset, txs)): LoanState {
  const terms = asset.loan!;
  const down = payments.find(p => p.kind === 'down' && p.tx.date <= asOf);
  const downPayment = down ? down.tx.amount : (terms.downPayment ?? 0);
  const waived = !!terms.onSchedule;
  const lumps = new Map((terms.lumpSums ?? []).map(l => [l.txId, l]));

  // Before tracking began, the loan followed its schedule: start from where the
  // schedule says it was, counting those payments as made. All in cents.
  const settled = terms.settledThrough;
  const startAt = settled ? (settled < asOf ? settled : asOf) : null;
  let principalLeft = toCents(terms.amountFinanced);
  let interestDue = 0;
  let principalPaid = 0, interestPaid = 0, totalPaid = 0;
  let assumed = 0;
  if (startAt) {
    for (const r of schedule(terms)) {
      if (r.date > startAt) break;
      assumed++;
      principalLeft = toCents(r.balance);
      principalPaid += toCents(r.principal);
      interestPaid += toCents(r.interest);
      totalPaid += toCents(r.payment);
    }
  }
  const after = (d: string) => !startAt || d > startAt;

  const events: Event[] = [];
  // Due dates keep coming after the term ends only if something is still owed
  // (a late loan keeps charging); cap generously so this can't run away.
  for (let k = 0; k < terms.termMonths * 2; k++) {
    const d = dueDate(terms.firstPaymentDate, k);
    if (d > asOf) break;
    if (after(d)) events.push({ date: d, order: 0, kind: 'due', index: k });
  }
  for (const p of payments) {
    if (p.kind === 'payment' && p.tx.date <= asOf && after(p.tx.date)) events.push({ date: p.tx.date, order: 1, kind: 'pay', tx: p.tx });
  }
  for (const c of terms.corrections ?? []) {
    if (c.date <= asOf && after(c.date)) events.push({ date: c.date, order: 2, kind: 'correct', value: c.value });
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);

  const splits: PaymentSplit[] = [];
  // The latest point where the balance was known for sure — after it, only
  // real payments count towards covering due dates.
  let settlePoint = startAt && assumed > 0 ? startAt : null;
  let paymentsSinceSettle = 0;
  let duesPassed = assumed;
  let installments = assumed;       // monthly payments counted so far
  let payment = toCents(terms.payment); // the regular payment, until a lump sum changes it
  let term = terms.termMonths;      // how long the loan runs, until a lump sum shortens it

  /** Installment k's interest, on what is owed now. Flat and no-interest loans stop charging at the end of the term. */
  const accrue = (k: number) => {
    if (principalLeft > 0 && (k < term || terms.method === 'reducing')) {
      interestDue += periodInterest(terms, principalLeft);
    }
  };
  const duesUpTo = (date: string) => {
    let n = 0;
    while (n < terms.termMonths && dueDate(terms.firstPaymentDate, n) <= date) n++;
    return n;
  };

  for (const e of events) {
    if (e.kind === 'due') {
      duesPassed = e.index + 1;
      if (!waived) accrue(e.index);
    } else if (e.kind === 'pay') {
      const lump = lumps.get(e.tx.id!);
      const installment = !lump?.onTop;
      // Waived: as if it arrived on its due date — its own installment's interest, no more, no less.
      if (waived && installment) accrue(installments);
      const amount = toCents(e.tx.amount);
      const toInterest = Math.min(amount, interestDue);
      const toPrincipal = Math.min(principalLeft, amount - toInterest);
      const surplus = amount - toInterest - toPrincipal;
      interestDue -= toInterest;
      principalLeft -= toPrincipal;
      interestPaid += toInterest;
      principalPaid += toPrincipal;
      totalPaid += amount;
      if (installment) { installments++; paymentsSinceSettle++; }
      if (lump && principalLeft > 0) {
        if (lump.mode === 'reduce-emi') payment = reamortise(terms, principalLeft, Math.max(1, term - installments));
        else term = installments + monthsToClear(terms, principalLeft, payment);
      }
      splits.push({
        tx: e.tx, n: installments, installment,
        interest: fromCents(toInterest), principal: fromCents(toPrincipal), surplus: fromCents(surplus), principalLeft: fromCents(principalLeft),
        ...(lump ? { lump: { ...lump, payment: fromCents(payment), termMonths: term } } : {}),
      });
    } else {
      // A statement balance: the figure is known, and everything due before it is settled.
      principalLeft = toCents(e.value);
      interestDue = 0;
      settlePoint = e.date;
      paymentsSinceSettle = 0;
      installments = Math.max(installments, duesUpTo(e.date));
    }
  }

  const paymentsMade = assumed + splits.filter(s => s.installment).length;
  let covered = paymentsMade;
  if (settlePoint) covered = Math.max(paymentsMade, duesUpTo(settlePoint) + paymentsSinceSettle);

  // Back to dollars only here, on the way out.
  return {
    principalLeft: fromCents(principalLeft), interestDue: fromCents(interestDue), owed: fromCents(principalLeft + interestDue),
    paymentsMade, assumedPayments: assumed, covered, duesPassed, payment: fromCents(payment), termMonths: term,
    principalPaid: fromCents(principalPaid), interestPaid: fromCents(interestPaid), totalPaid: fromCents(totalPaid), downPayment, splits,
  };
}

/** The regular payment that clears `principal` cents in `months`, the loan's way (cents). */
function reamortise(terms: LoanTerms, principal: number, months: number): number {
  // Flat: the same interest each month as before, on top of an even share of what's left.
  if (terms.method === 'flat' && terms.rate > 0) return roundCents(principal / months) + periodInterest(terms, principal);
  return paymentCents(principal, terms.rate, months, terms.method);
}

/** How many regular payments (cents) it takes to clear `principal` cents. */
function monthsToClear(terms: LoanTerms, principal: number, payment: number): number {
  let left = principal, n = 0;
  while (left > 0 && n < 1200) {
    const step = payment - periodInterest(terms, left);
    if (step <= 0) return 1200; // the payment doesn't even cover the interest
    // Rounding rides along with the last payment.
    left = left - step < roundingLeftover(payment) ? 0 : left - step;
    n++;
  }
  return n;
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
  /** The earliest due date no payment has covered yet (and that isn't missed). */
  nextDue: string | null;
  /** The last day that payment still counts as on time; null with no set day. */
  nextDueBy: string | null;
  /** That due date has passed but its window hasn't — the payment is on its way. */
  nextIsLate: boolean;
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
  // In cents from here on, like loanState inside.
  let principalLeft = toCents(now.principalLeft);
  let interestDue = toCents(now.interestDue);
  const regular = toCents(now.payment);

  // Due dates whose window has closed: a payment for them is now missed. Counted
  // against payments made, so a payment on the 2nd covers the 25th before it,
  // and two payments in one month cover two due dates.
  let duesClosed = 0;
  while (duesClosed < terms.termMonths) {
    const end = windowEnd(dueDate(terms.firstPaymentDate, duesClosed), terms);
    if (end === null || end >= today) break;
    duesClosed++;
  }
  const behindBy = Math.max(0, duesClosed - now.covered);
  const missedDates: string[] = [];
  for (let i = now.covered; i < duesClosed; i++) missedDates.push(dueDate(terms.firstPaymentDate, i));

  // The next payment expected: the first due date not covered by a payment and not missed.
  const nextIndex = Math.max(now.covered, duesClosed);
  const owing = toCents(now.owed) > 0;
  const nextDue = owing && nextIndex < terms.termMonths ? dueDate(terms.firstPaymentDate, nextIndex) : null;

  let leftToPay = 0, futureInterest = 0, paymentsLeft = 0;
  let payoffDate: string | null = null;
  const upcoming: ScheduleRow[] = [];
  const waived = !!terms.onSchedule;
  const accrues = (k: number) => principalLeft > 0 && (k < now.termMonths || terms.method === 'reducing');
  const charge = () => {
    const i = periodInterest(terms, principalLeft);
    interestDue += i;
    futureInterest += i;
  };

  // Paid ahead: due dates already covered still charge their interest when they
  // come. (Waived: each payment already carried its own installment's interest.)
  if (!waived) {
    for (let i = now.duesPassed; i < nextIndex; i++) if (accrues(i)) charge();
  }

  // From the next payment expected — which may be one whose due date has passed
  // but is still within its window — paying the regular amount each time.
  // Anything missed is folded into what's owed and paid off along the way.
  let due = nextIndex;
  while ((principalLeft > 0 || interestDue > 0) && due < terms.termMonths * 3) {
    // Standard: interest comes with each due date not reached yet. Waived: with each payment, by installment.
    const k = waived ? now.covered + paymentsLeft : due;
    if ((waived || due >= now.duesPassed) && accrues(k)) charge();
    const owedNow = principalLeft + interestDue;
    // Regular payments until it's cleared. On the last scheduled one, rounding
    // is settled with it, as lenders do; anything more (payments missed along
    // the way) carries on at the regular amount, so the loan honestly runs
    // longer instead of ending in one huge payment.
    const settlesRounding = k >= now.termMonths - 1 && owedNow - regular < roundingLeftover(regular);
    const pay = settlesRounding ? owedNow : Math.min(owedNow, regular);
    const toInterest = Math.min(pay, interestDue);
    const toPrincipal = Math.min(principalLeft, pay - toInterest);
    interestDue -= toInterest;
    principalLeft -= toPrincipal;
    leftToPay += pay;
    paymentsLeft++;
    payoffDate = dueDate(terms.firstPaymentDate, due);
    upcoming.push({
      n: now.covered + paymentsLeft, date: payoffDate, payment: fromCents(pay),
      interest: fromCents(toInterest), principal: fromCents(toPrincipal), balance: fromCents(principalLeft),
    });
    due++;
  }

  return {
    paymentsLeft, leftToPay: fromCents(leftToPay),
    payoffDate: owing ? payoffDate : null,
    // Interest already built up but not yet paid is part of the cost too.
    futureInterest: fromCents(toCents(now.interestDue) + futureInterest),
    lifetimeInterest: fromCents(toCents(now.interestPaid) + toCents(now.interestDue) + futureInterest),
    behindBy,
    missedDates,
    upcoming,
    nextDue,
    nextDueBy: nextDue ? windowEnd(nextDue, terms) : null,
    nextIsLate: !!nextDue && nextDue < today,
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
  return fromCents(roundCents(toCents(anchor.value) * Math.pow(1 - rate, years)));
}
