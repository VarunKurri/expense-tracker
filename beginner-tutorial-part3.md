# Expense Tracker — Tutorial Part 3: The Foundation

**Goal:** Restructure the app for the full personal finance system + set up the glassmorphic design language.
**Time:** ~3 hours
**Prerequisite:** Parts 1 and 2 are working.

> ⚠️ **This part doesn't add visible "features"** — it's architectural. Resist the urge to skip it. Every page you'll build from Part 4 onwards depends on this structure being right.

---

## What you'll build in Part 3

- Left sidebar navigation with 6 sections
- Glassmorphic theme system (blurred cards, gradients, dark mode)
- Unified **Transactions** data model (income + expense + transfer in one collection)
- Migration of your existing expense data to the new model
- Default accounts auto-created on first sign-in
- Router with lazy-loaded pages (shell pages for now, filled in later parts)

---

## Step 1 — Plan the new data model (read this carefully, 5 min)

Here's what we're moving from/to:

### Current Firestore structure (Part 1+2)
```
users/{uid}/expenses/{id}   ← just expenses
```

### New Firestore structure (Part 3+)
```
users/{uid}/
  accounts/{id}          ← Chase Debit, Apple Card, Cash, etc.
  categories/{id}        ← Gas, Groceries, Salary (user-customizable)
  transactions/{id}      ← type: "income" | "expense" | "transfer"
  bills/{id}             ← recurring subscriptions (Part 6)
  budgets/{id}           ← monthly per-category budgets (Part 7)
```

### Why unified transactions?

**Expense:** `{type: "expense", accountId: "chase-debit", categoryId: "gas", amount: 45, ...}`
**Income:** `{type: "income", accountId: "chase-debit", categoryId: "salary", amount: 5000, ...}`
**Transfer:** `{type: "transfer", fromAccountId: "chase-debit", toAccountId: "apple-card", amount: 200, ...}`

One collection = one filter UI, one timeline view, one query. Any account balance at any time = sum of all transactions touching that account.

---

## Step 2 — Add routing and install packages (15 min)

Stop `ng serve` (Ctrl+C). In the terminal:

```powershell
npm install chart.js ng2-charts date-fns --legacy-peer-deps
```

These are for the charts (Part 8) and date formatting (everywhere). Install now so we don't have to stop later.

---

## Step 3 — Update the data models (20 min)

### 3.1 Replace the old expense model

Open `src/app/models/expense.model.ts` → **delete the file**.

### 3.2 Create new model files

Right-click `src/app/models` → New File → `account.model.ts`:

```typescript
export type AccountType = 'checking' | 'savings' | 'credit' | 'cash' | 'investment';

export interface Account {
  id?: string;
  name: string;               // "Chase Debit", "Apple Card"
  type: AccountType;
  // For checking/savings/cash: balance is money you have
  // For credit: balance is debt you owe (negative = debt)
  openingBalance: number;
  currency: 'USD';
  institution?: string;       // "Chase", "Apple"
  last4?: string;             // last 4 digits of card
  color?: string;             // hex, for UI
  icon?: string;              // emoji
  archived?: boolean;
  createdAt: number;
}
```

Create `src/app/models/category.model.ts`:

```typescript
export type CategoryKind = 'income' | 'expense';

export interface Category {
  id?: string;
  name: string;               // "Gas", "Groceries", "Salary"
  kind: CategoryKind;
  icon?: string;              // emoji
  color?: string;             // hex
  archived?: boolean;
  createdAt: number;
}
```

Create `src/app/models/transaction.model.ts`:

```typescript
export type TransactionType = 'income' | 'expense' | 'transfer';

export interface Transaction {
  id?: string;
  type: TransactionType;
  amount: number;             // always positive; sign derived from type

  // Common
  date: string;               // YYYY-MM-DD
  notes?: string;
  createdAt: number;
  updatedAt: number;

  // For income & expense
  accountId?: string;         // account affected
  categoryId?: string;
  merchant?: string;

  // For transfer
  fromAccountId?: string;
  toAccountId?: string;

  // AI metadata
  aiExtracted?: boolean;
  aiConfidence?: number;
  receiptUrl?: string;
}
```

