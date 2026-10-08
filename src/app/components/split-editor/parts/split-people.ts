import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ME } from '../../../models';
import { PersonService } from '../../../services/person.service';
import { ToastService } from '../../../services/toast.service';

/**
 * Who's on a bill: you (on or off), saved people as one-tap chips, anyone new
 * by name. Shared by the quick and itemized split editors; the editor decides
 * what adding or removing someone means for its own state.
 */
@Component({
  selector: 'app-split-people',
  standalone: true,
  imports: [FormsModule],
  template: `
    <div class="field">
      <span class="label-sm">Split with</span>
      <div class="people">
        <button type="button" class="chip name" [class.active]="includesMe()" [attr.aria-pressed]="includesMe()"
                (click)="meToggled.emit()">You</button>
        @for (id of others(); track id) {
          <span class="chip name active person">
            {{ people.nameOf(id) }}
            <button type="button" class="person-remove" (click)="removed.emit(id)"
                    [attr.aria-label]="'Remove ' + people.nameOf(id)">✕</button>
          </span>
        }
      </div>
      <div class="add-person">
        <input class="input-field" [ngModel]="newName()" (ngModelChange)="newName.set($event)" name="splitNewName"
               placeholder="Add someone by name" aria-label="Add someone by name"
               (keydown.enter)="$event.preventDefault(); addByName()" />
        <button type="button" class="btn-ghost" [disabled]="!newName().trim() || adding()" (click)="addByName()">Add</button>
      </div>
      @if (suggestions().length) {
        <div class="people suggestions">
          @for (p of suggestions(); track p.id) {
            <button type="button" class="chip name" (click)="include(p.id!)">+ {{ p.name }}</button>
          }
        </div>
      }
      @if (!includesMe()) {
        <p class="field-hint">You're not in the split: you paid for them, and all of it is owed back to you.</p>
      }
    </div>
  `,
  styleUrl: './split-parts.scss',
})
export class SplitPeople {
  people = inject(PersonService);
  private toast = inject(ToastService);

  participantIds = input.required<string[]>();
  added = output<string>();
  removed = output<string>();
  meToggled = output<void>();

  includesMe = computed(() => this.participantIds().includes(ME));
  others = computed(() => this.participantIds().filter(id => id !== ME));

  newName = signal('');
  adding = signal(false);

  /** Saved people not on this bill yet, narrowed by what's typed. */
  suggestions = computed(() => {
    const on = new Set(this.participantIds());
    const q = this.newName().trim().toLowerCase();
    return this.people.people()
      .filter(p => p.id && !on.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
      .slice(0, 8);
  });

  include(id: string) {
    this.newName.set('');
    if (!this.participantIds().includes(id)) this.added.emit(id);
  }

  /** Add by name: someone already saved is reused, anyone new is saved for next time. */
  async addByName() {
    const name = this.newName().trim();
    if (!name || this.adding()) return;
    const known = this.people.people().find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (known?.id) { this.include(known.id); return; }
    this.adding.set(true);
    try {
      this.include(await this.people.add({ name }));
    } catch {
      this.toast.error(`Could not save ${name}. Please try again.`);
    } finally {
      this.adding.set(false);
    }
  }
}
