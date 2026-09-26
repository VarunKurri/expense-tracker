import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';

import { CategoryService } from '../../services/category.service';
import { CategoryGroupService } from '../../services/category-group.service';
import { TransactionRuleService } from '../../services/transaction-rule.service';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { ToastService } from '../../services/toast.service';
import { Category, CategoryGroup, TransactionRule } from '../../models';
import {
  describeRule, planBulkApply, ruleHasAction, ruleHasCondition, hasMissingCategory,
} from '../../utils/rules';
import { categoryPalette } from '../../utils/theme-colors';

/** A blank rule, ready for the editor. */
function emptyRule(): TransactionRule {
  return { enabled: true, priority: 0, createdAt: 0 };
}

@Component({
  selector: 'app-categories',
  standalone: true,
  imports: [CommonModule, FormsModule, RouterLink],
  templateUrl: './categories.html',
  styleUrl: './categories.scss',
})
export class Categories {
  private categoryService = inject(CategoryService);
  private groupService = inject(CategoryGroupService);
  private ruleService = inject(TransactionRuleService);
  private txService = inject(TransactionService);
  private accountService = inject(AccountService);
  private toast = inject(ToastService);

  tab = signal<'groups' | 'rules'>('groups');

  categories = this.categoryService.categories;
  groups = this.groupService.groups;
  rules = this.ruleService.rules;
  accounts = computed(() => this.accountService.accounts().filter(a => !a.archived));

  /** Surfaced so a decryption failure is visible rather than silent. */
  loadError = computed(() =>
    this.groupService.error() || this.ruleService.error() || this.categoryService.error());

  // ── Groups ─────────────────────────────────────────────────
  newGroupName = signal('');
  busy = signal(false);

  /** Categories under each group, plus an "Ungrouped" bucket that is never hidden. */
  grouped = computed(() => {
    const palette = categoryPalette();
    const byGroup = this.groups().map((g, i) => ({
      group: g,
      color: g.color || palette[i % palette.length],
      members: this.categories().filter(c => c.groupId === g.id && !c.archived),
    }));
    const known = new Set(this.groups().map(g => g.id));
    const ungrouped = this.categories()
      .filter(c => !c.archived && (!c.groupId || !known.has(c.groupId)));
    return { byGroup, ungrouped };
  });

