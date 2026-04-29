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

  // Credit card specific
  creditLimit?: number;
  statementClosingDay?: number;  // day of month 1-31
  paymentDueDay?: number;        // day of month 1-31
  autopayEnabled?: boolean;
  minimumPayment?: number;
}