Create `src/app/models/bill.model.ts`:

```typescript
export type BillFrequency = 'monthly' | 'yearly' | 'weekly' | 'quarterly';

export interface Bill {
  id?: string;
  name: string;               // "ChatGPT Plus"
  amount: number;
  frequency: BillFrequency;
  nextDueDate: string;        // YYYY-MM-DD
  accountId?: string;         // which account it bills to
  categoryId?: string;
  active: boolean;
  icon?: string;
  createdAt: number;
}
```

Create `src/app/models/budget.model.ts`:

```typescript
export interface Budget {
  id?: string;
  categoryId: string;
  month: string;              // YYYY-MM
  limit: number;
  createdAt: number;
}
```

Create `src/app/models/index.ts` (a barrel export for clean imports):

```typescript
export * from './account.model';
export * from './category.model';
export * from './transaction.model';
export * from './bill.model';
export * from './budget.model';
```

---

## Step 4 — Rewrite the services (30 min)

The old `ExpenseService` needs to become a `TransactionService` plus new services for each data type. Let's do it cleanly.

### 4.1 Delete the old expense service

Delete `src/app/services/expense.service.ts`.

### 4.2 Create the account service

Create `src/app/services/account.service.ts`:

```typescript
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc, updateDoc,
  deleteDoc, doc, query, orderBy
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Account } from '../models';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private injector = inject(EnvironmentInjector);

  private accounts$: Observable<Account[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      return runInInjectionContext(this.injector, () => {
        const ref = collection(this.db, `users/${user.uid}/accounts`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        return collectionData(q, { idField: 'id' }) as Observable<Account[]>;
      });
    })
  );

  accounts = toSignal(this.accounts$, { initialValue: [] });

  async add(account: Omit<Account, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/accounts`);
    await addDoc(ref, { ...account, createdAt: Date.now() });
  }

  async update(id: string, patch: Partial<Account>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/accounts/${id}`), patch);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/accounts/${id}`));
  }
}
```

### 4.3 Create the category service

Create `src/app/services/category.service.ts`:

```typescript
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc, updateDoc,
  deleteDoc, doc, query, orderBy
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Category } from '../models';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private injector = inject(EnvironmentInjector);

  private categories$: Observable<Category[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      return runInInjectionContext(this.injector, () => {
        const ref = collection(this.db, `users/${user.uid}/categories`);
        const q = query(ref, orderBy('name', 'asc'));
        return collectionData(q, { idField: 'id' }) as Observable<Category[]>;
      });
    })
  );

  categories = toSignal(this.categories$, { initialValue: [] });

  async add(category: Omit<Category, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/categories`);
    await addDoc(ref, { ...category, createdAt: Date.now() });
  }

  async update(id: string, patch: Partial<Category>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/categories/${id}`), patch);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/categories/${id}`));
  }
}
```

### 4.4 Create the transaction service

Create `src/app/services/transaction.service.ts`:

```typescript
import { Injectable, inject, computed, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc, updateDoc,
  deleteDoc, doc, query, orderBy
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Transaction } from '../models';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private injector = inject(EnvironmentInjector);

  private transactions$: Observable<Transaction[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      return runInInjectionContext(this.injector, () => {
        const ref = collection(this.db, `users/${user.uid}/transactions`);
        const q = query(ref, orderBy('date', 'desc'), orderBy('createdAt', 'desc'));
        return collectionData(q, { idField: 'id' }) as Observable<Transaction[]>;
      });
    })
  );

  transactions = toSignal(this.transactions$, { initialValue: [] });

  /** Running balance for a given account = sum of everything touching it */
  balanceForAccount(accountId: string): number {
    let balance = 0;
    for (const t of this.transactions()) {
      if (t.type === 'income' && t.accountId === accountId) balance += t.amount;
      else if (t.type === 'expense' && t.accountId === accountId) balance -= t.amount;
      else if (t.type === 'transfer') {
        if (t.fromAccountId === accountId) balance -= t.amount;
        if (t.toAccountId === accountId) balance += t.amount;
      }
    }
    return balance;
  }

  async add(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/transactions`);
    const now = Date.now();
    await addDoc(ref, { ...tx, createdAt: now, updatedAt: now });
  }

  async update(id: string, patch: Partial<Transaction>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/transactions/${id}`), {
      ...patch,
      updatedAt: Date.now()
    });
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/transactions/${id}`));
  }
}
```

### 4.5 Update Firestore security rules

Firebase console → Firestore → Rules. Replace everything:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{userId}/{collection}/{docId} {
      allow read, write: if request.auth != null
                         && request.auth.uid == userId
                         && collection in ['accounts', 'categories', 'transactions', 'bills', 'budgets'];
    }
  }
}
```

