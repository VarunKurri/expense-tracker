import { Injectable, inject } from '@angular/core';
import { CategoryService } from './category.service';
import { TransactionService } from './transaction.service';
import { BudgetService } from './budget.service';
import { TransactionRuleService } from './transaction-rule.service';
import { BillService } from './bill.service';
import { TransactionTemplateService } from './transaction-template.service';
import { Category, CategoryKind } from '../models';
import {
  DeletionPlan, aliasesAfterRename, planCategoryDeletion, validateCategoryName,
} from '../utils/categories';

export interface CategoryDraft {
  name: string;
  kind: CategoryKind;
  icon?: string;
  color?: string;
}

/**
 * Create, edit, archive and delete categories — and keep everything that
 * points at them consistent.
 *
 * Separate from CategoryService because deletion has to write to five other
 * collections, and those services already depend on CategoryService; putting
 * this there would make the dependencies circular.
 *
 * All the decisions live in `utils/categories.ts`, where they are tested. This
 * only gathers the inputs and performs the writes.
 */
@Injectable({ providedIn: 'root' })
export class CategoryAdminService {
  private categories = inject(CategoryService);
  private txService = inject(TransactionService);
  private budgets = inject(BudgetService);
  private rules = inject(TransactionRuleService);
  private bills = inject(BillService);
  private templates = inject(TransactionTemplateService);

  async create(draft: CategoryDraft) {
    const error = validateCategoryName(draft.name, draft.kind, this.categories.categories());
    if (error) throw new Error(error);
    await this.categories.add({
      name: draft.name.trim(),
      kind: draft.kind,
      icon: draft.icon?.trim() || undefined,
      color: draft.color || undefined,
      archived: false,
    });
  }

  /**
   * Edits name, icon and colour. The kind is fixed once created: turning an
   * expense category into an income one would leave every expense filed there
   * in a category of the wrong kind.
   */
  async edit(category: Category, changes: Pick<CategoryDraft, 'name' | 'icon' | 'color'>) {
    const name = changes.name.trim();
    const error = validateCategoryName(name, category.kind, this.categories.categories(), category.id);
    if (error) throw new Error(error);
    await this.categories.update(category.id!, {
      name,
      icon: changes.icon?.trim() || undefined,
      color: changes.color || undefined,
      // Keeps bank transactions arriving if a name Plaid matches on is renamed.
      plaidAliases: aliasesAfterRename(category, name),
    });
  }

  /**
   * Hides a category from every picker. Nothing else changes: past
   * transactions keep it, budgets and rules keep working, and bank
   * transactions Plaid files there keep landing there.
   */
  archive(category: Category) {
    return this.categories.update(category.id!, { archived: true });
  }

  restore(category: Category) {
    return this.categories.update(category.id!, { archived: false });
  }

  /** What deleting would do, from the current data — shown before confirming. */
  planDeletion(category: Category, targetId: string | null): DeletionPlan {
    const stored = this.txService.storedInCategory(category.id!);
    const shown = this.txService.countInCategory(category.id!);
    return planCategoryDeletion({
      category,
      targetId,
      categories: this.categories.categories(),
      storedTransactions: stored,
      matchedBankTransactions: Math.max(0, shown - stored.length),
      budgets: this.budgets.budgets(),
      rules: this.rules.rules(),
      bills: this.bills.bills(),
      templates: this.templates.templates(),
    });
  }

  /**
   * Deletes a category, moving everything that points at it first.
   *
   * The plan is rebuilt here rather than reusing the one the dialog showed, so
   * it reflects anything that changed while the dialog was open.
   *
   * Order matters, and is chosen so a failure part-way leaves nothing broken:
   *  1. Plaid names go to the target first, so bank transactions never pass
   *     through a moment of showing no category.
   *  2. Every stored reference moves.
   *  3. The category itself is deleted last. If anything above fails, it still
   *     exists and nothing points at a missing id — deleting again finishes the
   *     job, because the plan is rebuilt from whatever is left.
   */
  async delete(category: Category, targetId: string | null): Promise<DeletionPlan> {
    const plan = this.planDeletion(category, targetId);
    const target = targetId
      ? this.categories.categories().find(c => c.id === targetId)
      : undefined;

    if (target && plan.aliasesToTarget.length) {
      await this.categories.update(target.id!, {
        plaidAliases: [...new Set([...(target.plaidAliases ?? []), ...plan.aliasesToTarget])],
      });
    }

    await this.txService.applyPatches(plan.transactions);
    for (const m of plan.budgetMoves) await this.budgets.update(m.id, m.patch);
    for (const id of plan.budgetDeletes) await this.budgets.remove(id);
    for (const r of plan.rulePatches) await this.rules.update(r.id, r.patch);
    for (const b of plan.billPatches) await this.bills.update(b.id, b.patch);
    for (const t of plan.templatePatches) await this.templates.update(t.id, t.patch);

    await this.categories.remove(category.id!);
    return plan;
  }
}
