# Project Ground Rules for Claude Code

## Stack

- Angular 21 (standalone components, signals, new control flow `@if`/`@for`)
- Firebase (Firestore + Auth + Functions)
- `@angular/fire@19` + `firebase@11` (these specific versions — do NOT upgrade)
- Running on Windows + PowerShell
- User is a beginner to Angular; prioritize clarity over cleverness

## Critical constraints

- NEVER upgrade `firebase` past v11 or `@angular/fire` past v19 (breaks peer deps)
- When running npm commands, ALWAYS add `--legacy-peer-deps` flag
- Component class names follow Angular 21 convention: `Dashboard` not `DashboardComponent`
- File names follow Angular 21 convention: `dashboard.ts` not `dashboard.component.ts`
- Always use `runInInjectionContext` when calling Firebase APIs from observables (there is a known warning we work around)
- `import 'zone.js';` MUST be the first line of `src/main.ts`

## Workflow rules

- After every meaningful change, run `ng serve` (in a separate terminal if needed) and check for errors before moving on
- Commit to git after each working step so we have rollback points
- When completing a step in the tutorial, STOP and wait for user to verify before continuing
- Ask the user to share DevTools console errors if runtime issues appear
- Never invent Firebase config values — read them from `src/environments/environment.ts`

## Design system

Modelled on Origin (useorigin.com). Values below are ported from Origin's own
production stylesheet. **Not glassmorphic** — that was two designs ago. Do not
reintroduce blurred cards, coloured primary buttons, or green glow gradients.

- All tokens live in `src/styles.scss`. Fonts load from `src/index.html`.
- **Dark is the default.** Light mode exists and must keep working.
- Three type voices:
  - `var(--font-display)` Newsreader, **weight 300** — headings and hero figures
  - `var(--font-ui)` Inter — all UI text
  - `var(--font-mono)` Roboto Mono, **10px/500 UPPERCASE** — labels, eyebrows, data, buttons
- Signature headline pattern: one word italicised in the display serif —
  `<h1 class="display">Track <em>your entire</em> financial life.</h1>`
- **Colour discipline:** surfaces are monochrome. Colour appears only as a data
  signal (chart lines, sparklines, category tiles). `--teal` = positive,
  `--red` = negative, `--blue` / `--forecast-grad` = forward-looking projections.
- **White-on-black is the only primary action.** `.btn-primary` is `--fg` on
  `--bg`. Never a coloured fill.
- Radii: `--radius-xs` 4px · `--radius-sm` 8px (inputs) · `--radius` 14px (cards)
  · `--radius-pill` 999px.
- Cards use `var(--card-grad)`; inputs use `var(--input-grad)`.
- Shared classes: `.card`, `.btn-primary`, `.btn-ghost`, `.btn-danger`,
  `.input` / `.input-field`, `.chip`, `.display`, `.label-mono`, `.num`.
- `.glass` / `.glass-strong` are legacy aliases for flat surfaces, kept only so
  un-converted templates still render. Do not use them in new markup.
- Desktop-first, responsive down to mobile.
- Microcopy follows Origin: mono uppercase eyebrow → plain-English sentence
  headline → a calm sentence explaining *why it matters*. Never just a number.
- `tally-design-system.md` and `expense_tracker_design/tally/` describe the
  **previous** (Tally) design and are kept for reference only — they are not the
  current target.

## Secrets

- `ANTHROPIC_API_KEY` is stored as a Firebase Functions secret, NEVER hardcoded
- Never print API keys in logs or terminal output

## File structure

```text
src/app/
  models/           interfaces only
  services/         Firebase + business logic
  pages/            routed pages
    dashboard/
    accounts/
    transactions/
    bills/
    budgets/
    analysis/
  app.ts            shell with sidebar
  app.html
  app.scss
  app.config.ts     providers
  app.routes.ts
```

## When things break

- If `npm install` fails with ERESOLVE, add `--legacy-peer-deps`
- If Firestore complains about "different SDK", run `npm list firebase` to check for duplicate versions
- If a component renders blank, check the class name matches the route import
- If Zone.js errors appear, confirm `import 'zone.js';` is the first line of `main.ts`

## Git discipline

- Never force-push or rewrite history
- Always commit before destructive operations (file deletions, major refactors)
- Suggested commit message format: `part N: <what changed>`
