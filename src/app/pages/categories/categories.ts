import { Component, HostListener, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';

import { CategoryService } from '../../services/category.service';
import { CategoryAdminService } from '../../services/category-admin.service';
import { TransactionService } from '../../services/transaction.service';
import { BudgetService } from '../../services/budget.service';
import { ToastService } from '../../services/toast.service';
import { Category, CategoryKind } from '../../models';
import {
  MAX_NAME_LENGTH, defaultDeletionTarget, deletionTargets, plaidNamesFor, validateCategoryName,
} from '../../utils/categories';
import { categoryPalette } from '../../utils/theme-colors';

/** Emoji offered as one-tap picks; any emoji can still be typed. */
const ICON_PICKS = [
  '🛍️', '🍽️', '🛒', '☕', '🚗', '⛽', '✈️', '🏠', '💡', '📱',
  '🎬', '🎮', '💊', '💇', '🏋️', '🎓', '🎁', '🐾', '🧾', '📦',
  '💼', '💰', '💵', '📈', '🏦', '🔁',
];

interface Editing {
  /** Absent when creating. */
  category?: Category;
  name: string;
  kind: CategoryKind;
  icon: string;
  color: string;
}

/**
 * Settings → Categories: create, rename, archive and delete categories.
 *
 * Deleting is the part that needs care, since transactions, budgets, rules,
 * bills and templates can all point at a category — and bank transactions
 * find theirs by name. The decisions are in `utils/categories.ts` (tested); the
 * writes are in `CategoryAdminService`. This page shows the user exactly what a
 * delete will do before they confirm it, and offers archiving as the
 * non-destructive alternative.
 */
@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, RouterLink],
  templateUrl: './categories.html',
  styleUrl: './categories.scss',
})
export class Categories {
  private categoryService = inject(CategoryService);
  private admin = inject(CategoryAdminService);
  private txService = inject(TransactionService);
  private budgetService = inject(BudgetService);
  private toast = inject(ToastService);

  readonly iconPicks = ICON_PICKS;
  readonly maxName = MAX_NAME_LENGTH;
  palette = computed(() => categoryPalette());

  loadError = this.categoryService.error;
  busy = signal(false);

  // ── Lists ──────────────────────────────────────────────────
  /** Transactions per category, counted once rather than per row. */
  private counts = computed(() => {
    const m = new Map<string, number>();
    for (const t of this.txService.transactions()) {
      if (t.categoryId) m.set(t.categoryId, (m.get(t.categoryId) ?? 0) + 1);
    }
    return m;
  });

  private budgeted = computed(() =>
    new Set(this.budgetService.budgets().map(b => b.categoryId)));

  expense = computed(() => this.active('expense'));
  income = computed(() => this.active('income'));
  archived = computed(() => this.categoryService.categories().filter(c => c.archived));

  private active(kind: CategoryKind) {
    return this.categoryService.categories().filter(c => c.kind === kind && !c.archived);
  }

  count(c: Category): number { return this.counts().get(c.id!) ?? 0; }
  hasBudget(c: Category): boolean { return this.budgeted().has(c.id!); }
  /** Whether bank transactions are matched to this one — worth knowing before renaming. */
  receivesBank(c: Category): boolean { return plaidNamesFor(c).length > 0; }

  // ── Create / edit ──────────────────────────────────────────
  editing = signal<Editing | null>(null);

  startCreate(kind: CategoryKind = 'expense') {
    this.editing.set({ name: '', kind, icon: '', color: this.palette()[0] });
  }

  startEdit(c: Category) {
    this.editing.set({
      category: c, name: c.name, kind: c.kind, icon: c.icon ?? '', color: c.color ?? '',
    });
  }

  patch(p: Partial<Editing>) {
    const cur = this.editing();
    if (cur) this.editing.set({ ...cur, ...p });
  }

