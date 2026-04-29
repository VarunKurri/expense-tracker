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
    path: 'accounts/:id',
    loadComponent: () => import('./pages/accounts/account-detail/account-detail').then(m => m.AccountDetail)
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
  {
  path: 'import',
    loadComponent: () => import('./pages/import/import').then(m => m.Import)
  },
  { path: '**', redirectTo: 'dashboard' }
];
