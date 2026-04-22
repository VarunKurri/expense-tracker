export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment';

export interface Account {
  id?: string;
  name: string;               // "Chase Debit", "Apple Card"
  type: AccountType;
  // For checking/savings/cash: balance is money you have
  // For credit: balance is debt you owe (negative = debt)
  openingBalance: number;
  currency: 'USD';
  institution?: string;       // "Chase", "Apple"
  last4?: string;             // last 4 digits of card
  color?: string;             // hex, for UI
  icon?: string;              // emoji
  archived?: boolean;
  createdAt: number;
}
