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

  // Plaid sync metadata (set for bank-synced transactions)
  plaidTransactionId?: string;            // Plaid transaction_id; also the Firestore doc id — used for dedup
  plaidAccountId?: string;                // Plaid account_id, for later mapping to an app account
  plaidPersonalFinanceCategory?: string;  // Plaid personal_finance_category.primary, for client-side categorization
  plaidPending?: boolean;                 // whether Plaid still marks it pending
}
