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
    const commands = this.filteredCommands();
    if (commands.length === 0) return;
    const next = (this.activeCommandIndex() + delta + commands.length) % commands.length;
    this.activeCommandIndex.set(next);
  }

  runActiveCommand() {
    const command = this.filteredCommands()[this.activeCommandIndex()];
    if (!command) return;
    this.runCommand(command);
  }

  runCommand(command: CommandItem) {
    this.closeCommandPalette();
    command.action();
  }

  private navigateTo(path: string) {
    this.router.navigate([path]);
    this.sidebarOpen.set(false);
  }

  @HostListener('window:keydown', ['$event'])
  handleGlobalKeydown(event: KeyboardEvent) {
    const key = event.key.toLowerCase();
    if ((event.metaKey || event.ctrlKey) && key === 'k') {
      event.preventDefault();
      this.commandPaletteOpen() ? this.closeCommandPalette() : this.openCommandPalette();
    } else if (event.key === 'Escape' && this.commandPaletteOpen()) {
      event.preventDefault();
      this.closeCommandPalette();
    }
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