Click **Publish**.

---

## Step 5 — Seed service: auto-create default accounts & categories on first sign-in (20 min)

Most users don't want to start from zero. Let's pre-create sensible defaults.

Create `src/app/services/seed.service.ts`:

```typescript
import { Injectable, inject } from '@angular/core';
import { AccountService } from './account.service';
import { CategoryService } from './category.service';

@Injectable({ providedIn: 'root' })
export class SeedService {
  private accounts = inject(AccountService);
  private categories = inject(CategoryService);

  async seedIfEmpty() {
    // Only seed if the user has NO accounts and NO categories yet
    if (this.accounts.accounts().length === 0) {
      await this.accounts.add({
        name: 'Cash', type: 'cash', openingBalance: 0,
        currency: 'USD', icon: '💵', color: '#10b981'
      });
      await this.accounts.add({
        name: 'Checking', type: 'checking', openingBalance: 0,
        currency: 'USD', icon: '🏦', color: '#3b82f6'
      });
      await this.accounts.add({
        name: 'Credit Card', type: 'credit', openingBalance: 0,
        currency: 'USD', icon: '💳', color: '#8b5cf6'
      });
    }

    if (this.categories.categories().length === 0) {
      const expenseCats = [
        { name: 'Groceries', icon: '🛒', color: '#10b981' },
        { name: 'Gas', icon: '⛽', color: '#f59e0b' },
        { name: 'Dining', icon: '🍽️', color: '#ef4444' },
        { name: 'Parking', icon: '🅿️', color: '#6b7280' },
        { name: 'RideShare', icon: '🚗', color: '#3b82f6' },
        { name: 'Car', icon: '🔧', color: '#8b5cf6' },
        { name: 'Shopping', icon: '🛍️', color: '#ec4899' },
        { name: 'Entertainment', icon: '🎬', color: '#f97316' },
        { name: 'Rent', icon: '🏠', color: '#6366f1' },
        { name: 'Utilities', icon: '💡', color: '#eab308' },
        { name: 'Health', icon: '💊', color: '#14b8a6' },
        { name: 'Subscriptions', icon: '📺', color: '#a855f7' },
        { name: 'Other', icon: '📦', color: '#9ca3af' },
      ];
      for (const c of expenseCats) {
        await this.categories.add({ ...c, kind: 'expense' });
      }

      const incomeCats = [
        { name: 'Salary', icon: '💼', color: '#10b981' },
        { name: 'Bonus', icon: '🎁', color: '#22c55e' },
        { name: 'Interest', icon: '📈', color: '#06b6d4' },
        { name: 'Other Income', icon: '💰', color: '#84cc16' },
      ];
      for (const c of incomeCats) {
        await this.categories.add({ ...c, kind: 'income' });
      }
    }
  }
}
```

---

## Step 6 — Build the design system (SCSS variables) (15 min)

Open `src/styles.scss`. Replace ENTIRE content:

