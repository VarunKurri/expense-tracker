import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { ToastService } from '../../services/toast.service';
import { Confirm } from '../../components/confirm/confirm';
import { Category } from '../../models';

// The seeded default set (see seed.service.ts). Anything else is "custom".
const DEFAULT_EXPENSE = ['Groceries', 'Gas', 'Dining', 'Parking', 'RideShare', 'Car', 'Shopping', 'Entertainment', 'Rent', 'Utilities', 'Health', 'Subscriptions', 'Other'];
const DEFAULT_INCOME = ['Salary', 'Bonus', 'Interest', 'Pocket Money', 'Refund', 'Other Income'];

interface PendingMerge {
  source: Category;
  targetId: string;
  count: number;
}

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, Confirm],
  templateUrl: './categories.html',
  styleUrl: './categories.scss',
})
export class Categories {
  private categorySvc = inject(CategoryService);
  private txService = inject(TransactionService);
  private toast = inject(ToastService);

  private targets = signal<Record<string, string>>({});
  confirmOpen = signal(false);
  pendingMerge = signal<PendingMerge | null>(null);
  busy = signal(false);

  custom = computed(() => this.categorySvc.categories().filter(c => !this.isDefault(c)));
  defaults = computed(() => this.categorySvc.categories().filter(c => this.isDefault(c)));

  private isDefault(c: Category): boolean {
    const names = c.kind === 'income' ? DEFAULT_INCOME : DEFAULT_EXPENSE;
    return names.includes(c.name);
  }

  /** Default categories of the same kind, as merge targets. */
  targetsFor(kind: 'income' | 'expense'): Category[] {
    return this.defaults().filter(c => c.kind === kind);
  }

  txCount(catId?: string): number {
    if (!catId) return 0;
    return this.txService.transactions().filter(t => t.categoryId === catId).length;
  }

  /** Chosen target for a custom category, defaulting to Other / Other Income. */
  selectedTarget(c: Category): string {
    const chosen = this.targets()[c.id!];
    if (chosen) return chosen;
    const fallbackName = c.kind === 'income' ? 'Other Income' : 'Other';
    const fb = this.defaults().find(d => d.kind === c.kind && d.name === fallbackName);
    return fb?.id ?? this.targetsFor(c.kind)[0]?.id ?? '';
  }

  setTarget(catId: string, targetId: string) {
    this.targets.update(m => ({ ...m, [catId]: targetId }));
  }

  targetName(id: string): string {
    return this.categorySvc.categories().find(c => c.id === id)?.name ?? '';
  }

  askMerge(c: Category) {
    const targetId = this.selectedTarget(c);
    if (!targetId) {
      this.toast.error('No default category available to merge into.');
      return;
    }
    this.pendingMerge.set({ source: c, targetId, count: this.txCount(c.id) });
    this.confirmOpen.set(true);
  }

  async confirmMerge() {
    const p = this.pendingMerge();
    this.confirmOpen.set(false);
    if (!p) return;
    this.busy.set(true);
    try {
      const ids = this.txService.transactions()
        .filter(t => t.categoryId === p.source.id && t.id)
        .map(t => t.id!);
      await this.txService.updateMany(ids, { categoryId: p.targetId });
      await this.categorySvc.remove(p.source.id!);
      this.toast.success(`Merged "${p.source.name}" into "${this.targetName(p.targetId)}" — ${ids.length} moved.`);
    } catch (err: any) {
      this.toast.error(err?.message || 'Could not merge this category. Please try again.');
    } finally {
      this.busy.set(false);
      this.pendingMerge.set(null);
    }
  }

  cancelMerge() {
    this.confirmOpen.set(false);
    this.pendingMerge.set(null);
  }
}
