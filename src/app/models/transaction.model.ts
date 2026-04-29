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
}
