import { Transaction } from '../models';

export interface AnalysisFilterParams {
  start?: string;
  end?: string;
  accountId?: string;
  excludeRefunded?: boolean;
  excludedCategoryIds?: Set<string>;
}

/** Shared by the Analysis page and the "see all categories" breakdown page, so
 *  both reflect the exact same filtered transaction set for a given period. */
export function filterForAnalysis(transactions: Transaction[], params: AnalysisFilterParams): Transaction[] {
  const { start, end, accountId, excludeRefunded, excludedCategoryIds } = params;
  return transactions.filter(t => {
    if (start && t.date < start) return false;
    if (end && t.date > end) return false;
    if (accountId && t.accountId !== accountId) return false;
    if (excludeRefunded && t.refunded) return false;
    if (t.categoryId && excludedCategoryIds?.has(t.categoryId)) return false;
    return true;
  });
}
