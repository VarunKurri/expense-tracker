import { Component, effect, inject, input, output, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Group } from '../../models';
import { GroupService } from '../../services/group.service';
import { ToastService } from '../../services/toast.service';
import { Modal } from '../modal/modal';
import { Confirm } from '../confirm/confirm';
import { SplitPeople } from '../split-editor/parts/split-people';

/**
 * Create or edit a group (a trip, a flat): its name, who's in it, when it
 * ran, and whether to simplify debts. You're always in your own groups.
 */
@Component({
  selector: 'app-group-form',
  standalone: true,
  imports: [FormsModule, Modal, Confirm, SplitPeople],
  templateUrl: './group-form.html',
})
export class GroupForm {
  private groups = inject(GroupService);
  private toast = inject(ToastService);

  open = input(false);
  /** The group being edited; null to create one. */
  group = input<Group | null>(null);
  closed = output<void>();
  /** The group's id, once saved. */
  saved = output<string>();
  deleted = output<void>();

  name = signal('');
  memberIds = signal<string[]>([]);
  startDate = signal('');
  endDate = signal('');
  simplify = signal(true);
  saving = signal(false);
  confirming = signal(false);

  constructor() {
    // Fill in the form each time it opens.
    effect(() => {
      if (!this.open()) return;
      const g = this.group();
      untracked(() => {
        this.name.set(g?.name ?? '');
        this.memberIds.set([...(g?.memberIds ?? [])]);
        this.startDate.set(g?.startDate ?? '');
        this.endDate.set(g?.endDate ?? '');
        this.simplify.set(g?.simplify ?? true);
        this.confirming.set(false);
      });
    });
  }

  addMember(id: string) {
    this.memberIds.update(ids => ids.includes(id) ? ids : [...ids, id]);
  }

  removeMember(id: string) {
    this.memberIds.update(ids => ids.filter(x => x !== id));
  }

  async save() {
    const name = this.name().trim();
    if (!name) { this.toast.error('Give the group a name.'); return; }
    if (!this.memberIds().length) { this.toast.error('Add at least one person to the group.'); return; }
    const start = this.startDate(), end = this.endDate();
    if (start && end && end < start) { this.toast.error('The trip ends before it starts.'); return; }

    const data = {
      name,
      memberIds: this.memberIds(),
      simplify: this.simplify(),
      // `undefined` drops a cleared date when the document is saved.
      startDate: start || undefined,
      endDate: end || undefined,
    };
    this.saving.set(true);
    try {
      const g = this.group();
      if (g?.id) {
        await this.groups.update(g.id, data);
        this.saved.emit(g.id);
      } else {
        this.saved.emit(await this.groups.add({ ...data, payments: [] }));
      }
    } catch {
      this.toast.error('Could not save the group. Please try again.');
    } finally {
      this.saving.set(false);
    }
  }

  async remove() {
    const g = this.group();
    this.confirming.set(false);
    if (!g?.id) return;
    try {
      await this.groups.remove(g.id);
      this.toast.success(`Deleted ${g.name}.`);
      this.deleted.emit();
    } catch {
      this.toast.error('Could not delete the group. Please try again.');
    }
  }
}
