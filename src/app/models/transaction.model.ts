export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id?: string;
  type: TransactionType;
  amount: number;             // always positive; sign derived from type

  // Common
  date: string;               // YYYY-MM-DD
  notes?: string;
  createdAt: number;
  updatedAt: number;

  // For income & expense
  accountId?: string;         // account affected
  categoryId?: string;
  merchant?: string;

  // For transfer
  fromAccountId?: string;
  toAccountId?: string;

  // AI metadata
  aiExtracted?: boolean;
  aiConfidence?: number;
  receiptUrl?: string;

  // Refund tracking
  refunded?: boolean;
  refundedBy?: string; // transaction ID of the refunding income

  // Partial-reimbursement linking (e.g. a friend pays you back ~half of a shared
  // meal). Set on an INCOME to point at the EXPENSE it reimburses. The expense's
  // true cost is then `amount − Σ(reimbursing incomes)` (floored at 0), and the
  // reimbursing income is left out of income totals — so analysis reflects what you
  // truly spent. Differs from `refunded`, which fully excludes an expense (whole
  // amount paid back). Derived, not stored, on the expense side.
  reimbursesId?: string; // on an income: the expense transaction id it pays back

  // Internal transfer tracking (e.g. a credit card payment: an expense on the
  // paying account and an income on the card account, both real per-account, but
  // not real spending/earning app-wide). Excluded from income/expense/savings
  // totals when true (Analysis, Dashboard, Budgets, and the Transactions "analysis
  // view"). Set manually via the transaction form's "Internal transfer" toggle —
  // NOT auto-detected for Plaid transactions today, so an untagged autopay still
  // counts as spending/income until the user marks it. (Auto-detection from Plaid's
  // transfer category is a possible future improvement.)
  isInternalTransfer?: boolean;

  // Plaid sync metadata (set for bank-synced transactions)
  plaidTransactionId?: string;            // Plaid transaction_id; also the Firestore doc id — used for dedup
  plaidItemId?: string;                   // Plaid item_id (which linked bank) — plaintext on the doc, for disconnect cleanup
  plaidAccountId?: string;                // Plaid account_id, for later mapping to an app account
  plaidPersonalFinanceCategory?: string;  // Plaid personal_finance_category.primary, for client-side categorization
  plaidPending?: boolean;                 // whether Plaid still marks it pending
}
