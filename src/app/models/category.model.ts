export type CategoryKind = 'income' | 'expense';

export interface Category {
  id?: string;
  name: string;               // "Gas", "Groceries", "Salary"
  kind: CategoryKind;
  icon?: string;              // emoji
  color?: string;             // hex
  archived?: boolean;
  createdAt: number;
}