```scss
/* ============================================
   GLASSMORPHIC DESIGN TOKENS
   ============================================ */

:root {
  /* Brand gradient — the signature look */
  --bg-gradient: linear-gradient(135deg, #667eea 0%, #764ba2 50%, #f093fb 100%);
  --bg-gradient-dark: linear-gradient(135deg, #1e1b4b 0%, #312e81 50%, #581c87 100%);

  /* Glass surfaces */
  --glass-bg: rgba(255, 255, 255, 0.7);
  --glass-bg-strong: rgba(255, 255, 255, 0.85);
  --glass-border: rgba(255, 255, 255, 0.3);
  --glass-shadow: 0 8px 32px rgba(31, 38, 135, 0.15);
  --glass-blur: blur(20px) saturate(180%);

  /* Text */
  --text-primary: #1a1a2e;
  --text-secondary: #4a4a6a;
  --text-muted: #8b8ba7;
  --text-inverse: #ffffff;

  /* Semantic colors */
  --color-income: #10b981;
  --color-expense: #ef4444;
  --color-transfer: #3b82f6;
  --color-warning: #f59e0b;
  --color-success: #22c55e;

  /* Accent */
  --accent: #6366f1;
  --accent-hover: #4f46e5;

  /* Layout */
  --sidebar-width: 240px;
  --header-height: 64px;
  --radius: 16px;
  --radius-sm: 10px;
  --radius-lg: 24px;

  /* Shadows */
  --shadow-sm: 0 2px 8px rgba(31, 38, 135, 0.08);
  --shadow-md: 0 8px 24px rgba(31, 38, 135, 0.12);
  --shadow-lg: 0 16px 48px rgba(31, 38, 135, 0.16);

  /* Transitions */
  --t-fast: 0.15s ease;
  --t-base: 0.25s ease;
}

/* Dark mode */
@media (prefers-color-scheme: dark) {
  :root {
    --glass-bg: rgba(30, 27, 75, 0.5);
    --glass-bg-strong: rgba(30, 27, 75, 0.75);
    --glass-border: rgba(255, 255, 255, 0.1);
    --text-primary: #f1f5f9;
    --text-secondary: #cbd5e1;
    --text-muted: #94a3b8;
  }
}

/* ============================================
   BASE STYLES
   ============================================ */

* { box-sizing: border-box; }

html, body {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Inter', sans-serif;
  color: var(--text-primary);
  background: var(--bg-gradient);
  background-attachment: fixed;
  -webkit-font-smoothing: antialiased;
}

@media (prefers-color-scheme: dark) {
  html, body { background: var(--bg-gradient-dark); }
}

/* Ambient blur blobs for depth */
body::before {
  content: '';
  position: fixed;
  top: -10%;
  right: -10%;
  width: 500px;
  height: 500px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(255, 193, 7, 0.3), transparent 70%);
  filter: blur(80px);
  pointer-events: none;
  z-index: 0;
}

body::after {
  content: '';
  position: fixed;
  bottom: -10%;
  left: -10%;
  width: 600px;
  height: 600px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(6, 182, 212, 0.25), transparent 70%);
  filter: blur(80px);
  pointer-events: none;
  z-index: 0;
}

h1, h2, h3, h4 {
  margin: 0;
  font-weight: 600;
  letter-spacing: -0.02em;
}

button {
  font-family: inherit;
  cursor: pointer;
  transition: all var(--t-fast);
  &:disabled { cursor: not-allowed; opacity: 0.6; }
}

input, select, textarea {
  font-family: inherit;
  font-size: 14px;
}

/* ============================================
   REUSABLE CLASSES
   ============================================ */

.glass {
  background: var(--glass-bg);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  box-shadow: var(--glass-shadow);
}

.glass-strong {
  background: var(--glass-bg-strong);
  backdrop-filter: var(--glass-blur);
  -webkit-backdrop-filter: var(--glass-blur);
  border: 1px solid var(--glass-border);
  border-radius: var(--radius);
  box-shadow: var(--glass-shadow);
}

.btn {
  padding: 10px 18px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg-strong);
  backdrop-filter: blur(10px);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  font-size: 14px;
  font-weight: 500;

  &:hover { transform: translateY(-1px); box-shadow: var(--shadow-md); }

  &.primary {
    background: var(--accent);
    color: white;
    border-color: transparent;
    &:hover { background: var(--accent-hover); }
  }

  &.ghost {
    background: transparent;
    border: 1px solid transparent;
    &:hover { background: var(--glass-bg); }
  }
}

.input {
  padding: 10px 14px;
  border: 1px solid var(--glass-border);
  background: var(--glass-bg);
  backdrop-filter: blur(10px);
  border-radius: var(--radius-sm);
  color: var(--text-primary);
  transition: all var(--t-fast);
  width: 100%;

  &:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px rgba(99, 102, 241, 0.15);
  }
}
```

