import { Injectable, inject } from '@angular/core';
import { AccountService } from './account.service';
import { CategoryService } from './category.service';

@Injectable({ providedIn: 'root' })
export class SeedService {
  private accounts = inject(AccountService);
  private categories = inject(CategoryService);

  async seedIfEmpty() {
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
