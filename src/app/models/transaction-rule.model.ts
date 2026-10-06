import { TransactionType } from './transaction.model';

/**
 * An automatic categorisation rule — Origin's "mark all Lyft transactions as
 * Rideshare".
 *
 * Rules are stored encrypted like every other record, which means they can only
 * be evaluated on the client: the Plaid sync Cloud Function has no key and
 * cannot read them. So rules run when the client sees a transaction, not at
 * write time on the server. See `applyRules` in `utils/rules.ts`.
 */
export interface TransactionRule {
  id?: string;
  /** Shown in the rules list; falls back to a description of the match. */
  name?: string;
  enabled: boolean;
  /** Lower runs first. The first rule that matches and sets a field wins. */
  priority: number;

  // ── Conditions. All present conditions must match (AND). ──
  /** Case-insensitive substring of the merchant or the notes. */
  merchantContains?: string;
  /** Only transactions of this type. */
  type?: TransactionType;
  /** Only transactions on this account. */
  accountId?: string;
  /** Inclusive bounds on the absolute amount. */
  amountMin?: number;
  amountMax?: number;
  /** Only transactions currently in this category (for re-filing). */
  categoryId?: string;

  // ── Actions. At least one must be set for the rule to do anything. ──
  setCategoryId?: string;
  /** Flags a credit-card payment or similar so it leaves the spending totals. */
  setInternalTransfer?: boolean;

  createdAt: number;
}