---

## Step 7 — Add routing and build the shell (40 min)

### 7.1 Set up routes

Open `src/app/app.routes.ts`. Replace ENTIRE content:

```typescript
import { Routes } from '@angular/router';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard)
  },
  {
    path: 'accounts',
    loadComponent: () => import('./pages/accounts/accounts').then(m => m.Accounts)
  },
  {
    path: 'transactions',
    loadComponent: () => import('./pages/transactions/transactions').then(m => m.Transactions)
  },
  {
    path: 'bills',
    loadComponent: () => import('./pages/bills/bills').then(m => m.Bills)
  },
  {
    path: 'budgets',
    loadComponent: () => import('./pages/budgets/budgets').then(m => m.Budgets)
  },
  {
    path: 'analysis',
    loadComponent: () => import('./pages/analysis/analysis').then(m => m.Analysis)
  },
  { path: '**', redirectTo: 'dashboard' }
];
```

### 7.2 Create all page component shells

For Part 3, each page is a placeholder. We'll fill them in one-by-one in later parts.

In VSCode terminal:

```powershell
ng generate component pages/dashboard --skip-tests
ng generate component pages/accounts --skip-tests
ng generate component pages/transactions --skip-tests
ng generate component pages/bills --skip-tests
ng generate component pages/budgets --skip-tests
ng generate component pages/analysis --skip-tests
```

This creates 6 folders under `src/app/pages/` each with `.ts`, `.html`, `.scss` files.

**For each page's `.ts` file**, make sure the class is exported without the "Component" suffix. Open each (e.g. `src/app/pages/dashboard/dashboard.ts`) and confirm:

```typescript
import { Component } from '@angular/core';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard {}
```

If the class name is `DashboardComponent`, change it to `Dashboard` (to match the route imports). Do this for all 6 pages.

**For each page's `.html`**, put a simple placeholder so you can verify navigation works:

`dashboard.html`:
```html
<div class="page">
  <h1>Dashboard</h1>
  <p class="hint">Overview coming in Part 4.</p>
</div>
```

`accounts.html`:
```html
<div class="page">
  <h1>Accounts</h1>
  <p class="hint">Accounts coming in Part 4.</p>
</div>
```

`transactions.html`:
```html
<div class="page">
  <h1>Transactions</h1>
  <p class="hint">Coming in Part 5.</p>
</div>
```

`bills.html`:
```html
<div class="page">
  <h1>Bills & Subscriptions</h1>
  <p class="hint">Coming in Part 6.</p>
</div>
```

`budgets.html`:
```html
<div class="page">
  <h1>Budgets</h1>
  <p class="hint">Coming in Part 7.</p>
</div>
```

`analysis.html`:
```html
<div class="page">
  <h1>Spending Analysis</h1>
  <p class="hint">Coming in Part 8.</p>
</div>
```

### 7.3 Shared page styles

Create `src/app/pages/_page.scss` (shared patterns):

```scss
/* Import this into each page's scss if you want */
.page {
  padding: 32px;
  max-width: 1400px;
  margin: 0 auto;

  h1 {
    font-size: 28px;
    margin-bottom: 8px;
  }

  .hint {
    color: var(--text-muted);
    font-size: 14px;
  }
}

@media (max-width: 768px) {
  .page { padding: 20px 16px; }
}
```

Paste this into EACH page's `.scss` file (dashboard.scss, accounts.scss, etc.) for now — we'll replace as we build each page.

---

## Step 8 — Build the app shell (sidebar + main area) (30 min)

This is the big one. The `App` component (the root) becomes the shell that renders the sidebar + the active page via `<router-outlet>`.

### 8.1 Update `app.ts`

Open `src/app/app.ts`. Replace ENTIRE content:

