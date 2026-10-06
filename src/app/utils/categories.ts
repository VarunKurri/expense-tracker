import {
  Bill, Budget, Category, CategoryKind, Transaction, TransactionRule, TransactionTemplate,
} from '../models';
import { PLAID_TARGET_NAMES } from './plaid-category-map';

/**
 * Category management: naming, how bank transactions find their category, and
 * what deleting one does to everything that points at it.
 *
 * Pure and separate from the page for the same reason as `rules.ts` and
 * `reporting.ts`: a mistake here silently re-files or loses real transactions,
 * and you cannot spot that by looking at the screen.
 *
 * The one fact everything below is built around: **Plaid transactions are
 * matched to a category by name, at read time, and nothing is stored.** Plaid
 * says FOOD_AND_DRINK, the app looks for a category called "Dining". So a
 * category's name is not just a label — renaming or deleting "Dining" would
 * quietly uncategorise every bank transaction that used to land there.
 *
 * That is handled with aliases rather than by writing categories onto bank
 * transactions: the Plaid sync overwrites a transaction completely whenever the
 * bank modifies it, so anything written onto one is not guaranteed to last. An
 * alias lives on the category, which the sync never touches.
 */

export const MAX_NAME_LENGTH = 40;

// ── Naming ───────────────────────────────────────────────────

/**
 * Why a name can't be used, or null if it can.
 *
 * Names must be unique within a kind (ignoring case). That is not just
 * tidiness: bank transactions are matched by name, and two "Dining"s would make
 * which one they land in depend on load order.
 */
export function validateCategoryName(
  name: string,
  kind: CategoryKind,
  categories: Category[],
  editingId?: string,
): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the category a name.';
  if (trimmed.length > MAX_NAME_LENGTH) return `Keep it under ${MAX_NAME_LENGTH} characters.`;
  const clash = categories.find(c =>
    c.id !== editingId &&
    c.kind === kind &&
    c.name.trim().toLowerCase() === trimmed.toLowerCase());
  if (clash) {
    return clash.archived
      ? `An archived category is already called "${clash.name}". Restore it instead.`
      : `You already have a category called "${clash.name}".`;
  }
  return null;
}

// ── Bank-transaction matching ────────────────────────────────

/**
 * The category a Plaid transaction lands in, given the name Plaid's mapping
 * produced (e.g. "Dining").
 *
 * A category that has taken the name over as an alias wins over one that is
 * merely called it. That is what makes a rename safe: rename "Dining" to
 * "Eating out" and it keeps "Dining" as an alias, so bank transactions keep
 * arriving — even if you later create a new category called "Dining".
 *
 * Archived categories still match. Their history has to keep showing where it
 * was filed, and resolution happens at read time, so excluding them would
 * uncategorise past transactions, not just future ones.
 */
export function resolvePlaidCategory(
  categories: Category[], targetName: string, kind: CategoryKind,
): Category | undefined {
  const sameKind = categories.filter(c => c.kind === kind);
  return sameKind.find(c => c.plaidAliases?.includes(targetName))
      ?? sameKind.find(c => c.name === targetName);
}

/** The Plaid names a category currently receives bank transactions under. */
export function plaidNamesFor(category: Category): string[] {
  const names = new Set(category.plaidAliases ?? []);
  if (PLAID_TARGET_NAMES[category.kind].has(category.name)) names.add(category.name);
  return [...names];
}

/**
 * Aliases a category should carry after being renamed to `newName`.
 *
 * If the old name was one Plaid matches on, it becomes an alias, so the bank
 * transactions filed under it keep arriving. Aliases are only ever added on
 * rename, never removed, so renaming twice keeps both.
 */
export function aliasesAfterRename(category: Category, newName: string): string[] | undefined {
  const aliases = new Set(category.plaidAliases ?? []);
  const oldName = category.name;
  if (newName.trim() !== oldName && PLAID_TARGET_NAMES[category.kind].has(oldName)) {
    aliases.add(oldName);
  }
  return aliases.size ? [...aliases] : undefined;
}

// ── Deletion ─────────────────────────────────────────────────

export interface DeletionInput {
  category: Category;
  /** Where its transactions go; null leaves them uncategorised. */
  targetId: string | null;
  categories: Category[];
  /**
   * Transactions with this category *stored* on them. Must not include bank
   * transactions that only match it by name — those follow via aliases.
   */
  storedTransactions: Transaction[];
  /** Bank transactions that currently match it by name only (none stored). */
  matchedBankTransactions: number;
  budgets: Budget[];
  rules: TransactionRule[];
  bills: Bill[];
  templates: TransactionTemplate[];
}

