import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { signal } from '@angular/core';
import { App } from './app';
import { AuthService } from './services/auth.service';
import { SeedService } from './services/seed.service';
import { ThemeService } from './services/theme.service';
import { BillService } from './services/bill.service';
import { QuickAddService } from './services/quick-add.service';
import { AutopayService } from './services/autopay.service';
import { EncryptionService } from './services/encryption.service';
import { AccountService } from './services/account.service';
import { CategoryService } from './services/category.service';
import { TransactionService } from './services/transaction.service';
import { BudgetService } from './services/budget.service';

describe('App', () => {
  let fixture: ComponentFixture<App>;
  const authUser = signal<any>(null);
  const unlocked = signal(false);
  const hasProfile = signal<boolean | null>(null);
  const busy = signal(false);
  const encryptionError = signal<string | null>(null);
  const quickAddTrigger = vi.fn();
  const accounts = signal<any[]>([]);
  const categories = signal<any[]>([]);
  const transactions = signal<any[]>([]);
  const bills = signal<any[]>([]);
  const budgets = signal<any[]>([]);

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter([]),
        {
          provide: AuthService,
          useValue: {
            user: authUser,
            signInWithGoogle: vi.fn(),
            signInWithEmail: vi.fn(),
            signUpWithEmail: vi.fn(),
            sendPasswordReset: vi.fn(),
            signOut: vi.fn(),
          },
        },
        { provide: SeedService, useValue: { seedIfEmpty: vi.fn() } },
        { provide: ThemeService, useValue: { theme: signal('light'), toggle: vi.fn() } },
        {
          provide: BillService,
          useValue: {
            overdueBills: vi.fn(() => []),
            upcomingBills: vi.fn(() => []),
            bills,
          },
        },
        { provide: AccountService, useValue: { accounts } },
        { provide: CategoryService, useValue: { categories } },
        { provide: TransactionService, useValue: { transactions } },
        { provide: BudgetService, useValue: { budgets } },
        {
          provide: QuickAddService,
          useValue: {
            trigger: quickAddTrigger,
          },
        },
        { provide: AutopayService, useValue: { runIfNeeded: vi.fn() } },
        {
          provide: EncryptionService,
          useValue: {
            unlocked,
            hasProfile,
            busy,
            error: encryptionError,
            refreshProfileState: vi.fn(() => Promise.resolve()),
            migrateUserData: vi.fn(),
            unlock: vi.fn(),
            lock: vi.fn(),
          },
        },
      ],
    }).compileComponents();

    authUser.set(null);
    unlocked.set(false);
    hasProfile.set(null);
    busy.set(false);
    encryptionError.set(null);
    accounts.set([]);
    categories.set([]);
    transactions.set([]);
    bills.set([]);
    budgets.set([]);
    quickAddTrigger.mockReset();
    fixture = TestBed.createComponent(App);
  });

  it('renders the email sign-in form for signed-out users', () => {
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Welcome back');
    expect(compiled.textContent).toContain('Sign in');
    expect(compiled.querySelector('input[type="email"]')).toBeTruthy();
  });

  it('shows the encryption unlock screen after authentication', () => {
    authUser.set({ email: 'user@example.com' });
    hasProfile.set(true);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Unlock encrypted data');
  });

  it('shows create vault copy for first-time encrypted users', () => {
    authUser.set({ email: 'user@example.com' });
    hasProfile.set(false);
    fixture.detectChanges();
    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Create encryption passphrase');
  });

  it('opens the command palette for unlocked users', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    fixture.detectChanges();

    fixture.componentInstance.openCommandPalette();
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Add expense');
    expect(compiled.textContent).toContain('Go to Transactions');
    expect(compiled.querySelector('.command-input')).toBeTruthy();
  });

  it('shows grouped global search results in the command palette', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    accounts.set([{ id: 'acct-1', name: 'Chase Checking', type: 'checking', currency: 'USD', openingBalance: 0, createdAt: 1 }]);
    categories.set([{ id: 'cat-1', name: 'Subscriptions', kind: 'expense', createdAt: 1 }]);
    transactions.set([{
      id: 'tx-1',
      type: 'expense',
      amount: 19.99,
      date: '2026-06-24',
      merchant: 'ChatGPT',
      accountId: 'acct-1',
      categoryId: 'cat-1',
      createdAt: 1,
      updatedAt: 1,
    }]);
    bills.set([{ id: 'bill-1', name: 'ChatGPT', amount: 19.99, frequency: 'monthly', nextDueDate: '2026-07-24', autopayEnabled: false, active: true, createdAt: 1 }]);
    budgets.set([{ id: 'budget-1', categoryId: 'cat-1', amount: 100, isDefault: true, createdAt: 1 }]);
    fixture.detectChanges();

    fixture.componentInstance.openCommandPalette();
    fixture.componentInstance.onCommandQueryChange('chatgpt');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('Transactions');
    expect(compiled.textContent).toContain('Bills');
    expect(compiled.textContent).toContain('ChatGPT');
  });

  it('offers a full transaction search when palette results are capped', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    transactions.set(Array.from({ length: 8 }, (_, i) => ({
      id: `tx-${i}`,
      type: 'expense',
      amount: 10 + i,
      date: '2026-06-24',
      merchant: 'Safeway',
      notes: `weekly grocery run ${i}`,
      createdAt: i,
      updatedAt: i,
    })));
    fixture.detectChanges();

    fixture.componentInstance.openCommandPalette();
    fixture.componentInstance.onCommandQueryChange('safeway');
    fixture.detectChanges();

    const compiled = fixture.nativeElement as HTMLElement;
    expect(compiled.textContent).toContain('View all 8 matching transactions');
  });

  it('keeps the search query when opening all matching transactions', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    transactions.set(Array.from({ length: 7 }, (_, i) => ({
      id: `tx-${i}`,
      type: 'expense',
      amount: 20 + i,
      date: '2026-06-24',
      merchant: 'Target',
      createdAt: i,
      updatedAt: i,
    })));
    fixture.detectChanges();
    const router = TestBed.inject(Router);
    const navigateSpy = vi.spyOn(router, 'navigate').mockResolvedValue(true);

    fixture.componentInstance.openCommandPalette();
    fixture.componentInstance.onCommandQueryChange('Target');
    const entry = fixture.componentInstance.paletteEntries()
      .find(e => e.id === 'transactions-all-target');
    expect(entry).toBeTruthy();

    fixture.componentInstance.runPaletteEntry(entry!);

    expect(navigateSpy).toHaveBeenCalledWith(['/transactions'], {
      queryParams: { search: 'Target' },
    });
  });

  it('opens quick add with single-key shortcuts for unlocked users', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    fixture.detectChanges();
    const quickAddSpy = vi.spyOn(fixture.componentInstance, 'quickAdd').mockImplementation(() => {});

    fixture.componentInstance.handleGlobalKeydown(new KeyboardEvent('keydown', { key: 'n' }));

    expect(quickAddSpy).toHaveBeenCalledWith('expense');
  });

  it('ignores single-key shortcuts while typing in inputs', () => {
    authUser.set({ email: 'user@example.com' });
    unlocked.set(true);
    hasProfile.set(true);
    fixture.detectChanges();

    const input = document.createElement('input');
    document.body.appendChild(input);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));

    expect(quickAddTrigger).not.toHaveBeenCalled();
    input.remove();
  });

  it('clicks the visible primary action with the save shortcut', () => {
    const button = document.createElement('button');
    button.className = 'btn-primary';
    const wrapper = document.createElement('div');
    wrapper.className = 'modal-actions';
    wrapper.appendChild(button);
    document.body.appendChild(wrapper);
    const clickSpy = vi.spyOn(button, 'click');

    fixture.componentInstance.handleGlobalKeydown(new KeyboardEvent('keydown', { key: 's', metaKey: true }));

    expect(clickSpy).toHaveBeenCalled();
    wrapper.remove();
  });
});
