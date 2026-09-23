/**
 * A user-defined bucket of categories — "Essentials", "Lifestyle", "Bills".
 *
 * Groups exist so spending can be read at a coarser level than categories
 * allow: eight categories is a list, three groups is a picture. Budgets can
 * target a group as well as a single category.
 *
 * A category belongs to at most one group (`Category.groupId`). Categories with
 * no group are reported together as "Ungrouped" rather than being hidden.
 */
export interface CategoryGroup {
  id?: string;
  name: string;
  /** Hex, for the group's chip and its slice of a grouped breakdown. */
  color?: string;
  /** Lower sorts first; ties fall back to name. */
  sortOrder?: number;
  createdAt: number;
}
