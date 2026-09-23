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
  };
}

/** Category accent ramp (`--cat-1..7`), for donut segments and category chips. */
export function categoryPalette(): string[] {
  const fallback = ['#E8734A', '#F0A830', '#A0522D', '#2D6A4F', '#4AABE8', '#7C5CC4', '#C0405A'];
  return fallback.map((f, i) => token(`--cat-${i + 1}`, f));
}
