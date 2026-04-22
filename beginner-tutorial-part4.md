# Expense Tracker — Tutorial Part 4: The Accounts Page

**Goal:** Build the full Accounts page with glassmorphic account cards, add/edit/delete, and live-updating running balances computed from transactions.
**Time:** ~2 hours
**Prerequisite:** Part 3 complete, sidebar navigation working, default accounts seeded.

> 💡 **What "done" looks like:** A page with colorful glassmorphic cards for each account (Cash, Checking, Credit Card, and any others you add). Each card shows running balance computed in real-time from your transactions. "Add account" modal. Click any card to edit or delete.

---

## What you'll build

1. Reusable **Modal** component (we'll need it in every page going forward)
2. Reusable **Confirm dialog** for delete actions
3. **Account Form** component (add/edit)
4. **Account Card** component (glassy, with running balance)
5. **Accounts page** showing a grid of cards + totals summary
6. Smart helpers: format currency, color-by-account-type, computed totals (assets, liabilities, net worth)

---

## Step 1 — Shared UI primitives (20 min)

Every modal, form, and table in the app needs consistent look + behavior. Build these once.

### 1.1 Modal component

Create a new folder `src/app/components`, then `src/app/components/modal` (use VSCode: right-click components → New Folder → modal).

Inside, create `modal.ts`:

```typescript
import { Component, EventEmitter, Input, Output, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-modal',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './modal.html',
  styleUrl: './modal.scss'
})
export class Modal {
  @Input() open = false;
  @Input() title = '';
  @Input() size: 'sm' | 'md' | 'lg' = 'md';
  @Output() closed = new EventEmitter<void>();

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.open) this.close();
  }

  close() {
    this.closed.emit();
  }

  onBackdropClick(e: MouseEvent) {
    if ((e.target as HTMLElement).classList.contains('backdrop')) {
      this.close();
    }
  }
}
```

Create `modal.html`:

```html
@if (open) {
  <div class="backdrop" (click)="onBackdropClick($event)">
    <div class="modal glass-strong" [class.sm]="size === 'sm'" [class.lg]="size === 'lg'">
      <header class="modal-header">
        <h2>{{ title }}</h2>
        <button class="close-btn" (click)="close()" aria-label="Close">✕</button>
      </header>
      <div class="modal-body">
        <ng-content />
      </div>
    </div>
  </div>
}
```

Create `modal.scss`:

```scss
.backdrop {
  position: fixed;
  inset: 0;
  background: rgba(15, 23, 42, 0.4);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 24px;
  z-index: 100;
  animation: fadeIn 0.2s ease;
}

.modal {
  width: 100%;
  max-width: 520px;
  max-height: 90vh;
  display: flex;
  flex-direction: column;
  animation: slideUp 0.25s ease;

  &.sm { max-width: 380px; }
  &.lg { max-width: 800px; }
}

.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 20px 24px;
  border-bottom: 1px solid var(--glass-border);

  h2 {
    font-size: 18px;
    font-weight: 600;
  }
}

.close-btn {
  background: transparent;
  border: none;
  font-size: 18px;
  width: 32px;
  height: 32px;
  border-radius: 50%;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  justify-content: center;

  &:hover {
    background: var(--glass-bg);
    color: var(--text-primary);
  }
}

.modal-body {
  padding: 24px;
  overflow-y: auto;
}

@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes slideUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}
```

### 1.2 Confirm dialog component

Create `src/app/components/confirm/confirm.ts`:

```typescript
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Modal } from '../modal/modal';

@Component({
  selector: 'app-confirm',
  standalone: true,
  imports: [CommonModule, Modal],
  templateUrl: './confirm.html',
  styleUrl: './confirm.scss'
})
export class Confirm {
  @Input() open = false;
  @Input() title = 'Are you sure?';
  @Input() message = '';
  @Input() confirmText = 'Delete';
  @Input() danger = true;
  @Output() confirmed = new EventEmitter<void>();
  @Output() cancelled = new EventEmitter<void>();
}
```

`confirm.html`:

```html
<app-modal [open]="open" [title]="title" size="sm" (closed)="cancelled.emit()">
  <p class="message">{{ message }}</p>
  <div class="actions">
    <button class="btn ghost" (click)="cancelled.emit()">Cancel</button>
    <button class="btn" [class.danger]="danger" (click)="confirmed.emit()">{{ confirmText }}</button>
  </div>
</app-modal>
```

`confirm.scss`:

```scss
.message {
  color: var(--text-secondary);
  font-size: 14px;
  line-height: 1.5;
  margin: 0 0 24px 0;
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.btn.danger {
  background: var(--color-expense);
  color: white;
  border-color: transparent;

  &:hover {
    background: #dc2626;
  }
}
```

### 1.3 Currency formatter utility

Create `src/app/utils/format.ts`:

```typescript
export function formatCurrency(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

export function formatDateShort(date: string | Date): string {
  const d = typeof date === 'string' ? new Date(date + 'T00:00:00') : date;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
```

---

## Step 2 — Account form component (30 min)

This modal form is used both for adding new accounts and editing existing ones.

Create `src/app/pages/accounts/account-form/account-form.ts`:

```typescript
import { Component, EventEmitter, Input, Output, OnChanges, SimpleChanges, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { Account, AccountType } from '../../../models';

@Component({
  selector: 'app-account-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './account-form.html',
  styleUrl: './account-form.scss'
})
export class AccountForm implements OnChanges {
  @Input() open = false;
  @Input() account: Account | null = null; // null = adding, otherwise editing
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Account, 'id' | 'createdAt'>>();

  // form fields
  name = '';
  type: AccountType = 'checking';
  openingBalance = 0;
  institution = '';
  last4 = '';
  icon = '🏦';
  color = '#3b82f6';

  submitting = signal(false);

  accountTypes: { value: AccountType; label: string; defaultIcon: string; defaultColor: string }[] = [
    { value: 'checking',   label: 'Checking',   defaultIcon: '🏦', defaultColor: '#3b82f6' },
    { value: 'savings',    label: 'Savings',    defaultIcon: '💰', defaultColor: '#10b981' },
    { value: 'credit',     label: 'Credit Card', defaultIcon: '💳', defaultColor: '#8b5cf6' },
    { value: 'cash',       label: 'Cash',       defaultIcon: '💵', defaultColor: '#22c55e' },
    { value: 'investment', label: 'Investment', defaultIcon: '📈', defaultColor: '#f59e0b' },
  ];

  iconOptions = ['🏦', '💳', '💰', '💵', '📈', '🏧', '💼', '🪙', '💴', '💶', '💷', '💸'];
  colorOptions = ['#3b82f6', '#10b981', '#8b5cf6', '#22c55e', '#f59e0b', '#ef4444', '#ec4899', '#14b8a6', '#6366f1', '#f97316'];

  ngOnChanges(changes: SimpleChanges) {
    if (changes['account'] || changes['open']) {
      if (this.open) this.loadFromAccount();
    }
  }

  private loadFromAccount() {
    if (this.account) {
      this.name = this.account.name;
      this.type = this.account.type;
      this.openingBalance = this.account.openingBalance;
      this.institution = this.account.institution || '';
      this.last4 = this.account.last4 || '';
      this.icon = this.account.icon || '🏦';
      this.color = this.account.color || '#3b82f6';
    } else {
      this.name = '';
      this.type = 'checking';
      this.openingBalance = 0;
      this.institution = '';
      this.last4 = '';
      this.icon = '🏦';
      this.color = '#3b82f6';
    }
  }

  onTypeChange() {
    const preset = this.accountTypes.find(t => t.value === this.type);
    if (preset && !this.account) {
      // only auto-suggest icon/color when creating new (not editing)
      this.icon = preset.defaultIcon;
      this.color = preset.defaultColor;
    }
  }

  async save() {
    if (!this.name.trim()) {
      alert('Account name is required');
      return;
    }
    this.submitting.set(true);
    try {
      this.saved.emit({
        name: this.name.trim(),
        type: this.type,
        openingBalance: Number(this.openingBalance) || 0,
        currency: 'USD',
        institution: this.institution.trim() || undefined,
        last4: this.last4.trim() || undefined,
        icon: this.icon,
        color: this.color,
        archived: false,
      });
    } finally {
      this.submitting.set(false);
    }
  }
}
```

`account-form.html`:

```html
<app-modal [open]="open" [title]="account ? 'Edit Account' : 'New Account'" (closed)="closed.emit()">
  <form class="form" (ngSubmit)="save()">
    <div class="field">
      <label>Account name</label>
      <input class="input" [(ngModel)]="name" name="name" placeholder="e.g. Chase Debit" required />
    </div>

    <div class="row">
      <div class="field">
        <label>Type</label>
        <select class="input" [(ngModel)]="type" name="type" (ngModelChange)="onTypeChange()">
          @for (t of accountTypes; track t.value) {
            <option [value]="t.value">{{ t.label }}</option>
          }
        </select>
      </div>
      <div class="field">
        <label>Opening balance</label>
        <input class="input" type="number" step="0.01" [(ngModel)]="openingBalance" name="openingBalance" />
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label>Institution (optional)</label>
        <input class="input" [(ngModel)]="institution" name="institution" placeholder="Chase, Apple, etc." />
      </div>
      <div class="field">
        <label>Last 4 digits (optional)</label>
        <input class="input" [(ngModel)]="last4" name="last4" maxlength="4" placeholder="1234" />
      </div>
    </div>

    <div class="field">
      <label>Icon</label>
      <div class="picker">
        @for (opt of iconOptions; track opt) {
          <button type="button" class="icon-opt" [class.active]="icon === opt" (click)="icon = opt">{{ opt }}</button>
        }
      </div>
    </div>

    <div class="field">
      <label>Color</label>
      <div class="picker">
        @for (opt of colorOptions; track opt) {
          <button type="button" class="color-opt" [class.active]="color === opt"
                  [style.background]="opt" (click)="color = opt"></button>
        }
      </div>
    </div>

    <div class="preview">
      <span class="preview-label">Preview:</span>
      <div class="preview-card" [style.background]="'linear-gradient(135deg, ' + color + ', ' + color + 'dd)'">
        <span class="preview-icon">{{ icon }}</span>
        <span class="preview-name">{{ name || 'Account name' }}</span>
      </div>
    </div>

    <div class="actions">
      <button type="button" class="btn ghost" (click)="closed.emit()">Cancel</button>
      <button type="submit" class="btn primary" [disabled]="submitting()">
        {{ submitting() ? 'Saving…' : (account ? 'Save changes' : 'Create account') }}
      </button>
    </div>
  </form>
</app-modal>
```

`account-form.scss`:

```scss
.form {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.field {
  display: flex;
  flex-direction: column;
  gap: 6px;

  label {
    font-size: 12px;
    font-weight: 600;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
}

.row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.picker {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.icon-opt {
  width: 40px;
  height: 40px;
  border-radius: var(--radius-sm);
  background: var(--glass-bg);
  border: 2px solid transparent;
  font-size: 20px;
  display: flex;
  align-items: center;
  justify-content: center;

  &.active {
    border-color: var(--accent);
    background: var(--glass-bg-strong);
  }
}

.color-opt {
  width: 36px;
  height: 36px;
  border-radius: 50%;
  border: 3px solid transparent;
  transition: transform var(--t-fast);

  &.active {
    border-color: var(--text-primary);
    transform: scale(1.1);
  }
}

.preview {
  margin-top: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;

  .preview-label {
    font-size: 12px;
    color: var(--text-muted);
  }

  .preview-card {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 16px 20px;
    border-radius: var(--radius);
    color: white;

    .preview-icon { font-size: 24px; }
    .preview-name { font-weight: 600; }
  }
}

.actions {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 12px;
}

@media (max-width: 500px) {
  .row { grid-template-columns: 1fr; }
}
```

---

## Step 3 — Account card component (20 min)

The gorgeous card on the Accounts page.

Create `src/app/pages/accounts/account-card/account-card.ts`:

```typescript
import { Component, EventEmitter, Input, Output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Account } from '../../../models';
import { formatCurrency } from '../../../utils/format';

@Component({
  selector: 'app-account-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './account-card.html',
  styleUrl: './account-card.scss'
})
export class AccountCard {
  @Input() account!: Account;
  @Input() balance = 0;
  @Output() edit = new EventEmitter<Account>();

  get displayBalance(): string {
    // For credit cards: positive raw balance = credit, negative = debt owed
    // Display with proper sign
    return formatCurrency(this.balance);
  }

  get isDebt(): boolean {
    return this.account.type === 'credit' && this.balance < 0;
  }

  get typeLabel(): string {
    const map: Record<string, string> = {
      checking: 'Checking',
      savings: 'Savings',
      credit: 'Credit Card',
      cash: 'Cash',
      investment: 'Investment'
    };
    return map[this.account.type] || this.account.type;
  }
}
```

`account-card.html`:

```html
<div
  class="card"
  [style.background]="'linear-gradient(135deg, ' + (account.color || '#3b82f6') + ', ' + (account.color || '#3b82f6') + 'aa)'"
  (click)="edit.emit(account)"
>
  <div class="card-top">
    <span class="icon">{{ account.icon || '🏦' }}</span>
    <span class="type">{{ typeLabel }}</span>
  </div>

  <div class="card-middle">
    <div class="name">{{ account.name }}</div>
    @if (account.institution || account.last4) {
      <div class="meta">
        @if (account.institution) { {{ account.institution }} }
        @if (account.last4) { <span class="dot">•</span> •••• {{ account.last4 }} }
      </div>
    }
  </div>

  <div class="card-bottom">
    <div class="balance-label">{{ isDebt ? 'Owed' : 'Balance' }}</div>
    <div class="balance" [class.debt]="isDebt">{{ displayBalance }}</div>
  </div>
</div>
```

`account-card.scss`:

```scss
.card {
  padding: 20px;
  border-radius: var(--radius);
  color: white;
  cursor: pointer;
  min-height: 180px;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  box-shadow: var(--shadow-md);
  transition: all var(--t-base);
  position: relative;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.15);

  &:hover {
    transform: translateY(-4px);
    box-shadow: var(--shadow-lg);
  }

  &::before {
    content: '';
    position: absolute;
    top: -50%;
    right: -20%;
    width: 60%;
    height: 150%;
    background: radial-gradient(circle, rgba(255, 255, 255, 0.2), transparent 70%);
    pointer-events: none;
  }
}

.card-top {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;

  .icon { font-size: 24px; }
  .type {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.85;
    background: rgba(255, 255, 255, 0.2);
    padding: 4px 10px;
    border-radius: 999px;
    backdrop-filter: blur(8px);
  }
}

.card-middle {
  .name {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }
  .meta {
    font-size: 12px;
    opacity: 0.85;
    margin-top: 4px;
    .dot { margin: 0 6px; opacity: 0.6; }
  }
}

.card-bottom {
  .balance-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    opacity: 0.75;
    margin-bottom: 2px;
  }
  .balance {
    font-size: 24px;
    font-weight: 700;
    letter-spacing: -0.02em;

    &.debt::before {
      content: '-';
      margin-right: 2px;
    }

    &.debt {
      // remove the duplicate minus sign from currency format
      &::first-letter { display: none; }
    }
  }
}
```

---

## Step 4 — Summary bar component (15 min)

A top bar showing total assets, total liabilities, net worth.

Create `src/app/pages/accounts/summary-bar/summary-bar.ts`:

```typescript
import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatCurrency } from '../../../utils/format';

@Component({
  selector: 'app-summary-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-bar.html',
  styleUrl: './summary-bar.scss'
})
export class SummaryBar {
  @Input() assets = 0;
  @Input() liabilities = 0; // positive number representing debt

  get netWorth(): number {
    return this.assets - this.liabilities;
  }

  format(val: number): string {
    return formatCurrency(val);
  }
}
```

`summary-bar.html`:

```html
<div class="summary glass-strong">
  <div class="stat">
    <div class="stat-label">Assets</div>
    <div class="stat-value asset">{{ format(assets) }}</div>
  </div>
  <div class="divider"></div>
  <div class="stat">
    <div class="stat-label">Liabilities</div>
    <div class="stat-value liability">{{ format(liabilities) }}</div>
  </div>
  <div class="divider"></div>
  <div class="stat highlight">
    <div class="stat-label">Net Worth</div>
    <div class="stat-value" [class.negative]="netWorth < 0">{{ format(netWorth) }}</div>
  </div>
</div>
```

`summary-bar.scss`:

```scss
.summary {
  display: flex;
  align-items: center;
  padding: 20px 28px;
  gap: 24px;
  margin-bottom: 28px;
}

.stat {
  flex: 1;
  display: flex;
  flex-direction: column;
  gap: 4px;

  .stat-label {
    font-size: 11px;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    font-weight: 600;
  }

  .stat-value {
    font-size: 22px;
    font-weight: 700;
    letter-spacing: -0.02em;

    &.asset { color: var(--color-income); }
    &.liability { color: var(--color-expense); }
    &.negative { color: var(--color-expense); }
  }

  &.highlight .stat-value {
    font-size: 26px;
  }
}

.divider {
  width: 1px;
  align-self: stretch;
  background: var(--glass-border);
}

@media (max-width: 768px) {
  .summary {
    flex-wrap: wrap;
    gap: 16px;
    padding: 16px;

    .stat .stat-value { font-size: 18px; }
    .stat.highlight .stat-value { font-size: 20px; }
    .divider { display: none; }
  }
}
```

---

## Step 5 — The Accounts page (30 min)

Finally, tie it all together.

Open `src/app/pages/accounts/accounts.ts`. Replace ENTIRE content:

```typescript
import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountForm } from './account-form/account-form';
import { AccountCard } from './account-card/account-card';
import { SummaryBar } from './summary-bar/summary-bar';
import { Confirm } from '../../components/confirm/confirm';
import { Account } from '../../models';

@Component({
  selector: 'app-accounts',
  standalone: true,
  imports: [CommonModule, AccountForm, AccountCard, SummaryBar, Confirm],
  templateUrl: './accounts.html',
  styleUrl: './accounts.scss'
})
export class Accounts {
  accounts = inject(AccountService);
  transactions = inject(TransactionService);

  // Modal state
  formOpen = signal(false);
  editingAccount = signal<Account | null>(null);

  // Delete confirmation state
  confirmOpen = signal(false);
  accountToDelete = signal<Account | null>(null);

  // Computed: account list filtered (non-archived)
  activeAccounts = computed(() =>
    this.accounts.accounts().filter(a => !a.archived)
  );

  // Compute the balance of each account including opening balance + transactions
  balanceFor(account: Account): number {
    return (account.openingBalance || 0) + this.transactions.balanceForAccount(account.id!);
  }

  // Totals — assets = positive balances; liabilities = absolute value of negative credit balances
  assets = computed(() => {
    let total = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit') {
        // credit card: only show as asset if balance is positive (rare, e.g. overpayment)
        if (bal > 0) total += bal;
      } else {
        if (bal > 0) total += bal;
      }
    }
    return total;
  });

  liabilities = computed(() => {
    let total = 0;
    for (const a of this.activeAccounts()) {
      const bal = this.balanceFor(a);
      if (a.type === 'credit' && bal < 0) {
        total += Math.abs(bal);
      } else if (bal < 0) {
        total += Math.abs(bal);
      }
    }
    return total;
  });

  openNewForm() {
    this.editingAccount.set(null);
    this.formOpen.set(true);
  }

  openEditForm(account: Account) {
    this.editingAccount.set(account);
    this.formOpen.set(true);
  }

  closeForm() {
    this.formOpen.set(false);
    this.editingAccount.set(null);
  }

  async handleSave(data: Omit<Account, 'id' | 'createdAt'>) {
    const editing = this.editingAccount();
    try {
      if (editing?.id) {
        await this.accounts.update(editing.id, data);
      } else {
        await this.accounts.add(data);
      }
      this.closeForm();
    } catch (err) {
      alert('Failed to save account: ' + (err as Error).message);
    }
  }

  askDelete() {
    const account = this.editingAccount();
    if (!account) return;
    this.accountToDelete.set(account);
    this.formOpen.set(false);
    this.confirmOpen.set(true);
  }

  async confirmDelete() {
    const account = this.accountToDelete();
    if (!account?.id) return;
    try {
      await this.accounts.remove(account.id);
    } catch (err) {
      alert('Failed to delete: ' + (err as Error).message);
    } finally {
      this.confirmOpen.set(false);
      this.accountToDelete.set(null);
      this.editingAccount.set(null);
    }
  }

  cancelDelete() {
    this.confirmOpen.set(false);
    this.accountToDelete.set(null);
  }
}
```

Open `src/app/pages/accounts/accounts.html`. Replace ENTIRE content:

```html
<div class="page">
  <div class="header-row">
    <div>
      <h1>Accounts</h1>
      <p class="hint">Manage all your bank accounts, credit cards, and cash in one place</p>
    </div>
    <button class="btn primary" (click)="openNewForm()">+ New Account</button>
  </div>

  <app-summary-bar [assets]="assets()" [liabilities]="liabilities()" />

  @if (activeAccounts().length === 0) {
    <div class="empty glass">
      <div class="empty-icon">🏦</div>
      <h3>No accounts yet</h3>
      <p>Add your first account to start tracking your finances</p>
      <button class="btn primary" (click)="openNewForm()">+ Add account</button>
    </div>
  } @else {
    <div class="cards-grid">
      @for (account of activeAccounts(); track account.id) {
        <app-account-card
          [account]="account"
          [balance]="balanceFor(account)"
          (edit)="openEditForm($event)" />
      }
    </div>
  }

  <!-- Add/Edit form modal -->
  <app-account-form
    [open]="formOpen()"
    [account]="editingAccount()"
    (closed)="closeForm()"
    (saved)="handleSave($event)" />

  <!-- Inside the form modal we want a Delete button when editing -->
  @if (editingAccount() && formOpen()) {
    <div class="floating-delete">
      <button class="btn danger" (click)="askDelete()">Delete this account</button>
    </div>
  }

  <!-- Delete confirmation -->
  <app-confirm
    [open]="confirmOpen()"
    title="Delete account?"
    [message]="'This will permanently delete &quot;' + (accountToDelete()?.name || '') + '&quot;. Existing transactions tied to this account will still exist but will lose their link. This cannot be undone.'"
    confirmText="Delete account"
    (confirmed)="confirmDelete()"
    (cancelled)="cancelDelete()" />
</div>
```

Open `src/app/pages/accounts/accounts.scss`. Replace ENTIRE content:

```scss
.page {
  padding: 32px;
  max-width: 1400px;
  margin: 0 auto;
}

.header-row {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  margin-bottom: 28px;
  gap: 16px;

  h1 {
    font-size: 28px;
    margin-bottom: 4px;
  }

  .hint {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0;
  }
}

.cards-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
}

.empty {
  padding: 60px 24px;
  text-align: center;

  .empty-icon {
    font-size: 48px;
    margin-bottom: 16px;
    opacity: 0.6;
  }

  h3 {
    font-size: 18px;
    margin-bottom: 8px;
  }

  p {
    color: var(--text-muted);
    font-size: 14px;
    margin: 0 0 20px 0;
  }
}

.btn.danger {
  background: var(--color-expense);
  color: white;
  border-color: transparent;

  &:hover {
    background: #dc2626;
  }
}

.floating-delete {
  position: fixed;
  bottom: 30px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 110;
}

@media (max-width: 768px) {
  .page { padding: 20px 16px; }

  .header-row {
    flex-direction: column;
    align-items: stretch;

    .btn { width: 100%; }
  }

  .cards-grid {
    grid-template-columns: 1fr;
  }
}
```

---

## Step 6 — Run and test (15 min)

Save all files. `ng serve` if it's not running.

### Expected behavior

1. Click **Accounts** in the sidebar → should land on the Accounts page
2. You should see 3 glassy cards: Cash, Checking, Credit Card (from your seed data)
3. The summary bar shows $0.00 assets / $0.00 liabilities / $0.00 net worth (no transactions yet)
4. Click **+ New Account** → modal opens
5. Fill in: name "Apple Card", type "Credit Card", opening balance -250 → save
6. New card appears with your color/icon choice
7. Click the card → same form opens in edit mode with pre-filled values
8. The floating "Delete this account" button appears at the bottom
9. Click Delete → confirm dialog → click Delete again → card removed
10. Press Escape anywhere → open modal closes

### What about the existing Valero Gas transaction?

If you ran the migration, the Valero Gas expense is now a transaction in `transactions/` attached to your `Cash` account. So the **Cash card should show a balance of -$45.20**.

If you still see $0.00 on Cash, the migration didn't run yet. Go to Dashboard and click "Run migration" first.

---

## Troubleshooting

**"No accounts yet" empty state showing even though seeds ran**
→ Check Firestore for `users/{uid}/accounts` → should have 3 docs. If empty, sign out and back in to re-trigger the seed effect.

**Cards look flat, no gradient/shadow**
→ Check `account-card.scss` → the `background` binding in the HTML is inline. Make sure the account has a `color` field (defaults to `#3b82f6`).

**"Cannot read properties of undefined" when opening edit**
→ `editingAccount` might be set but stale. Refresh the page and try again.

**Balance says wrong amount**
→ The `balanceFor` function sums opening balance + all transactions. If you expected a different number, check your transactions in Firestore and verify the `accountId` field matches.

**Modal won't close**
→ Make sure the Modal component is properly imported in the AccountForm and that the `(closed)="..."` is wired up.

---

## Commit

Once everything works:

```powershell
git add .
git commit -m "part 4: accounts page with glassy cards + running balances"
```

---

## What's next

**Part 5: The Transactions Page** — the biggest page in the app. Unified income/expense/transfer list, Notion-style filter bar, add/edit form with the receipt scanner + AI auto-categorization re-integrated from Part 2.

Tell me when Part 4 works and I'll ship Part 5.
