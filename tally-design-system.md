# Tally Design System — Angular Integration Guide

## Overview

The Tally design is a React/JSX prototype located in `expense_tracker_design/tally/`.
DO NOT copy JSX directly into Angular. Instead:
- Port CSS variables and class patterns to Angular SCSS
- Use the JSX as a visual reference for component structure
- All logic stays in Angular TypeScript with Firebase

---

## Color Tokens (replace styles.scss variables)

```scss
/* DARK MODE (default from design) */
:root[data-theme="dark"] {
  --bg:          #0B0B0D;
  --bg-2:        #141417;
  --bg-3:        #1C1C21;
  --surface:     #17171B;
  --surface-hi:  #1F1F25;
  --line:        rgba(255,255,255,0.08);
  --line-strong: rgba(255,255,255,0.14);

  --fg:   #F7F7F5;
  --fg-2: #C9C9CE;
  --fg-3: #8A8A92;
  --fg-4: #5A5A62;

  --green:    #00D64F;
  --green-hi: #3EFF7A;
  --green-bg: rgba(0, 214, 79, 0.12);
  --red:      #FF4D5E;
  --red-bg:   rgba(255, 77, 94, 0.12);
  --amber:    #FFB020;
  --blue:     #4DA6FF;
  --violet:   #A78BFA;
}

/* LIGHT MODE (default) */
:root, :root[data-theme="light"] {
  --bg:          #F5F5F7;
  --bg-2:        #FFFFFF;
  --bg-3:        #EBEBED;
  --surface:     #FFFFFF;
  --surface-hi:  #F0F0F2;
  --line:        rgba(0,0,0,0.07);
  --line-strong: rgba(0,0,0,0.12);

  --fg:   #0A0A0C;
  --fg-2: #2C2C30;
  --fg-3: #6B6B72;
  --fg-4: #9A9AA2;

  --green:    #00A83C;
  --green-hi: #00D64F;
  --green-bg: rgba(0, 168, 60, 0.10);
  --red:      #E0192D;
  --red-bg:   rgba(224, 25, 45, 0.10);
  --amber:    #C97A00;
  --blue:     #1A7FD4;
  --violet:   #7C5CC4;
}
```

---

## Typography

```scss
font-family: 'Inter Tight', 'Inter', -apple-system, BlinkMacSystemFont, 'SF Pro Display', sans-serif;
font-feature-settings: 'ss01', 'cv11';
letter-spacing: -0.01em;

/* Headings: always letter-spacing: -0.03em to -0.04em, font-weight: 650 */
/* Numbers: font-variant-numeric: tabular-nums */
/* Muted text: color: var(--fg-3) */
/* Section labels: font-size: 10.5px, font-weight: 600, letter-spacing: 0.12em, text-transform: uppercase, color: var(--fg-4) */
```

---

## Layout tokens

```scss
--radius:      16px;
--radius-sm:   10px;
--radius-lg:   24px;
--radius-pill: 999px;
--t:           .18s cubic-bezier(.2,.8,.2,1);
```

---

## Shell structure (from Shell.jsx)

```
.shell { display: grid; grid-template-columns: 240px 1fr; min-height: 100vh; }
.sidebar { padding: 20px 14px; border-right: 1px solid var(--line); position: sticky; top: 0; height: 100vh; }
.main { min-width: 0; min-height: 100vh; }
.topbar { display: flex; align-items: center; gap: 14px; padding: 16px 32px; border-bottom: 1px solid var(--line); position: sticky; top: 0; background: rgba(var(--bg-rgb), 0.85); backdrop-filter: blur(20px); z-index: 20; }
```

---

## Key component patterns (reference JSX files for visuals)

### Nav item (from Shell.jsx)
```scss
.nav-item { display: flex; align-items: center; gap: 11px; padding: 9px 12px; border-radius: 10px; color: var(--fg-3); font-size: 14px; font-weight: 500; }
.nav-item:hover { background: var(--surface); color: var(--fg); }
.nav-item.active { background: var(--surface-hi); color: var(--fg); }
/* active items use SVG icons, NOT emoji */
```

### Hero card (Dashboard — from Dashboard.jsx)
```scss
.hero { padding: 32px; border-radius: var(--radius-lg); background: radial-gradient(120% 160% at 100% 0%, rgba(0, 214, 79, 0.25) 0%, rgba(0,214,79,0) 55%), var(--bg-2); border: 1px solid var(--line); }
/* Large number: font-size: 76px; font-weight: 650; letter-spacing: -0.055em */
```

### KPI tile (Dashboard — from Dashboard.jsx)
```scss
.kpi { padding: 18px 20px; border-radius: var(--radius); background: var(--surface); border: 1px solid var(--line); }
.kpi-value { font-size: 28px; font-weight: 650; letter-spacing: -0.035em; }
```

