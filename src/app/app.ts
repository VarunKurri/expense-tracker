import { Component, inject, signal, computed, effect } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/auth.service';
import { SeedService } from './services/seed.service';
import { ThemeService } from './services/theme.service';
import { ToastService } from './services/toast.service';
import { Icon } from './components/icon/icon';
import { Toast } from './components/toast/toast';
import { QuickAddService } from './services/quick-add.service';
import { BillService } from './services/bill.service';

interface NavItem {
  path: string;
  label: string;
  iconName: string;
  badge?: number | null;
}

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, Icon, Toast],
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

  sidebarOpen = signal(false);
  signingIn = signal(false);

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
    effect(async () => {
      if (this.auth.user()) {
        setTimeout(() => this.seed.seedIfEmpty(), 500);
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

  signOut() { this.auth.signOut(); }
  toggleSidebar() { this.sidebarOpen.update(v => !v); }
}