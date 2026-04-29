import { Component, inject, signal, effect } from '@angular/core';
import { Router, RouterOutlet, RouterLink, RouterLinkActive } from '@angular/router';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/auth.service';
import { SeedService } from './services/seed.service';
import { ThemeService } from './services/theme.service';
import { Icon } from './components/icon/icon';
import { QuickAddService } from './services/quick-add.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, RouterOutlet, RouterLink, RouterLinkActive, Icon],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  auth = inject(AuthService);
  seed = inject(SeedService);
  themeService = inject(ThemeService);
  private router = inject(Router);
  quickAddService = inject(QuickAddService);

  sidebarOpen = signal(false);

  nav = [
  { path: '/dashboard',    label: 'Home',         iconName: 'home' },
  { path: '/accounts',     label: 'Accounts',     iconName: 'accounts' },
  { path: '/transactions', label: 'Transactions', iconName: 'tx' },
  { path: '/bills',        label: 'Bills',        iconName: 'bills',   badge: 0 },
  { path: '/budgets',      label: 'Budgets',      iconName: 'budgets' },
  { path: '/analysis',     label: 'Analysis',     iconName: 'analysis' },
  { path: '/import',       label: 'Import',       iconName: 'receipt' },
];

  // Stroke-based SVG paths, 20×20 viewBox
  // readonly navIcons: Record<string, string> = {
  //   dashboard:    'M2 2h7v7H2zm9 0h7v7h-7zM2 11h7v7H2zm9 0h7v7h-7z',
  //   accounts:     'M2 8a2 2 0 012-2h12a2 2 0 012 2v6a2 2 0 01-2 2H4a2 2 0 01-2-2V8zm0 3h16M6 15h4',
  //   transactions: 'M4 8l3-4 3 4M7 4v9M10 12l3 4 3-4M13 16V7',
  //   bills:        'M5 6h10M5 10h10M5 14h6',
  //   budgets:      'M10 2a8 8 0 100 16A8 8 0 0010 2zm0 5a3 3 0 100 6 3 3 0 000-6z',
  //   analysis:     'M2.5 15.5l5-6.5 4 4 5.5-8M15 5h3.5v3.5',
  // };

  constructor() {
    effect(async () => {
      if (this.auth.user()) {
        setTimeout(() => this.seed.seedIfEmpty(), 500);
      }
    });
  }

  onNavClick() {
    // Close sidebar on mobile after navigation
    if (window.innerWidth < 769) {
      this.sidebarOpen.set(false);
    }
  }

  quickAdd() {
    if (!this.router.url.includes('/transactions')) {
      this.router.navigate(['/transactions']).then(() => {
        // Wait for component to initialize before triggering
        setTimeout(() => this.quickAddService.trigger(), 100);
      });
    } else {
      this.quickAddService.trigger();
    }
  }

  async signIn() {
    try { await this.auth.signInWithGoogle(); }
    catch (err) { alert('Sign in failed: ' + (err as Error).message); }
  }

  signOut() { this.auth.signOut(); }

  toggleSidebar() { this.sidebarOpen.update(v => !v); }
}