```typescript
import { Component, inject, signal, effect } from '@angular/core';
import { RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/auth.service';
import { SeedService } from './services/seed.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  auth = inject(AuthService);
  seed = inject(SeedService);

  sidebarOpen = signal(true);

  nav = [
    { path: '/dashboard',    label: 'Dashboard',    icon: '📊' },
    { path: '/accounts',     label: 'Accounts',     icon: '🏦' },
    { path: '/transactions', label: 'Transactions', icon: '💸' },
    { path: '/bills',        label: 'Bills',        icon: '📄' },
    { path: '/budgets',      label: 'Budgets',      icon: '🎯' },
    { path: '/analysis',     label: 'Analysis',     icon: '📈' },
  ];

  constructor() {
    // Seed defaults on first sign-in
    effect(async () => {
      if (this.auth.user()) {
        // small delay so services subscribe first
        setTimeout(() => this.seed.seedIfEmpty(), 500);
      }
    });
  }

  async signIn() {
    try { await this.auth.signInWithGoogle(); }
    catch (err) { alert('Sign in failed: ' + (err as Error).message); }
  }

  signOut() { this.auth.signOut(); }

  toggleSidebar() { this.sidebarOpen.update(v => !v); }
}
```

### 8.2 Update `app.html`

Open `src/app/app.html`. Replace ENTIRE content:

```html
@if (!auth.user()) {
  <!-- LOGIN SCREEN -->
  <div class="login-shell">
    <div class="login-card glass-strong">
      <div class="logo">💰</div>
      <h1>Expense Tracker</h1>
      <p class="subtitle">Your personal finance, reimagined</p>
      <button class="btn primary google-btn" (click)="signIn()">
        <span class="g-icon">G</span>
        Continue with Google
      </button>
    </div>
  </div>
} @else {
  <!-- APP SHELL -->
  <div class="shell" [class.sidebar-collapsed]="!sidebarOpen()">

    <!-- SIDEBAR -->
    <aside class="sidebar glass">
      <div class="brand">
        <span class="brand-icon">💰</span>
        <span class="brand-name">Expense Tracker</span>
      </div>

      <nav class="nav">
        @for (item of nav; track item.path) {
          <a [routerLink]="item.path" routerLinkActive="active" class="nav-item">
            <span class="nav-icon">{{ item.icon }}</span>
            <span class="nav-label">{{ item.label }}</span>
          </a>
        }
      </nav>

      <div class="user-box">
        <div class="avatar">{{ (auth.user()?.displayName || auth.user()?.email || '?')[0].toUpperCase() }}</div>
        <div class="user-info">
          <div class="user-name">{{ auth.user()?.displayName || 'User' }}</div>
          <div class="user-email">{{ auth.user()?.email }}</div>
        </div>
        <button class="signout" (click)="signOut()" title="Sign out">⏻</button>
      </div>
    </aside>

    <!-- TOP BAR (mobile) -->
    <header class="topbar glass">
      <button class="menu-btn" (click)="toggleSidebar()">☰</button>
      <span class="brand-name">Expense Tracker</span>
    </header>

    <!-- MAIN CONTENT -->
    <main class="main">
      <router-outlet />
    </main>
  </div>
}
```

### 8.3 Update `app.scss`

Open `src/app/app.scss`. Replace ENTIRE content:

