export type BillFrequency = 'monthly' | 'yearly' | 'weekly' | 'quarterly';

export interface Bill {
  id?: string;
  name: string;
  amount: number;
  frequency: BillFrequency;
  nextDueDate: string;        // YYYY-MM-DD
  accountId?: string;
  categoryId?: string;
  autopayEnabled: boolean;
  icon?: string;
  color?: string;
  notes?: string;
  active: boolean;
  createdAt: number;
}