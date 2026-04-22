export interface Expense {
  id?: string;
  merchant: string;
  amount: number;
  date: string;      // YYYY-MM-DD
  category: string;
  notes?: string;
  createdAt: number;
}