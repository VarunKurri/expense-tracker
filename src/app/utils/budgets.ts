import { Budget, Transaction } from '../models';
import { MoneyRules, refundedOut, totalExpenses } from './reporting';
import { addMonths, monthLabel } from './calendar';
import { fromCents, toCents } from './money';

/**
 * Budget rules, kept pure so they can be tested without Firestore.
 *
 * A category can have two kinds of budget:
 *  - one **every-month** budget (`isDefault: true`), and
 *  - any number of **one-month** budgets (`isDefault: false`, `month` set),
 *    each replacing the every-month amount for that month only.
 *
 * The form used to edit whichever budget document happened to be showing. When
 * you pressed Override on a month with no one-off yet, the one showing was the
 * every-month budget, so saving "Specific month" turned that budget *into* a
 * one-month budget — and every other month lost its limit. The form now
 * describes *what* to save (category + scope + month) and `planBudgetSave`
 * picks the document, so editing one scope can never rewrite the other.
 */

/** Which budget a form is talking about. */
export type BudgetScope = 'default' | 'month';

export interface BudgetDraft {
  categoryId: string;
  amount: number;
  scope: BudgetScope;
  /** YYYY-MM. Required for 'month'; for 'default' it is the month being viewed. */
  month: string;
}

/** The category's every-month budget. Oldest wins if duplicates ever slipped in. */
export function defaultFor(budgets: Budget[], categoryId: string): Budget | undefined {
  return budgets.find(b => b.categoryId === categoryId && b.isDefault);
}

/** The category's one-off budget for a month, if it has one. */
export function overrideFor(budgets: Budget[], categoryId: string, month: string): Budget | undefined {
  return budgets.find(b => b.categoryId === categoryId && !b.isDefault && b.month === month);
}

/** The budget document a scope refers to, if it exists yet. */
export function findBudget(budgets: Budget[], categoryId: string, scope: BudgetScope, month: string) {
  return scope === 'default' ? defaultFor(budgets, categoryId) : overrideFor(budgets, categoryId, month);
}

export interface EffectiveBudget {
  categoryId: string;
  /** The budget that applies this month: the one-off if there is one, else the every-month. */
  budget: Budget;
  isOverride: boolean;
  /** The every-month amount, when a one-off is replacing it. */
  defaultAmount: number | null;
}

/**
 * One budget per category for a month. Includes categories that only have a
 * one-off budget for this month — the old list started from every-month budgets
 * only, so a category without one vanished from every screen.
 */
export function effectiveBudgets(budgets: Budget[], month: string): EffectiveBudget[] {
  const out: EffectiveBudget[] = [];
  const seen = new Set<string>();
  for (const b of budgets) {
    const id = b.categoryId;
    if (seen.has(id)) continue;
    const override = overrideFor(budgets, id, month);
    const def = defaultFor(budgets, id);
    const budget = override ?? def;
    if (!budget) continue; // only has one-offs in other months
    seen.add(id);
    out.push({
      categoryId: id,
      budget,
      isOverride: !!override,
      defaultAmount: override && def ? def.amount : null,
    });
  }
  return out;
}

/**
 * Categories with one-off budgets but no every-month budget, and no budget in
 * `month` — they are invisible while you look at `month`, so the page lists
 * where to find them.
 */
export function budgetsElsewhere(budgets: Budget[], month: string): { categoryId: string; months: string[] }[] {
  const byCat = new Map<string, string[]>();
  for (const b of budgets) {
    if (b.isDefault || !b.month) continue;
    if (defaultFor(budgets, b.categoryId) || overrideFor(budgets, b.categoryId, month)) continue;
    byCat.set(b.categoryId, [...(byCat.get(b.categoryId) ?? []), b.month]);
  }
  return [...byCat.entries()].map(([categoryId, months]) => ({ categoryId, months: months.sort() }));
}

/** The amount a form should start with for a scope. */
export function prefillAmount(budgets: Budget[], categoryId: string, scope: BudgetScope, month: string): number {
  if (!categoryId) return 0;
  const target = findBudget(budgets, categoryId, scope, month);
  if (target) return target.amount;
  // A new one-off starts from the every-month amount; a new every-month budget
  // starts from this month's one-off, since that is what you are looking at.
  const other = scope === 'month' ? defaultFor(budgets, categoryId) : overrideFor(budgets, categoryId, month);
  return other?.amount ?? 0;
}

export type BudgetWrite =
  | { kind: 'add'; data: Omit<Budget, 'id' | 'createdAt'> }
  | { kind: 'update'; id: string; patch: Partial<Budget> };

