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

  // Credit card specific
  creditLimit?: number;
  statementClosingDay?: number;  // day of month 1-31
  paymentDueDay?: number;        // day of month 1-31
  autopayEnabled?: boolean;
  minimumPayment?: number;
}