### Account card (from Accounts.jsx)
```scss
/* Dark surface card, NOT gradient. Use --surface bg with green accent glow on featured */
.acct-big { padding: 22px; border-radius: var(--radius-lg); background: var(--surface); border: 1px solid var(--line); min-height: 180px; }
/* Balance: font-size: 36px; font-weight: 650; letter-spacing: -0.04em */
/* Negative balance: color: var(--red) */
```

### Transaction row (from Transactions.jsx)
```scss
.tx-row { display: grid; grid-template-columns: 40px 1fr auto; gap: 14px; align-items: center; padding: 12px; border-radius: 12px; }
.tx-row:hover { background: var(--bg-3); }
.tx-icon { width: 40px; height: 40px; border-radius: 12px; background: var(--bg-3); }
/* Income icon bg: var(--green-bg) */
/* Amount pos: color: var(--green) */
/* Amount neg: color: var(--fg) (NOT red — Tally uses white/dark for expenses) */
```

### Modal (from App.jsx QuickAdd)
```scss
.backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.6); backdrop-filter: blur(8px); }
.modal { background: var(--surface-hi); border: 1px solid var(--line-strong); border-radius: var(--radius-lg); padding: 24px; }
/* Amount input: font-size: 64px; font-weight: 700; letter-spacing: -0.05em */
```

### Filter chips (from Transactions.jsx)
```scss
.chip { padding: 7px 12px; border-radius: 999px; font-size: 12.5px; background: var(--surface); border: 1px solid var(--line); }
.chip.active { background: var(--fg); color: #000; border-color: transparent; }
```

### Budget bar (from Pages.jsx)
```scss
.budget-bar { height: 7px; border-radius: 4px; background: var(--bg-3); }
.budget-fill { background: var(--green); }
.budget-fill.warn { background: var(--amber); }   /* >75% */
.budget-fill.over { background: var(--red); }     /* >100% */
```

---

## Dark/Light toggle implementation (Angular)

### ThemeService (create at src/app/services/theme.service.ts)
```typescript
import { Injectable, signal, effect } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  theme = signal<'light' | 'dark'>(
    (localStorage.getItem('theme') as 'light' | 'dark') || 'light'
  );

  constructor() {
    effect(() => {
      const t = this.theme();
      document.documentElement.setAttribute('data-theme', t);
      localStorage.setItem('theme', t);
    });
  }

  toggle() {
    this.theme.update(t => t === 'light' ? 'dark' : 'light');
  }
}
```

### Toggle button HTML (in sidebar)
```html
<button class="theme-toggle" (click)="theme.toggle()" [title]="theme.theme() === 'dark' ? 'Switch to light' : 'Switch to dark'">
  @if (theme.theme() === 'dark') { ☀️ } @else { 🌙 }
</button>
```

---

## Icons

The design uses inline SVG icons (see Shell.jsx Icon component).
In Angular, create `src/app/components/icon/icon.ts` with the same SVG paths.
Do NOT use emoji for nav icons — use SVG strokes matching the design.

SVG paths from Shell.jsx:
- home: 'M3 10L10 4l7 6v6a1 1 0 01-1 1h-3v-5H9v5H6a1 1 0 01-1-1v-6z'
- accounts: 'M2 8a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8zm0 3h16M6 15h4'
- tx: 'M4 8l3-4 3 4M7 4v9M10 12l3 4 3-4M13 16V7'
- bills: 'M5 6h10M5 10h10M5 14h6'
- budgets: 'M10 2a8 8 0 100 16A8 8 0 0010 2zm0 5a3 3 0 100 6 3 3 0 000-6z'
- analysis: 'M2.5 15.5l5-6.5 4 4 5.5-8M15 5h3.5v3.5'
- profile: 'M10 10a3 3 0 100-6 3 3 0 000 6zM4 17c0-3 3-5 6-5s6 2 6 5'
- settings: 'M10 13a3 3 0 100-6 3 3 0 000 6zM16 10l2-1-1-2-2 1-1.5-1L13 5h-2l-.5 2L9 8l-2-1-1 2 2 1v2l-2 1 1 2 2-1 1.5 1L11 17h2l.5-2L15 14l2 1 1-2-2-1z'
- search: 'M8 14A6 6 0 108 2a6 6 0 000 12zM18 18l-4.35-4.35'
- bell: 'M4 8a6 6 0 1112 0v4l2 3H2l2-3V8zM8 18a2 2 0 004 0'
- plus: 'M10 4v12M4 10h12'

All icons: viewBox="0 0 20 20", fill="none", stroke="currentColor", strokeWidth=1.75, strokeLinecap="round", strokeLinejoin="round"

---

## What NOT to do

- Do NOT copy JSX directly into Angular templates
- Do NOT use the React useState/useEffect logic
- Do NOT use the hardcoded data.js — use Firebase signals instead
- Do NOT apply glassmorphic styles from Part 3 anymore — replace with Tally's flat dark/light surface system
- Do NOT use backdrop-filter blur on cards — only on the topbar sticky header