export interface BudgetSavePlan {
  write: BudgetWrite;
  /** Extra copies of the same budget (left by older versions), removed on save. */
  deletes: string[];
}

/**
 * What saving a draft writes. Only ever touches documents of the draft's own
 * scope, with one deliberate exception: saving "every month" for a category
 * that has no every-month budget, from a month that has a one-off, promotes
 * that one-off instead of adding a second budget beside it. That is also how a
 * budget the old bug turned into a one-off gets put back.
 */
export function planBudgetSave(budgets: Budget[], draft: BudgetDraft): BudgetSavePlan {
  const amount = fromCents(toCents(Number(draft.amount)));
  const sameScope = budgets.filter(b =>
    b.categoryId === draft.categoryId && b.id &&
    (draft.scope === 'default' ? b.isDefault : !b.isDefault && b.month === draft.month));
  const [target, ...dupes] = sameScope;
  const deletes = dupes.map(b => b.id!);

  if (target) return { write: { kind: 'update', id: target.id!, patch: { amount } }, deletes };

  if (draft.scope === 'month') {
    return {
      write: { kind: 'add', data: { categoryId: draft.categoryId, amount, isDefault: false, month: draft.month } },
      deletes,
    };
  }

  const promote = overrideFor(budgets, draft.categoryId, draft.month);
  if (promote?.id) {
    // `month: undefined` is dropped when the document is serialised.
    return { write: { kind: 'update', id: promote.id, patch: { amount, isDefault: true, month: undefined } }, deletes };
  }
  return { write: { kind: 'add', data: { categoryId: draft.categoryId, amount, isDefault: true } }, deletes };
}

/** Plain-English consequence of deleting a budget, for the confirm dialog. */
export function describeBudgetDeletion(budgets: Budget[], target: Budget, categoryName: string): string {
  if (!target.isDefault) {
    const def = defaultFor(budgets, target.categoryId);
    const when = target.month ? monthLabel(target.month) : 'That month';
    return def
      ? `${when} goes back to the every-month limit of ${money(def.amount)}. Other months are not affected.`
      : `${categoryName} will have no limit in ${when}. Other months are not affected.`;
  }
  const oneOffs = budgets.filter(b => b.categoryId === target.categoryId && !b.isDefault).length;
  return oneOffs > 0
    ? `${categoryName} will have no every-month limit. Its ${oneOffs} one-month limit${oneOffs === 1 ? '' : 's'} stay${oneOffs === 1 ? 's' : ''}.`
    : `${categoryName} will have no limit in any month. Your transactions are not affected.`;
}

/**
 * Whether moving a budget to another category would give that category two
 * budgets for the same period (used when re-pointing an orphaned budget).
 */
export function wouldClash(budgets: Budget[], moving: Budget, toCategoryId: string): boolean {
  return budgets.some(o =>
    o.id !== moving.id && o.categoryId === toCategoryId &&
    o.isDefault === moving.isDefault && (o.isDefault || o.month === moving.month));
}

export type BudgetStatus = 'ok' | 'warn' | 'over';

/** Shared thresholds, so a budget reads the same on every page. */
export function budgetProgress(spent: number, amount: number) {
  const pct = amount > 0 ? Math.round((spent / amount) * 100) : 0;
  const status: BudgetStatus = pct >= 100 ? 'over' : pct >= 75 ? 'warn' : 'ok';
  return { pct, status, remaining: fromCents(toCents(amount) - toCents(spent)) };
}

/**
 * What a category has spent against its budget in a month. Same rules as
 * Spending and Analysis: internal transfers never count, and with the refund
 * toggle on, refunded purchases are dropped and reimbursements are netted off.
 * The Budgets page used to add up raw amounts, so a dinner your friends paid
 * you back for counted in full there but not anywhere else.
 */
export function budgetSpent(
  txs: Transaction[], categoryId: string, month: string, rules: MoneyRules,
): number {
  return totalExpenses(
    txs.filter(t =>
      t.categoryId === categoryId && t.date.startsWith(month) && !refundedOut(t, rules)),
    rules,
  );
}

/** Month options from `before` months before `from` to `after` months after, plus any extras. */
export function monthOptions(from: string, before: number, after: number, extra: string[] = []) {
  const values = new Set<string>(extra.filter(Boolean));
  for (let i = -before; i <= after; i++) values.add(addMonths(from, i));
  return [...values].sort().map(value => ({ value, label: monthLabel(value) }));
}

function money(n: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
}
