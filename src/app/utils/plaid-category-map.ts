// Maps Plaid's personal_finance_category (primary) onto the app's seeded category
// names. Client-side only (the server can't read the user's categories). Anything
// unmapped falls back to "Other" / "Other Income"; users can always re-categorize,
// which takes precedence over this default.

const EXPENSE_MAP: Record<string, string> = {
  FOOD_AND_DRINK: 'Dining',
  GENERAL_MERCHANDISE: 'Shopping',
  HOME_IMPROVEMENT: 'Shopping',
  TRANSPORTATION: 'Transportation',
  TRAVEL: 'Travel',
  ENTERTAINMENT: 'Entertainment',
  RENT_AND_UTILITIES: 'Utilities',
  MEDICAL: 'Health',
  PERSONAL_CARE: 'Personal Care',
  BANK_FEES: 'Bank Fees',
  GENERAL_SERVICES: 'Financial Services',
  LOAN_PAYMENTS: 'Financial Services',
  GOVERNMENT_AND_NON_PROFIT: 'Charity & Gifts',
  TRANSFER_OUT: 'Personal Transfers',
  // Anything else -> Other
};

/** The app category NAME a Plaid transaction should default to. */
export function plaidCategoryName(pfcPrimary: string | undefined, type: 'income' | 'expense'): string {
  if (type === 'income') return 'Other Income';
  return (pfcPrimary && EXPENSE_MAP[pfcPrimary]) || 'Other';
}
