// Early seeds stored icon *names* (e.g. "Cash", "Bank", "Dining") instead of emoji,
// and templates render the raw value — so those accounts/categories showed literal
// text. Map known legacy names to emoji at read time; real emoji pass through.
const LEGACY_ICON_MAP: Record<string, string> = {
  // Accounts
  Cash: '💵',
  Bank: '🏦',
  Card: '💳',
  // Categories (expense)
  Groceries: '🛒',
  Gas: '⛽',
  Dining: '🍽️',
  Parking: '🅿️',
  Car: '🚗',
  Auto: '🔧',
  Shopping: '🛍️',
  Entertainment: '🎬',
  Home: '🏠',
  Utilities: '💡',
  Health: '💊',
  Subscriptions: '📺',
  Other: '📦',
  // Categories (income)
  Salary: '💼',
  Bonus: '🎁',
  Interest: '📈',
  Income: '💰',
};

export function displayIcon(icon: string | undefined): string | undefined {
  if (!icon) return icon;
  return LEGACY_ICON_MAP[icon] ?? icon;
}
