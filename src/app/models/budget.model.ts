export interface Budget {
  id?: string;
  categoryId: string;
  month: string;              // YYYY-MM
  limit: number;
  createdAt: number;
}
