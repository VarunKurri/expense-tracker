export type CategoryKind = 'income' | 'expense';

export interface Category {
  id?: string;
  name: string;               // "Gas", "Groceries", "Salary"
  kind: CategoryKind;
  icon?: string;              // emoji
  color?: string;             // hex
  archived?: boolean;
  createdAt: number;
  isDefault?: boolean;        // promoted to a kept "default" category via the cleanup tool
  /**
   * Plaid category names this category receives bank transactions under,
   * besides its own name. Set when a category Plaid matches on is renamed, or
   * inherited when one is deleted into this one. See utils/categories.ts.
   */
  plaidAliases?: string[];
}
