import { Component, HostListener, inject, signal, computed, effect, untracked } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { AuthService } from './services/auth.service';
import { SeedService } from './services/seed.service';
import { ThemeService } from './services/theme.service';
import { ToastService } from './services/toast.service';
import { Icon } from './components/icon/icon';
import { Toast } from './components/toast/toast';
import { QuickAddService } from './services/quick-add.service';
import { BillService } from './services/bill.service';
import { AutopayService } from './services/autopay.service';
import { EncryptionService } from './services/encryption.service';
import { AccountService } from './services/account.service';
import { CategoryService } from './services/category.service';
import { TransactionService } from './services/transaction.service';
import { BudgetService } from './services/budget.service';
import { Account } from './models';

interface NavItem {
  path: string;
  label: string;
  iconName: string;
  badge?: number | null;
}

interface CommandItem {
  id: string;
  label: string;
  hint: string;
  iconName: string;
  keywords: string;
  action: () => void;
}

interface PaletteEntry {
  id: string;
  group: string;
  label: string;
  hint: string;
  iconName: string;
  tone?: 'more';
  action: () => void;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterOutlet, RouterLink, RouterLinkActive, Icon, Toast],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  auth = inject(AuthService);
  seed = inject(SeedService);
  themeService = inject(ThemeService);
  toastService = inject(ToastService);
  private router = inject(Router);
  quickAddService = inject(QuickAddService);
  billService = inject(BillService);
  private autopayService = inject(AutopayService);
  encryption = inject(EncryptionService);
  private accountService = inject(AccountService);
  private categoryService = inject(CategoryService);
  private transactionService = inject(TransactionService);
  private budgetService = inject(BudgetService);

  sidebarOpen = signal(false);
  signingIn = signal(false);
  authMode = signal<'signin' | 'signup' | 'reset'>('signin');
  email = signal('');
  password = signal('');
  displayName = signal('');
  encryptionPassphrase = signal('');
  commandPaletteOpen = signal(false);
  commandQuery = signal('');
  activeCommandIndex = signal(0);

  nav = computed((): NavItem[] => [
    { path: '/dashboard',    label: 'Home',         iconName: 'home' },
    { path: '/accounts',     label: 'Accounts',     iconName: 'accounts' },
    { path: '/transactions', label: 'Transactions', iconName: 'tx' },
    { path: '/bills',        label: 'Bills',        iconName: 'bills',
      badge: (this.billService.overdueBills().length + this.billService.upcomingBills(7).length) || null },
    { path: '/budgets',      label: 'Budgets',      iconName: 'budgets' },
    { path: '/analysis',     label: 'Analysis',     iconName: 'analysis' },
  ]);

  commands = computed((): CommandItem[] => [
    {
      id: 'add-expense',
      label: 'Add expense',
      hint: 'Create a new expense transaction',
      iconName: 'receipt',
      keywords: 'new add quick expense spend transaction merchant',
      action: () => this.quickAdd('expense'),
    },
    {
      id: 'add-income',
      label: 'Add income',
      hint: 'Record paycheck, interest, or other income',
      iconName: 'cash',
      keywords: 'new add quick income paycheck salary transaction',
      action: () => this.quickAdd('income'),
    },
    {
      id: 'add-transfer',
      label: 'Add transfer',
      hint: 'Move money between accounts',
      iconName: 'tx',
      keywords: 'new add quick transfer move transaction account',
      action: () => this.quickAdd('transfer'),
    },
    ...this.nav().map(item => ({
      id: `go-${item.path}`,
      label: `Go to ${item.label}`,
      hint: item.path,
      iconName: item.iconName,
      keywords: `${item.label} ${item.path} navigate open page`,
      action: () => this.navigateTo(item.path),
    })),
    {
      id: 'go-import',
      label: 'Go to Import',
      hint: 'Upload CSV transactions',
      iconName: 'arrowDown',
      keywords: 'import upload csv transactions mint monarch',
      action: () => this.navigateTo('/import'),
    },
    {
      id: 'go-settings',
      label: 'Go to Settings',
      hint: 'Manage app preferences',
      iconName: 'settings',
      keywords: 'settings preferences account profile',
      action: () => this.navigateTo('/settings'),
    },
    {
      id: 'toggle-theme',
      label: `Switch to ${this.themeService.theme() === 'dark' ? 'light' : 'dark'} mode`,
      hint: 'Toggle the app theme',
      iconName: this.themeService.theme() === 'dark' ? 'sun' : 'moon',
      keywords: 'theme dark light mode appearance',
      action: () => this.themeService.toggle(),
    },
  ]);

  filteredCommands = computed(() => {
    const query = this.commandQuery().trim().toLowerCase();
    const commands = this.commands();
    if (!query) return commands;
    return commands.filter(command => {
      const haystack = `${command.label} ${command.hint} ${command.keywords}`.toLowerCase();
      return query.split(/\s+/).every(token => haystack.includes(token));
    });
  });

  paletteEntries = computed((): PaletteEntry[] => {
    const query = this.commandQuery().trim().toLowerCase();
    const entries: PaletteEntry[] = this.filteredCommands()
      .slice(0, query ? 5 : 20)
      .map(command => ({ ...command, group: 'Actions' }));
    if (!query) return entries;
    return [
      ...entries,
      ...this.transactionSearchEntries(query),
      ...this.accountSearchEntries(query),
      ...this.categorySearchEntries(query),
      ...this.billSearchEntries(query),
      ...this.budgetSearchEntries(query),
    ];
  });

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (user) {
        this.encryption.refreshProfileState().catch(err => {
          this.toastService.error(err?.message || 'Could not check encrypted data access.');
        });
      } else {
        this.encryption.lock();
      }
    });

    // Seed default data once encrypted data is unlocked.
    effect(async () => {
      if (this.auth.user()) {
        const unlocked = this.encryption.unlocked();
        if (unlocked) {
          await this.encryption.migrateUserData();
          await this.encryption.repairEnvelopeDocs();
          setTimeout(() => this.seed.seedIfEmpty(), 500);
        }
      }
    });

    // Autopay: fires when both user AND bills signal are populated.
    // Component effects are guaranteed to run; service-constructor effects are not.
    effect(() => {
      const user = this.auth.user();
      const bills = this.billService.bills();
      if (user && this.encryption.unlocked() && bills.length > 0) {
        untracked(() => this.autopayService.runIfNeeded());
      }
    });
  }

  onNavClick() {
    if (window.innerWidth < 769) {
      this.sidebarOpen.set(false);
    }
  }

  quickAdd(type: 'expense' | 'income' | 'transfer' | null = null) {
    this.closeCommandPalette();
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() => {
        setTimeout(() => this.quickAddService.trigger(type), 150);
      });
    } else {
      this.quickAddService.trigger(type);
    }
  }

  openCommandPalette() {
    if (!this.auth.user() || !this.encryption.unlocked()) return;
    this.commandQuery.set('');
    this.activeCommandIndex.set(0);
    this.commandPaletteOpen.set(true);
    setTimeout(() => document.querySelector<HTMLInputElement>('.command-input')?.focus(), 0);
  }

  closeCommandPalette() {
    this.commandPaletteOpen.set(false);
    this.commandQuery.set('');
    this.activeCommandIndex.set(0);
  }

  onCommandQueryChange(value: string) {
    this.commandQuery.set(value);
    this.activeCommandIndex.set(0);
  }

  moveCommandSelection(delta: number) {
    const entries = this.paletteEntries();
    if (entries.length === 0) return;
    const next = (this.activeCommandIndex() + delta + entries.length) % entries.length;
    this.activeCommandIndex.set(next);
    setTimeout(() => this.scrollActiveCommandIntoView(), 0);
  }

  runActiveCommand() {
    const entry = this.paletteEntries()[this.activeCommandIndex()];
    if (!entry) return;
    this.runPaletteEntry(entry);
  }

  runCommand(command: CommandItem) {
    this.closeCommandPalette();
    command.action();
  }

  runPaletteEntry(entry: PaletteEntry) {
    this.closeCommandPalette();
    entry.action();
  }

  showCommandGroup(index: number, group: string): boolean {
    const prev = this.paletteEntries()[index - 1];
    return !prev || prev.group !== group;
  }

  private scrollActiveCommandIntoView() {
    document
      .querySelector<HTMLElement>(`[data-command-index="${this.activeCommandIndex()}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }

  private navigateTo(path: string) {
    this.router.navigate([path]);
    this.sidebarOpen.set(false);
  }

  private navigateToAccount(account: Account) {
    if (!account.id) return;
    this.router.navigate([
      account.type === 'credit' ? '/accounts' : '/accounts/overview',
      account.id,
    ]);
    this.sidebarOpen.set(false);
  }

  private matchesQuery(query: string, ...values: unknown[]): boolean {
    const tokens = query.split(/\s+/).filter(Boolean);
    const haystack = values
      .filter(v => v !== undefined && v !== null)
      .join(' ')
      .toLowerCase();
    return tokens.every(token => haystack.includes(token));
  }

  private formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Math.abs(n));
  }

  private accountName(id?: string): string {
    if (!id) return '';
    return this.accountService.accounts().find(a => a.id === id)?.name || '';
  }

  private categoryName(id?: string): string {
    if (!id) return '';
    return this.categoryService.categories().find(c => c.id === id)?.name || '';
  }

  private transactionSearchEntries(query: string): PaletteEntry[] {
    const matches = this.matchingTransactions(query);
    const searchText = this.commandQuery().trim();
    const entries: PaletteEntry[] = matches.slice(0, 6).map(tx => ({
        id: `transaction-${tx.id}`,
        group: 'Transactions',
        label: tx.merchant || (tx.type === 'transfer' ? 'Transfer' : 'Untitled transaction'),
        hint: `${tx.date} · ${this.formatCurrency(tx.amount)}${this.accountName(tx.accountId || tx.fromAccountId) ? ` · ${this.accountName(tx.accountId || tx.fromAccountId)}` : ''}`,
        iconName: tx.type === 'income' ? 'cash' : tx.type === 'transfer' ? 'tx' : 'receipt',
        action: () => this.router.navigate(['/transactions'], { queryParams: tx.id ? { txId: tx.id } : { search: tx.merchant || tx.notes || tx.date } }),
      }));

    if (matches.length > entries.length) {
      entries.push({
        id: `transactions-all-${query}`,
        group: 'Transactions',
        label: `View all ${matches.length} matching transactions`,
        hint: 'Open the full transactions list with this search',
        iconName: 'search',
        tone: 'more',
        action: () => this.router.navigate(['/transactions'], { queryParams: { search: searchText } }),
      });
    }

    return entries;
  }

  private matchingTransactions(query: string) {
    return this.transactionService.transactions()
      .filter(tx => this.matchesQuery(
        query,
        tx.merchant,
        tx.notes,
        tx.date,
        tx.type,
        tx.amount,
        this.formatCurrency(tx.amount),
        this.accountName(tx.accountId || tx.fromAccountId),
        this.accountName(tx.toAccountId),
        this.categoryName(tx.categoryId)
      ));
  }

  private accountSearchEntries(query: string): PaletteEntry[] {
    return this.accountService.accounts()
      .filter(account => !account.archived && this.matchesQuery(query, account.name, account.type, account.institution, account.last4))
      .slice(0, 6)
      .map(account => ({
        id: `account-${account.id}`,
        group: 'Accounts',
        label: `${account.icon || ''} ${account.name}`.trim(),
        hint: [account.institution, account.type, account.last4 ? `••${account.last4}` : ''].filter(Boolean).join(' · '),
        iconName: 'accounts',
        action: () => this.navigateToAccount(account),
      }));
  }

  private categorySearchEntries(query: string): PaletteEntry[] {
    return this.categoryService.categories()
      .filter(category => !category.archived && this.matchesQuery(query, category.name, category.kind))
      .slice(0, 6)
      .map(category => ({
        id: `category-${category.id}`,
        group: 'Categories',
        label: `${category.icon || ''} ${category.name}`.trim(),
        hint: `${category.kind} category`,
        iconName: category.kind === 'income' ? 'cash' : 'budgets',
        action: () => this.router.navigate(['/transactions'], { queryParams: category.id ? { categoryId: category.id } : { search: category.name } }),
      }));
  }

  private billSearchEntries(query: string): PaletteEntry[] {
    return this.billService.bills()
      .filter(bill => this.matchesQuery(query, bill.name, bill.notes, bill.frequency, bill.active ? 'active' : 'paused', bill.amount, this.formatCurrency(bill.amount), this.accountName(bill.accountId), this.categoryName(bill.categoryId)))
      .slice(0, 6)
      .map(bill => ({
        id: `bill-${bill.id}`,
        group: 'Bills',
        label: `${bill.icon || ''} ${bill.name}`.trim(),
        hint: `${this.formatCurrency(bill.amount)} · next ${bill.nextDueDate}`,
        iconName: 'bills',
        action: () => this.router.navigate(['/bills'], { queryParams: bill.id ? { billId: bill.id } : {} }),
      }));
  }

  private budgetSearchEntries(query: string): PaletteEntry[] {
    const currentMonth = new Date().toISOString().slice(0, 7);
    return this.budgetService.budgets()
      .filter(budget => {
        const category = this.categoryService.categories().find(c => c.id === budget.categoryId);
        return this.matchesQuery(query, category?.name, budget.amount, this.formatCurrency(budget.amount), budget.month, budget.isDefault ? 'default' : 'override');
      })
      .slice(0, 6)
      .map(budget => {
        const category = this.categoryService.categories().find(c => c.id === budget.categoryId);
        const month = budget.month || currentMonth;
        return {
          id: `budget-${budget.id}`,
          group: 'Budgets',
          label: `${category?.icon || ''} ${category?.name || 'Budget'}`.trim(),
          hint: `${this.formatCurrency(budget.amount)} · ${budget.isDefault ? 'default' : month}`,
          iconName: 'budgets',
          action: () => this.router.navigate(['/budgets', budget.categoryId, month]),
        };
      });
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault();
      this.commandPaletteOpen() ? this.closeCommandPalette() : this.openCommandPalette();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && key === 's') {
      event.preventDefault();
      this.clickVisiblePrimaryAction();
      return;
    }

    if (event.key === 'Escape') {
      if (this.commandPaletteOpen()) {
        event.preventDefault();
        this.closeCommandPalette();
      } else if (this.sidebarOpen()) {
        event.preventDefault();
        this.sidebarOpen.set(false);
      }
      return;
    }

    if (!this.auth.user() || !this.encryption.unlocked() || this.isTypingTarget(event.target)) return;

    if (event.key === '/') {
      event.preventDefault();
      this.openCommandPalette();
      return;
    }

    if (event.altKey && !event.metaKey && !event.ctrlKey && !event.shiftKey) {
      const route = this.routeForShortcutCode(event.code);
      if (route) {
        event.preventDefault();
        this.navigateTo(route);
      }
      return;
    }

    if (event.metaKey || event.ctrlKey || event.altKey) return;

    if (key === 'n') {
      event.preventDefault();
      this.quickAdd('expense');
    } else if (key === 'i') {
      event.preventDefault();
      this.quickAdd('income');
    } else if (key === 'm') {
      event.preventDefault();
      this.quickAdd('transfer');
    }
  }

  private isTypingTarget(target: EventTarget | null): boolean {
    const el = target as HTMLElement | null;
    if (!el) return false;
    const tag = el.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
  }

  private routeForShortcutCode(code: string): string | null {
    const routes: Record<string, string> = {
      Digit1: '/dashboard',
      Digit2: '/accounts',
      Digit3: '/transactions',
      Digit4: '/bills',
      Digit5: '/budgets',
      Digit6: '/analysis',
      Digit7: '/import',
      Digit8: '/settings',
    };
    return routes[code] || null;
  }

  private clickVisiblePrimaryAction() {
    const button = document.querySelector<HTMLButtonElement>(
      '.modal-actions .btn-primary:not(:disabled), .actions .btn-primary:not(:disabled)'
    );
    button?.click();
  }

  async signIn() {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    try {
      await this.auth.signInWithGoogle();
      // null return = user cancelled popup, no toast needed
    } catch (err) {
      this.toastService.error('Sign in failed. Please try again.');
    } finally {
      this.signingIn.set(false);
    }
  }

  async signInWithEmail() {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    try {
      await this.auth.signInWithEmail(this.email().trim(), this.password());
    } catch (err: any) {
      this.toastService.error(err?.message || 'Sign in failed. Please try again.');
    } finally {
      this.signingIn.set(false);
    }
  }

  async signUpWithEmail() {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    try {
      await this.auth.signUpWithEmail(
        this.email().trim(),
        this.password(),
        this.displayName().trim()
      );
    } catch (err: any) {
      this.toastService.error(err?.message || 'Sign up failed. Please try again.');
    } finally {
      this.signingIn.set(false);
    }
  }

  async resetPassword() {
    if (!this.email().trim()) {
      this.toastService.error('Enter your email address first.');
      return;
    }
    this.signingIn.set(true);
    try {
      await this.auth.sendPasswordReset(this.email().trim());
      this.toastService.success('Password reset email sent.');
      this.authMode.set('signin');
    } catch (err: any) {
      this.toastService.error(err?.message || 'Could not send reset email.');
    } finally {
      this.signingIn.set(false);
    }
  }

  async unlockData() {
    if (this.signingIn()) return;
    this.signingIn.set(true);
    try {
      await this.encryption.unlock(this.encryptionPassphrase());
      this.encryptionPassphrase.set('');
      this.toastService.success('Encrypted data unlocked.');
    } catch (err: any) {
      this.toastService.error(err?.message || 'Could not unlock encrypted data.');
    } finally {
      this.signingIn.set(false);
    }
  }

  signOut() {
    this.encryption.lock();
    this.auth.signOut();
  }
  toggleSidebar() { this.sidebarOpen.update(v => !v); }
}