```scss
/* ============================================
   LOGIN SCREEN
   ============================================ */
.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  position: relative;
  z-index: 1;
}

.login-card {
  padding: 48px 40px;
  text-align: center;
  max-width: 400px;
  width: 100%;

  .logo {
    font-size: 64px;
    margin-bottom: 16px;
  }

  h1 {
    font-size: 28px;
    margin-bottom: 8px;
    background: var(--bg-gradient);
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
    background-clip: text;
  }

  .subtitle {
    color: var(--text-muted);
    margin-bottom: 32px;
    font-size: 14px;
  }
}

.google-btn {
  width: 100%;
  padding: 14px 24px;
  font-size: 15px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12px;

  .g-icon {
    font-weight: bold;
    background: white;
    color: var(--accent);
    width: 24px;
    height: 24px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    font-size: 14px;
  }
}

/* ============================================
   APP SHELL
   ============================================ */
.shell {
  display: grid;
  grid-template-columns: var(--sidebar-width) 1fr;
  min-height: 100vh;
  position: relative;
  z-index: 1;

  &.sidebar-collapsed {
    grid-template-columns: 0 1fr;

    .sidebar {
      transform: translateX(-100%);
    }
  }
}

/* ============================================
   SIDEBAR
   ============================================ */
.sidebar {
  padding: 20px 16px;
  display: flex;
  flex-direction: column;
  border-radius: 0;
  border-left: none;
  border-top: none;
  border-bottom: none;
  transition: transform var(--t-base);
  position: sticky;
  top: 0;
  height: 100vh;
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 24px;

  .brand-icon { font-size: 24px; }
  .brand-name {
    font-weight: 700;
    font-size: 15px;
    letter-spacing: -0.01em;
  }
}

.nav {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.nav-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--radius-sm);
  text-decoration: none;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
  transition: all var(--t-fast);

  &:hover {
    background: var(--glass-bg-strong);
    color: var(--text-primary);
  }

  &.active {
    background: var(--accent);
    color: white;
    box-shadow: var(--shadow-md);
  }

  .nav-icon { font-size: 18px; }
}

.user-box {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 12px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg-strong);
  margin-top: 16px;

  .avatar {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--accent);
    color: white;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: 600;
    flex-shrink: 0;
  }

  .user-info {
    flex: 1;
    min-width: 0;

    .user-name {
      font-size: 13px;
      font-weight: 600;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .user-email {
      font-size: 11px;
      color: var(--text-muted);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .signout {
    background: transparent;
    border: none;
    color: var(--text-muted);
    font-size: 16px;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;

    &:hover {
      background: var(--color-expense);
      color: white;
    }
  }
}

/* ============================================
   TOP BAR (mobile only)
   ============================================ */
.topbar {
  display: none;
  padding: 12px 16px;
  align-items: center;
  gap: 12px;
  position: sticky;
  top: 0;
  z-index: 10;
  border-radius: 0;

  .menu-btn {
    background: transparent;
    border: none;
    font-size: 22px;
    padding: 4px 8px;
  }

  .brand-name {
    font-weight: 700;
  }
}

/* ============================================
   MAIN CONTENT AREA
   ============================================ */
.main {
  min-height: 100vh;
  overflow-x: hidden;
}

/* ============================================
   RESPONSIVE
   ============================================ */
@media (max-width: 768px) {
  .shell {
    grid-template-columns: 0 1fr;

    .sidebar {
      position: fixed;
      top: 0;
      left: 0;
      width: 80%;
      max-width: 300px;
      z-index: 20;
      transform: translateX(-100%);
    }

    &:not(.sidebar-collapsed) .sidebar {
      transform: translateX(0);
    }
  }

  .topbar { display: flex; }
}

@media (min-width: 769px) {
  .sidebar-collapsed .sidebar {
    transform: translateX(-100%);
  }
}
```

---

## Step 9 — Migrate your existing expense data (15 min)

You have existing expenses in the old `expenses` collection. Let's migrate them into the new `transactions` collection so they still show up.

### 9.1 Create a migration service

Create `src/app/services/migration.service.ts`:

```typescript
import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, getDocs, addDoc, deleteDoc, doc
} from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { CategoryService } from './category.service';

@Injectable({ providedIn: 'root' })
export class MigrationService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private accounts = inject(AccountService);
  private categories = inject(CategoryService);
  private injector = inject(EnvironmentInjector);

  async migrateOldExpenses(): Promise<{ migrated: number; skipped: number }> {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');

    return runInInjectionContext(this.injector, async () => {
      const oldRef = collection(this.db, `users/${user.uid}/expenses`);
      const snap = await getDocs(oldRef);

      if (snap.empty) return { migrated: 0, skipped: 0 };

      // Need a default account to assign transactions to
      const cashAccount = this.accounts.accounts().find(a => a.name === 'Cash');
      if (!cashAccount?.id) throw new Error('Default accounts not seeded yet — sign out and back in.');

      const allCategories = this.categories.categories();
      const newRef = collection(this.db, `users/${user.uid}/transactions`);
      let migrated = 0;

      for (const oldDoc of snap.docs) {
        const data = oldDoc.data() as any;
        const matchedCat = allCategories.find(
          c => c.name.toLowerCase() === (data.category || '').toLowerCase() && c.kind === 'expense'
        );

        await addDoc(newRef, {
          type: 'expense',
          amount: data.amount,
          date: data.date,
          merchant: data.merchant,
          accountId: cashAccount.id,
          categoryId: matchedCat?.id || null,
          notes: data.notes || null,
          createdAt: data.createdAt || Date.now(),
          updatedAt: Date.now(),
        });

        await deleteDoc(doc(this.db, `users/${user.uid}/expenses/${oldDoc.id}`));
        migrated++;
      }

      return { migrated, skipped: 0 };
    });
  }
}
```