  async addGroup() {
    const name = this.newGroupName().trim();
    if (!name) return;
    if (this.groups().some(g => g.name.toLowerCase() === name.toLowerCase())) {
      this.toast.error(`There is already a group called "${name}".`);
      return;
    }
    this.busy.set(true);
    try {
      await this.groupService.add({ name, sortOrder: this.groups().length });
      this.newGroupName.set('');
    } catch {
      this.toast.error('Could not create the group. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  async renameGroup(g: CategoryGroup, name: string) {
    const trimmed = name.trim();
    if (!trimmed || trimmed === g.name) return;
    try { await this.groupService.update(g.id!, { name: trimmed }); }
    catch { this.toast.error('Could not rename the group.'); }
  }

  /**
   * Removes the group and clears it off its members first, so no category is
   * left pointing at something that no longer exists.
   */
  async deleteGroup(g: CategoryGroup) {
    this.busy.set(true);
    try {
      const members = this.categories().filter(c => c.groupId === g.id);
      for (const c of members) await this.categoryService.update(c.id!, { groupId: '' });
      await this.groupService.remove(g.id!);
      this.toast.success(
        members.length
          ? `Deleted "${g.name}". ${members.length} categor${members.length === 1 ? 'y is' : 'ies are'} now ungrouped.`
          : `Deleted "${g.name}".`
      );
    } catch {
      this.toast.error('Could not delete the group.');
    } finally {
      this.busy.set(false);
    }
  }

  async assignCategory(c: Category, groupId: string) {
    try { await this.categoryService.update(c.id!, { groupId }); }
    catch { this.toast.error(`Could not move ${c.name}.`); }
  }

  // ── Rules ──────────────────────────────────────────────────
  editing = signal<TransactionRule | null>(null);
  isNew = signal(false);

  startNewRule() { this.editing.set(emptyRule()); this.isNew.set(true); }
  editRule(r: TransactionRule) { this.editing.set({ ...r }); this.isNew.set(false); }
  cancelEdit() { this.editing.set(null); }

  /** Field setter that keeps the draft immutable, so the signal actually fires. */
  patchDraft(patch: Partial<TransactionRule>) {
    const cur = this.editing();
    if (cur) this.editing.set({ ...cur, ...patch });
  }

  /** Blank strings from the form mean "no condition", not "match empty". */
  private clean(v: string): string | undefined {
    const t = v?.trim();
    return t ? t : undefined;
  }
  private cleanNum(v: string | number | null | undefined): number | undefined {
    if (v === null || v === undefined || v === '') return undefined;
    const n = Number(v);
    return Number.isFinite(n) ? n : undefined;
  }

  draftValid = computed(() => {
    const r = this.editing();
    return !!r && ruleHasCondition(r) && ruleHasAction(r);
  });

  draftSummary = computed(() => {
    const r = this.editing();
    return r ? this.describe(r) : '';
  });

  /** How many existing transactions this draft would change, before saving. */
  draftImpact = computed(() => {
    const r = this.editing();
    if (!r || !this.draftValid()) return null;
    return planBulkApply([{ ...r, enabled: true, id: r.id ?? '__draft__' }],
      this.txService.transactions()).length;
  });

  async saveRule() {
    const r = this.editing();
    if (!r || !this.draftValid()) return;
    this.busy.set(true);
    const payload: Omit<TransactionRule, 'id' | 'createdAt'> = {
      name: this.clean(r.name ?? ''),
      enabled: r.enabled,
      priority: r.priority ?? 0,
      merchantContains: this.clean(r.merchantContains ?? ''),
      type: r.type || undefined,
      accountId: this.clean(r.accountId ?? ''),
      categoryId: this.clean(r.categoryId ?? ''),
      amountMin: this.cleanNum(r.amountMin),
      amountMax: this.cleanNum(r.amountMax),
      setCategoryId: this.clean(r.setCategoryId ?? ''),
      setInternalTransfer: r.setInternalTransfer,
    };
    try {
      if (this.isNew()) await this.ruleService.add(payload);
      else await this.ruleService.update(r.id!, payload);
      this.editing.set(null);
      this.toast.success('Rule saved. It applies to new transactions from now on.');
    } catch {
      this.toast.error('Could not save the rule.');
    } finally {
      this.busy.set(false);
    }
  }

  async toggleRule(r: TransactionRule) {
    try { await this.ruleService.update(r.id!, { enabled: !r.enabled }); }
    catch { this.toast.error('Could not update the rule.'); }
  }

  async deleteRule(r: TransactionRule) {
    try {
      await this.ruleService.remove(r.id!);
      this.toast.success('Rule deleted.');
    } catch { this.toast.error('Could not delete the rule.'); }
  }

  async move(r: TransactionRule, direction: -1 | 1) {
    try { await this.ruleService.reorder(r.id!, direction); }
    catch { this.toast.error('Could not reorder the rules.'); }
  }

  /** A rule whose target category was deleted — shown with a warning, and not run. */
  isBroken(r: TransactionRule): boolean {
    return hasMissingCategory(r,
      new Set(this.categories().map(c => c.id).filter((id): id is string => !!id)));
  }

  describe(r: TransactionRule): string {
    return describeRule(
      r,
      id => this.categories().find(c => c.id === id)?.name ?? 'a deleted category',
      id => this.accounts().find(a => a.id === id)?.name ?? 'that account',
    );
  }

  // ── Bulk apply ─────────────────────────────────────────────
  /**
   * Bank-synced transactions are categorised here rather than on the server:
   * rules are encrypted with the user's key, so the sync Cloud Function cannot
   * read them.
   */
  pendingCount = computed(() =>
    planBulkApply(this.ruleService.activeRules(), this.txService.transactions(), { onlyUncategorised: true }).length);

  recategoriseCount = computed(() =>
    planBulkApply(this.ruleService.activeRules(), this.txService.transactions()).length);

  async applyRules(all: boolean) {
    const plan = planBulkApply(this.ruleService.activeRules(), this.txService.transactions(),
      { onlyUncategorised: !all });
    if (!plan.length) {
      this.toast.info('Nothing to change — every transaction already matches your rules.');
      return;
    }
    this.busy.set(true);
    try {
      const n = await this.txService.applyPatches(plan);
      this.toast.success(`Updated ${n} transaction${n === 1 ? '' : 's'}.`);
    } catch {
      this.toast.error('Could not apply the rules. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }
}
