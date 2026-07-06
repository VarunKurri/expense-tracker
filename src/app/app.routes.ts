import { Routes } from '@angular/router';
import { authGuard } from './guards/auth.guard';

export const routes: Routes = [
  { path: '', redirectTo: 'dashboard', pathMatch: 'full' },
  {
    path: 'dashboard',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/dashboard/dashboard').then(m => m.Dashboard)
  },
  {
    path: 'accounts',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/accounts/accounts').then(m => m.Accounts)
  },
  {
    path: 'accounts/overview/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/accounts/account-overview/account-overview').then(m => m.AccountOverview)
  },
  {
    path: 'accounts/:id',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/accounts/account-detail/account-detail').then(m => m.AccountDetail)
  },
  {
    path: 'transactions',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/transactions/transactions').then(m => m.Transactions)
  },
  {
    path: 'bills',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/bills/bills').then(m => m.Bills)
  },
  {
    path: 'budgets',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/budgets/budgets').then(m => m.Budgets)
  },
  {
    path: 'budgets/:categoryId/:month',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/budgets/budget-detail/budget-detail').then(m => m.BudgetDetail)
  },
  {
    path: 'analysis',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/analysis/analysis').then(m => m.Analysis)
  },
  {
    path: 'import',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/import/import').then(m => m.Import)
  },
  {
    path: 'categories',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/categories/categories').then(m => m.Categories)
  },
  {
    path: 'settings',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/settings/settings').then(m => m.Settings)
  },
  { path: '**', redirectTo: 'dashboard' }
];