export interface DeletionPlan {
  transactions: { id: string; patch: Partial<Transaction> }[];
  /** Budgets moved onto the target category. */
  budgetMoves: { id: string; patch: Partial<Budget> }[];
  /** Budgets removed — either no target, or the target already has one. */
  budgetDeletes: string[];
  rulePatches: { id: string; patch: Partial<TransactionRule> }[];
  /** Rules switched off because a condition would otherwise silently widen. */
  rulesDisabled: number;
  billPatches: { id: string; patch: Partial<Bill> }[];
  templatePatches: { id: string; patch: Partial<TransactionTemplate> }[];
  /** Plaid names handed to the target so bank transactions follow. */
  aliasesToTarget: string[];
  /** Bank transactions that follow automatically, or go uncategorised. */
  bankTransactions: number;
}

/**
 * Everything that has to change for a category to be deleted.
 *
 * The rule throughout: **nothing is left pointing at a category that no longer
 * exists.** A dangling id is the worst outcome — the transaction shows no
 * category, but isn't counted as uncategorised either.
 *
 * Budgets: moved to the target if it has no budget for the same period;
 * otherwise deleted, and the target's own budget stands. Two budgets for one
 * category and period would double-count, and silently adding their amounts
 * together would be a guess at what the user wanted.
 *
 * Rules: a rule that *files into* the category is re-pointed at the target. A
 * rule that is *conditioned on* the category ("currently filed as Dining") is
 * re-pointed too — but with no target it is switched off, not stripped of the
 * condition. Dropping the condition would widen the rule to match
 * transactions it was never meant to touch.
 */
export function planCategoryDeletion(input: DeletionInput): DeletionPlan {
  const { category, targetId } = input;
  const id = category.id!;
  const to = targetId ?? '';

  const transactions = input.storedTransactions
    .filter(t => t.id && t.categoryId === id)
    .map(t => ({ id: t.id!, patch: { categoryId: targetId ?? undefined } }));

  const budgetMoves: DeletionPlan['budgetMoves'] = [];
  const budgetDeletes: string[] = [];
  const samePeriod = (a: Budget, b: Budget) =>
    a.isDefault === b.isDefault && (a.isDefault || a.month === b.month);
  for (const b of input.budgets) {
    if (b.categoryId !== id || !b.id) continue;
    const clash = targetId && input.budgets.some(o =>
      o.categoryId === targetId && samePeriod(o, b));
    if (!targetId || clash) budgetDeletes.push(b.id);
    else budgetMoves.push({ id: b.id, patch: { categoryId: targetId } });
  }

  const rulePatches: DeletionPlan['rulePatches'] = [];
  let rulesDisabled = 0;
  for (const r of input.rules) {
    if (!r.id) continue;
    const patch: Partial<TransactionRule> = {};
    if (r.setCategoryId === id) patch.setCategoryId = targetId ?? undefined;
    if (r.categoryId === id) {
      if (targetId) patch.categoryId = targetId;
      else if (r.enabled) { patch.enabled = false; rulesDisabled++; }
    }
    if (Object.keys(patch).length) rulePatches.push({ id: r.id, patch });
  }

  const billPatches = input.bills
    .filter(b => b.id && b.categoryId === id)
    .map(b => ({ id: b.id!, patch: { categoryId: to || undefined } }));

  const templatePatches = input.templates
    .filter(t => t.id && t.categoryId === id)
    .map(t => ({ id: t.id!, patch: { categoryId: to || undefined } }));

  // Bank transactions follow the Plaid names. Only hand them over if the
  // target is a real category of the same kind.
  const target = targetId ? input.categories.find(c => c.id === targetId) : undefined;
  const aliasesToTarget = target && target.kind === category.kind
    ? plaidNamesFor(category).filter(n => !plaidNamesFor(target).includes(n))
    : [];

  return {
    transactions, budgetMoves, budgetDeletes, rulePatches, rulesDisabled,
    billPatches, templatePatches, aliasesToTarget,
    bankTransactions: input.matchedBankTransactions,
  };
}

/** Categories a deleted one's transactions may move to. */
export function deletionTargets(category: Category, categories: Category[]): Category[] {
  return categories.filter(c =>
    c.id !== category.id && c.kind === category.kind && !c.archived);
}

/**
 * The sensible default destination: the catch-all "Other" / "Other Income" if
 * it exists and isn't the one being deleted, else nothing (uncategorised).
 */
export function defaultDeletionTarget(category: Category, categories: Category[]): string | null {
  const catchAll = category.kind === 'income' ? 'Other Income' : 'Other';
  return deletionTargets(category, categories).find(c => c.name === catchAll)?.id ?? null;
}
