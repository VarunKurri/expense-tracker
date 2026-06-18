import { Component, inject, signal, computed, effect, untracked } from '@angular/core';
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

  nav = computed((): NavItem[] => [
    { path: '/dashboard',    label: 'Home',         iconName: 'home' },
    { path: '/accounts',     label: 'Accounts',     iconName: 'accounts' },
    { path: '/transactions', label: 'Transactions', iconName: 'tx' },
    { path: '/bills',        label: 'Bills',        iconName: 'bills',
      badge: (this.billService.overdueBills().length + this.billService.upcomingBills(7).length) || null },
    { path: '/budgets',      label: 'Budgets',      iconName: 'budgets' },
    { path: '/analysis',     label: 'Analysis',     iconName: 'analysis' },
  ]);

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

  quickAdd() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() => {
        setTimeout(() => this.quickAddService.trigger(), 150);
      });
    } else {
      this.quickAddService.trigger();
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
