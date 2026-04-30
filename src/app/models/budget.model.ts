export interface Budget {
  id?: string;
  categoryId: string;
  amount: number;           // monthly budget limit
  month?: string;           // YYYY-MM — if set, overrides default for that month only
  isDefault: boolean;       // true = applies every month unless overridden
  createdAt: number;
}