import { Transaction, TransactionRule } from '../models';

/**
 * Evaluating transaction rules.
 *
 * Kept as pure functions, separate from the service, for two reasons: they are
 * the part that can silently mis-categorise real money, so they need tests; and
 * they run in two different places — when a transaction is added by hand, and
 * in a bulk pass over transactions that arrived from a bank sync.
 *
 * Why the bulk pass exists at all: rules are encrypted with the user's key, so
 * the Plaid sync Cloud Function cannot read them. Anything arriving from the
 * bank is therefore categorised on the client, after the fact.
 */

/** A rule with no action would match transactions and change nothing. */
export function ruleHasAction(rule: TransactionRule): boolean {
  return rule.setCategoryId !== undefined || rule.setInternalTransfer !== undefined;
}

/** A rule with no condition would match everything — never what was meant. */
export function ruleHasCondition(rule: TransactionRule): boolean {
  return Boolean(
    rule.merchantContains?.trim() ||
    rule.type ||
    rule.accountId ||
    rule.categoryId ||
    rule.amountMin !== undefined ||
    rule.amountMax !== undefined
  );
}

/** Rules that are safe to run: enabled, and both a condition and an action. */
/**
 * True when a rule files into a category that no longer exists.
 *
 * Categories can be hard-deleted, and nothing ties a rule to the category it
 * files into — so a deleted category leaves the rule pointing at an id with no
 * record behind it. Left alone, "Re-file everything" would stamp that dead id
 * onto every matching transaction and they would all read as broken.
 */
export function hasMissingCategory(rule: TransactionRule, validCategoryIds: Set<string>): boolean {
  return !!rule.setCategoryId && !validCategoryIds.has(rule.setCategoryId);
}

/**
 * Rules with any file-into-a-deleted-category action removed.
 *
 * Only that one action is dropped, not the whole rule: a rule that also flags
 * internal transfers keeps doing that. A rule left with no action at all then
 * falls out of `usableRules` on its own, the same as any other inert rule.
 */
export function dropMissingCategories(
  rules: TransactionRule[], validCategoryIds: Set<string>,
): TransactionRule[] {
  return rules.map(r =>
    hasMissingCategory(r, validCategoryIds) ? { ...r, setCategoryId: undefined } : r);
}

export function usableRules(rules: TransactionRule[]): TransactionRule[] {
  return rules
    .filter(r => r.enabled && ruleHasCondition(r) && ruleHasAction(r))
    .sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
}

/**
 * Does this rule match the transaction?
 *
 * Every condition present must hold. The merchant test also looks at the notes,
 * because bank-synced rows often carry the useful text there rather than in a
 * clean merchant field.
 */
