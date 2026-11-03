import { Transaction } from '../models';

/**
 * What a bulk action on the Transactions page may touch: rows that are both
 * ticked and shown under the current filters, in the order they're shown. A
 * row that's ticked but filtered out of view is never edited or deleted, so
 * what you see selected is exactly what changes.
 */
export function visibleSelection(shown: Transaction[], selectedIds: Set<string>): Transaction[] {
  return shown.filter(t => !!t.id && selectedIds.has(t.id));
}

/** Every row shown, for "Select all". */
export function allShownIds(shown: Transaction[]): Set<string> {
  return new Set(shown.map(t => t.id).filter((id): id is string => !!id));
}
