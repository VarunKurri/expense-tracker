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

  // Internal transfer tracking (e.g. a credit card payment: an expense on the
  // paying account and an income on the card account, both real per-account, but
  // not real spending/earning app-wide). Excluded from income/expense/savings
  // totals when true. Auto-set for Plaid transactions whose category indicates a
  // transfer; user-toggleable on any transaction to correct what Plaid misses.
  isInternalTransfer?: boolean;

  // Plaid sync metadata (set for bank-synced transactions)
  plaidTransactionId?: string;            // Plaid transaction_id; also the Firestore doc id — used for dedup
  plaidItemId?: string;                   // Plaid item_id (which linked bank) — plaintext on the doc, for disconnect cleanup
  plaidAccountId?: string;                // Plaid account_id, for later mapping to an app account
  plaidPersonalFinanceCategory?: string;  // Plaid personal_finance_category.primary, for client-side categorization
  plaidPending?: boolean;                 // whether Plaid still marks it pending
}
