import { Component, EventEmitter, Input, Output, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Modal } from '../modal/modal';
import { ReconciliationService, ReconcileMatch } from '../../services/reconciliation.service';
import { CategoryService } from '../../services/category.service';
import { AccountService } from '../../services/account.service';

@Component({
  selector: 'app-reconcile-review',
  standalone: true,
  imports: [CommonModule, Modal],
  templateUrl: './reconcile-review.html',
  styleUrl: './reconcile-review.scss',
})
export class ReconcileReview {
  @Input() open = false;
  @Output() closed = new EventEmitter<void>();

  reconcile = inject(ReconciliationService);
  private categorySvc = inject(CategoryService);
  private accountSvc = inject(AccountService);

  categoryName(id?: string): string {
    if (!id) return 'Uncategorized';
    return this.categorySvc.categories().find(c => c.id === id)?.name ?? 'Uncategorized';
  }

  accountName(id?: string): string {
    if (!id) return '—';
    return this.accountSvc.accounts().find(a => a.id === id)?.name ?? '—';
  }

  formatCurrency(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  formatDate(d: string): string {
    return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  async merge(m: ReconcileMatch) {
    await this.reconcile.merge(m);
    this.closeIfDone();
  }

  async mergeAll() {
    await this.reconcile.mergeAll();
    this.closeIfDone();
  }

  async keepBoth(m: ReconcileMatch) {
    await this.reconcile.keepBoth(m);
    this.closeIfDone();
  }

  private closeIfDone() {
    if (this.reconcile.matches().length === 0) this.closed.emit();
  }
}