### 9.2 Add a one-time migration button

We'll add this to the Dashboard page as a temporary helper. Open `src/app/pages/dashboard/dashboard.ts`:

```typescript
import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MigrationService } from '../../services/migration.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss'
})
export class Dashboard {
  private migration = inject(MigrationService);

  migrating = signal(false);
  migrationResult = signal<string | null>(null);

  async runMigration() {
    this.migrating.set(true);
    try {
      const res = await this.migration.migrateOldExpenses();
      this.migrationResult.set(`✅ Migrated ${res.migrated} expense(s) to transactions.`);
    } catch (err) {
      this.migrationResult.set('❌ ' + (err as Error).message);
    } finally {
      this.migrating.set(false);
    }
  }
}
```

Update `dashboard.html`:

```html
<div class="page">
  <h1>Dashboard</h1>
  <p class="hint">Full dashboard coming in Part 4. For now, a one-time helper:</p>

  <div class="migration-card glass" style="padding: 24px; margin-top: 24px; max-width: 500px;">
    <h3 style="margin-bottom: 8px;">Migrate old expenses</h3>
    <p style="color: var(--text-muted); font-size: 13px; margin-bottom: 16px;">
      Click once to move data from the old <code>expenses</code> collection into the new unified <code>transactions</code> collection. Safe to run even if you have no old data.
    </p>
    <button class="btn primary" (click)="runMigration()" [disabled]="migrating()">
      @if (migrating()) { Migrating... } @else { Run migration }
    </button>
    @if (migrationResult()) {
      <p style="margin-top: 16px; font-size: 14px;">{{ migrationResult() }}</p>
    }
  </div>
</div>
```

---

## Step 10 — Test everything! (15 min)

Save all files. Start `ng serve`:

```powershell
ng serve
```

Go to http://localhost:4200. You should see:

### What to check

1. ✅ **Glassmorphic login card** with gradient background, "Continue with Google" button
2. ✅ Sign in → lands on `/dashboard` with sidebar showing 6 nav items + your avatar + sign out
3. ✅ Click through each nav item → URL changes, page title changes, sidebar highlights active item
4. ✅ Click "Run migration" on Dashboard → if you had old expenses, see "Migrated N expense(s)"
5. ✅ Firebase console → Firestore → you should see 3 new collections: `accounts`, `categories`, `transactions`, each with seed data

### If something breaks

- **"Cannot read property 'id' of undefined" on migration** → Seed hasn't run yet. Sign out, sign back in, wait 2 seconds, try migration.
- **Sidebar doesn't appear** → You're probably not signed in; check top right of page.
- **"Component name mismatch" in route import** → Open the page's `.ts` and make sure class is `Dashboard` not `DashboardComponent` (etc).
- **Blank page** → Open DevTools console (F12) and paste the error.

---

## What you just built

- ✅ Full app shell with sidebar navigation
- ✅ Glassmorphic design system ready to apply everywhere
- ✅ Unified transactions data model
- ✅ Account, Category, Transaction, Bill, Budget services
- ✅ Auto-seeded default accounts and categories
- ✅ Migrated old expense data to the new model
- ✅ 6 route destinations ready for their real content

---

## What's next

**Part 4: The Accounts Page** — the first real feature. Add/edit/delete accounts, running balances computed from transactions, account cards with gradient colors.

Reply when Part 3 works and I'll ship Part 4.
