export interface Budget {
  id?: string;
  /**
   * The category this budget limits. Empty when `groupId` is set — a budget
   * targets exactly one of the two, never both.
   */
  categoryId: string;
  /**
   * Reserved for budgeting a whole CategoryGroup, so its categories share one
   * limit rather than each needing their own.
   *
   * NOT YET WIRED UP: nothing writes or reads this field. The Budgets page
   * resolves budgets by `categoryId` and its detail route is
   * `/budgets/:categoryId/:month`, so supporting groups means changing how
   * budgets are resolved, rendered and drilled into. Kept here as the schema
   * half so adding the feature is additive rather than a migration.
   */
  groupId?: string;
  amount: number;           // monthly budget limit
  month?: string;           // YYYY-MM — if set, overrides default for that month only
  isDefault: boolean;       // true = applies every month unless overridden
  createdAt: number;
}