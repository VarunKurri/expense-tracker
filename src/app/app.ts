import { Component, inject, signal, computed } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CommonModule } from '@angular/common';
import { AuthService } from './services/auth.service';
import { ExpenseService } from './services/expense.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  auth = inject(AuthService);
  expenseService = inject(ExpenseService);

  // Plain properties work better with ngModel
  merchant = '';
  amount: number = 0;
  date = new Date().toISOString().slice(0, 10);
  category = 'Other';

  categories = ['Gas', 'Groceries', 'Dining', 'Parking', 'RideShare', 'Car', 'Shopping', 'Other'];

  async signIn() {
    try {
      await this.auth.signInWithGoogle();
    } catch (err) {
      alert('Sign in failed: ' + (err as Error).message);
    }
  }

  signOut() { this.auth.signOut(); }

  async addExpense() {
    if (!this.merchant || !this.amount) {
      alert('Merchant and amount are required');
      return;
    }
    await this.expenseService.add({
      merchant: this.merchant,
      amount: Number(this.amount),
      date: this.date,
      category: this.category,
    });
    this.merchant = '';
    this.amount = 0;
  }

  async remove(id: string) {
    if (confirm('Delete this expense?')) {
      await this.expenseService.remove(id);
    }
  }

  totalThisMonth(): number {
    const thisMonth = new Date().toISOString().slice(0, 7);
    return this.expenseService.expenses()
      .filter(e => e.date.startsWith(thisMonth))
      .reduce((sum, e) => sum + e.amount, 0);
  }
}