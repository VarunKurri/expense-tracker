export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment';

export interface Account {
  id?: string;
  name: string;
  type: AccountType;
  openingBalance: number;
  currency: 'USD';
  institution?: string;
  last4?: string;
  color?: string;
  icon?: string;
  archived?: boolean;
  createdAt: number;

  // Plaid (set for auto-created bank accounts)
  plaidAccountId?: string;   // links synced transactions (via their plaidAccountId) to this account
  plaidItemId?: string;      // which linked bank — for cleanup on disconnect
  openingBalanceSeeded?: boolean; // true once openingBalance has been reconciled against Plaid's real balance

  // Credit card specific
  creditLimit?: number;
  statementClosingDay?: number;  // day of month 1-31
  paymentDueDay?: number;        // day of month 1-31
  autopayEnabled?: boolean;
  autopayDay?: number;            // day of month 1-31 — when the bank actually debits, if different from paymentDueDay
  minimumPayment?: number;
  // Dynamic Plaid liability data, refreshed each sync (change every statement cycle).
  statementBalance?: number;     // last closed statement balance — the amount actually due
  paymentDueDate?: string;       // exact next payment due date (YYYY-MM-DD), from Plaid
  statementIssueDate?: string;   // last statement close date (YYYY-MM-DD) — for paid detection
  lastPaymentDate?: string;      // when the last card payment posted (YYYY-MM-DD)
  lastPaymentAmount?: number;    // amount of the last card payment
  statementOverdue?: boolean;    // Plaid's own is_overdue flag (authoritative)
}