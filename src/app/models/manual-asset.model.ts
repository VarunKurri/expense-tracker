/**
 * Something you own or owe that no bank connection reports — a home, a car,
 * a car loan, a 401(k) at a provider Plaid can't reach.
 *
 * Its value is a list of dated valuations rather than one number, so the net
 * worth history can show what it was worth at the time instead of
 * back-filling today's value into every past month. Updating the value adds a
 * valuation; the latest one on or before a date is the value on that date.
 */
export type ManualAssetType =
  // assets
  | 'property' | 'vehicle' | 'investment' | 'cash' | 'valuable' | 'other-asset'
  // liabilities
  | 'mortgage' | 'auto-loan' | 'student-loan' | 'personal-loan' | 'other-liability';

export interface Valuation {
  date: string;   // YYYY-MM-DD
  value: number;  // always positive; whether it adds or subtracts comes from the type
}

export interface ManualAsset {
  id?: string;
  name: string;
  type: ManualAssetType;
  valuations: Valuation[];
  notes?: string;
  archived?: boolean;
  createdAt: number;
  updatedAt: number;
}
