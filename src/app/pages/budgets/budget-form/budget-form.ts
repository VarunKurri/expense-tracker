import {
  Component, EventEmitter, Input, Output,
  OnChanges, SimpleChanges, signal, inject, computed
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { CategoryService } from '../../../services/category.service';
import { BudgetService } from '../../../services/budget.service';
import { Budget } from '../../../models';

@Component({
  selector: 'app-budget-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './budget-form.html',
  styleUrl: './budget-form.scss'
})
export class BudgetForm implements OnChanges {
  categories = inject(CategoryService);
  budgetService = inject(BudgetService);

  @Input() open = false;
  @Input() budget: Budget | null = null;
  @Input() preselectedCategoryId = '';
  @Input() preselectedMonth = '';
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<Omit<Budget, 'id' | 'createdAt'>>();
  @Output() deleteRequested = new EventEmitter<void>();

  categoryId = '';
  amount = 0;
  isDefault = true;
  month = '';

  submitting = signal(false);

  expenseCategories = computed(() =>
    this.categories.categories().filter(c => c.kind === 'expense' && !c.archived)
  );

  currentMonth = new Date().toISOString().slice(0, 7);

  months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date();
    d.setMonth(d.getMonth() - 3 + i);
    return {
      value: d.toISOString().slice(0, 7),
      label: d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    };
  });

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) this.load();
  }

  private load() {
    if (this.budget) {
      this.categoryId = this.budget.categoryId;
      this.amount = this.budget.amount;
      this.isDefault = this.budget.isDefault;
      this.month = this.budget.month || this.currentMonth;
    } else {
      this.categoryId = this.preselectedCategoryId || '';
      this.amount = 0;
      this.isDefault = !this.preselectedMonth;
      this.month = this.preselectedMonth || this.currentMonth;
    }
  }

  save() {
    if (!this.categoryId) { alert('Select a category'); return; }
    if (!this.amount || this.amount <= 0) { alert('Amount must be greater than zero'); return; }

    const data: Omit<Budget, 'id' | 'createdAt'> = {
      categoryId: this.categoryId,
      amount: Number(this.amount),
      isDefault: this.isDefault,
    };

    if (!this.isDefault) data.month = this.month;

    this.saved.emit(data);
  }
}