  /** Live validation, so the reason shows before Save rather than after. */
  editError = computed(() => {
    const e = this.editing();
    if (!e) return null;
    return validateCategoryName(e.name, e.kind, this.categoryService.categories(), e.category?.id);
  });

  /** Shown when renaming a category bank transactions land in. */
  renameNote = computed(() => {
    const e = this.editing();
    if (!e?.category || !this.receivesBank(e.category)) return null;
    if (e.name.trim() === e.category.name) return null;
    return `Bank transactions filed as "${e.category.name}" will keep arriving here under the new name.`;
  });

  async save() {
    const e = this.editing();
    if (!e || this.editError() || this.busy()) return;
    this.busy.set(true);
    try {
      if (e.category) {
        await this.admin.edit(e.category, { name: e.name, icon: e.icon, color: e.color });
        this.toast.success(`Saved "${e.name.trim()}".`);
      } else {
        await this.admin.create({ name: e.name, kind: e.kind, icon: e.icon, color: e.color });
        this.toast.success(`Added "${e.name.trim()}".`);
      }
      this.editing.set(null);
    } catch (err) {
      this.toast.error((err as Error)?.message || 'Could not save the category.');
    } finally {
      this.busy.set(false);
    }
  }

  // ── Archive ────────────────────────────────────────────────
  async archive(c: Category) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.admin.archive(c);
      this.toast.success(`Archived "${c.name}". Its history is unchanged.`);
      if (this.deleting()?.category.id === c.id) this.deleting.set(null);
    } catch {
      this.toast.error('Could not archive the category.');
    } finally {
      this.busy.set(false);
    }
  }

  async restore(c: Category) {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      await this.admin.restore(c);
      this.toast.success(`Restored "${c.name}".`);
    } catch {
      this.toast.error('Could not restore the category.');
    } finally {
      this.busy.set(false);
    }
  }

  // ── Delete ─────────────────────────────────────────────────
  deleting = signal<{ category: Category; targetId: string | null } | null>(null);

  startDelete(c: Category) {
    this.deleting.set({
      category: c,
      targetId: defaultDeletionTarget(c, this.categoryService.categories()),
    });
  }

  setTarget(id: string) {
    const d = this.deleting();
    if (d) this.deleting.set({ ...d, targetId: id || null });
  }

  targets = computed(() => {
    const d = this.deleting();
    return d ? deletionTargets(d.category, this.categoryService.categories()) : [];
  });

  targetName = computed(() => {
    const id = this.deleting()?.targetId;
    return id ? this.categoryService.categories().find(c => c.id === id)?.name ?? '' : '';
  });

  /** Recomputed live from current data, so the summary is never stale. */
  plan = computed(() => {
    const d = this.deleting();
    return d ? this.admin.planDeletion(d.category, d.targetId) : null;
  });

  /** Total transactions affected: stored ones plus bank ones matched by name. */
  planTxCount = computed(() => {
    const p = this.plan();
    return p ? p.transactions.length + p.bankTransactions : 0;
  });

  async confirmDelete() {
    const d = this.deleting();
    if (!d || this.busy()) return;
    this.busy.set(true);
    try {
      await this.admin.delete(d.category, d.targetId);
      this.toast.success(d.targetId
        ? `Deleted "${d.category.name}" and moved everything to "${this.targetName()}".`
        : `Deleted "${d.category.name}". Its transactions are now uncategorised.`);
      this.deleting.set(null);
    } catch {
      // The category is deleted last, so a failure here leaves it in place
      // with nothing pointing at a missing id. Retrying picks up where it left off.
      this.toast.error('Could not finish deleting. Nothing was lost — try again to complete it.');
    } finally {
      this.busy.set(false);
    }
  }

  // ── Helpers ────────────────────────────────────────────────
  plural(n: number, one: string, many = one + 's'): string {
    return `${n} ${n === 1 ? one : many}`;
  }

  @HostListener('document:keydown.escape')
  onEscape() {
    if (this.busy()) return;
    this.editing.set(null);
    this.deleting.set(null);
  }
}
