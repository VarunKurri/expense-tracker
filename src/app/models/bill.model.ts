export type BillFrequency = 'monthly' | 'yearly' | 'weekly' | 'quarterly';

export interface Bill {
  id?: string;
  name: string;               // "ChatGPT Plus"
  amount: number;
  frequency: BillFrequency;
  nextDueDate: string;        // YYYY-MM-DD
  accountId?: string;         // which account it bills to
  categoryId?: string;
  active: boolean;
  icon?: string;
  createdAt: number;
}