export function ruleMatches(rule: TransactionRule, t: Transaction): boolean {
  if (!ruleHasCondition(rule)) return false;

  const needle = rule.merchantContains?.trim().toLowerCase();
  if (needle) {
    const haystack = `${t.merchant ?? ''} ${t.notes ?? ''}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (rule.type && t.type !== rule.type) return false;
  if (rule.accountId && t.accountId !== rule.accountId) return false;
  if (rule.categoryId && (t.categoryId ?? '') !== rule.categoryId) return false;

  const amount = Math.abs(t.amount);
  if (rule.amountMin !== undefined && amount < rule.amountMin) return false;
  if (rule.amountMax !== undefined && amount > rule.amountMax) return false;

  return true;
}

/** The changes a rule set would make to one transaction, or null for none. */
export interface RuleOutcome {
  patch: Partial<Transaction>;
  /** The rules that contributed, in the order they applied. */
  matched: TransactionRule[];
}

/**
 * Work out what the rules would change on a transaction.
 *
 * Rules run in priority order and the FIRST rule to set a given field wins, so
 * a specific high-priority rule is not undone by a broader one beneath it. A
 * rule that matches but only sets fields already decided still counts as
 * matched, which is what makes the rule tester honest about overlap.
 *
 * Returns null when nothing would change — callers use that to skip a write.
 */
export function evaluateRules(rules: TransactionRule[], t: Transaction): RuleOutcome | null {
  const patch: Partial<Transaction> = {};
  const matched: TransactionRule[] = [];
  let categoryDecided = false;
  let transferDecided = false;

  for (const rule of usableRules(rules)) {
    if (!ruleMatches(rule, t)) continue;
    matched.push(rule);

    if (!categoryDecided && rule.setCategoryId !== undefined) {
      categoryDecided = true;
      if (rule.setCategoryId !== (t.categoryId ?? '')) patch.categoryId = rule.setCategoryId;
    }
    if (!transferDecided && rule.setInternalTransfer !== undefined) {
      transferDecided = true;
      if (rule.setInternalTransfer !== Boolean(t.isInternalTransfer)) {
        patch.isInternalTransfer = rule.setInternalTransfer;
      }
    }
  }

  if (!matched.length || !Object.keys(patch).length) return null;
  return { patch, matched };
}

/**
 * Apply rules to a transaction being created, returning the adjusted draft.
 *
 * Used on manual entry, where there is no document to update yet — the rule's
 * result is folded into the record before it is written.
 */
export function applyRulesToDraft<T extends Partial<Transaction>>(
  rules: TransactionRule[], draft: T
): T {
  const outcome = evaluateRules(rules, draft as Transaction);
  return outcome ? { ...draft, ...outcome.patch } : draft;
}

export interface BulkRuleResult {
  id: string;
  patch: Partial<Transaction>;
}

/**
 * Which existing transactions the rules would change, and how.
 *
 * `onlyUncategorised` is the safe default for an automatic pass: it leaves
 * anything the user has already filed alone, so a new rule cannot quietly
 * overwrite deliberate choices. The management screen offers the unrestricted
 * pass explicitly, for when re-filing is the intent.
 */
export function planBulkApply(
  rules: TransactionRule[],
  transactions: Transaction[],
  opts: { onlyUncategorised?: boolean } = {},
): BulkRuleResult[] {
  const usable = usableRules(rules);
  if (!usable.length) return [];

  const out: BulkRuleResult[] = [];
  for (const t of transactions) {
    if (!t.id) continue;
    if (opts.onlyUncategorised && t.categoryId) continue;
    const outcome = evaluateRules(usable, t);
    if (outcome) out.push({ id: t.id, patch: outcome.patch });
  }
  return out;
}

/** A human-readable summary of a rule, for the list and for a default name. */
export function describeRule(
  rule: TransactionRule,
  categoryName: (id: string) => string,
  accountName: (id: string) => string,
): string {
  const when: string[] = [];
  if (rule.merchantContains?.trim()) when.push(`name contains "${rule.merchantContains.trim()}"`);
  if (rule.type) when.push(`is ${rule.type}`);
  if (rule.accountId) when.push(`on ${accountName(rule.accountId)}`);
  if (rule.categoryId) when.push(`currently ${categoryName(rule.categoryId)}`);
  if (rule.amountMin !== undefined && rule.amountMax !== undefined) {
    when.push(`between ${rule.amountMin} and ${rule.amountMax}`);
  } else if (rule.amountMin !== undefined) {
    when.push(`over ${rule.amountMin}`);
  } else if (rule.amountMax !== undefined) {
    when.push(`under ${rule.amountMax}`);
  }

  const then: string[] = [];
  if (rule.setCategoryId !== undefined) then.push(`file as ${categoryName(rule.setCategoryId)}`);
  if (rule.setInternalTransfer !== undefined) {
    then.push(rule.setInternalTransfer ? 'mark as internal transfer' : 'clear internal transfer');
  }

  if (!when.length) return 'Incomplete rule — add a condition';
  if (!then.length) return 'Incomplete rule — add an action';
  return `When ${when.join(' and ')}, ${then.join(' and ')}`;
}
