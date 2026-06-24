export type BillFrequency = 'monthly' | 'yearly' | 'weekly' | 'quarterly';
export type BillAmountMode = 'fixed' | 'variable';
export type BillDueDateMode = 'exact' | 'flexible';

export interface Bill {
  id?: string;
  name: string;
  amount: number;
  amountMode?: BillAmountMode;
  frequency: BillFrequency;
  nextDueDate: string;        // YYYY-MM-DD
  dueDateMode?: BillDueDateMode;
  accountId?: string;
  categoryId?: string;
  autopayEnabled: boolean;
  icon?: string;
  color?: string;
  notes?: string;
  active: boolean;
  createdAt: number;
}
