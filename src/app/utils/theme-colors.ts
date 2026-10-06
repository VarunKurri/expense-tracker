/**
 * Reads design tokens out of `src/styles.scss` at runtime.
 *
 * Chart.js takes real colour strings, not CSS custom properties, so chart
 * colours can't just be written as `var(--blue)` — they have to be resolved.
 * Reading them here (rather than hardcoding hex in each chart) keeps the charts
 * on the token layer and makes them follow the light/dark switch.
 *
 * Charts are redrawn on theme change; see `ThemeService`.
 */

/** Resolve a single CSS custom property to its computed value. */
export function token(name: string, fallback = ''): string {
  if (typeof getComputedStyle !== 'function') return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

/** The colours charts need, resolved for whichever theme is active. */
export function chartColors() {
  return {
    /** Spending / primary chart series. */
    accent: token('--blue', '#3B8EFF'),
    /** Income / positive series. */
    positive: token('--teal', '#0E9F6E'),
    negative: token('--red', '#DC3545'),
    /** Axis tick labels. */
    tick: token('--fg-3', '#8A8A8F'),
    /** Gridlines — deliberately faint in both themes. */
    grid: token('--line', '#E8E8EA'),
    /** Canvas colour, for donut segment borders. */
    surface: token('--surface', '#FFFFFF'),
    /** Full-strength ink, for labels drawn on top of coloured marks. */
    ink: token('--fg', '#131313'),
  };
}

/**
 * Category accent ramp (`--cat-1..8`) for donut segments, Sankey nodes and
 * category chips.
 *
 * Assign these in sequence and never cycle them — the fixed order is what keeps
 * adjacent slots distinguishable under colour-blindness. Past eight categories,
 * fold the tail into an "Other" slice rather than generating a ninth hue.
 */
export function categoryPalette(): string[] {
  const fallback = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100',
                    '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
  return fallback.map((f, i) => token(`--cat-${i + 1}`, f));
}

/** Neutral for the folded "Other" slice — never one of the eight identity hues. */
export function otherColor(): string {
  return token('--fg-4', '#B0B0B5');
}
