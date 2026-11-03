import { Component, computed, inject, input, output } from '@angular/core';
import { TransactionSplit } from '../../../models';
import { PersonService } from '../../../services/person.service';
import { formatCurrency } from '../../../utils/format';
import { fromCents } from '../../../utils/money';
import { calculateSplit } from '../../../utils/split/split';
import { toBill } from '../../../utils/splits';

/**
 * Who pays the extra cent when a bill doesn't divide evenly ($85.00 six ways
 * is $14.1666…, so four people pay $14.17 and two pay $14.16).
 *
 * By default it's whoever paid, then in bill order. Splitwise picks for each
 * bill instead, so matching a Splitwise group to the cent means choosing the
 * same people here. Shown only when there are odd cents to give out.
 *
 * `chosen` is the hand-picked list: undefined means "the default", and an
 * array (even an empty one, mid-edit) means "these, then the default for any
 * still unpicked".
 */
@Component({
  selector: 'app-split-odd-cents',
  standalone: true,
  template: `
    @if (count() > 0) {
      <div class="field odd-cents">
        <span class="label-sm">Odd cents</span>
        <p class="field-hint">
          <span class="fig">{{ money(billCents()) }}</span> doesn't divide evenly, so
          {{ count() === 1 ? 'one person pays' : count() + ' people pay' }} 1¢ more.
          Splitwise picks who for each bill; to match it, pick the same {{ count() === 1 ? 'person' : 'people' }}.
        </p>
        <div class="people">
          @for (id of candidates(); track id) {
            <button type="button" class="chip name" [class.active]="selected().includes(id)"
                    [attr.aria-pressed]="selected().includes(id)"
                    [disabled]="!selected().includes(id) && selected().length >= count()"
                    (click)="toggle(id)">{{ people.nameOf(id) }}</button>
          }
        </div>
        @if (chosen() !== undefined) {
          @if (selected().length < count()) {
            <p class="field-hint">Pick {{ count() - selected().length }} more. Until you do, the rest go to whoever paid, then in order.</p>
          }
          <button type="button" class="btn-row" (click)="chosenChange.emit(undefined)">Use the default</button>
        } @else {
          <p class="field-hint">Picked for you: whoever paid first, then in order. Tap a name to take its cent away, then pick who should pay it.</p>
        }
      </div>
    }
  `,
  styleUrl: './split-parts.scss',
})
export class SplitOddCents {
  people = inject(PersonService);

  split = input.required<TransactionSplit>();
  chosen = input<string[] | undefined>(undefined);
  chosenChange = output<string[] | undefined>();

  private summary = computed(() => calculateSplit(toBill(this.split())));
  billCents = computed(() => this.summary().totalCents);
  /** How many people pay the extra cent. */
  count = computed(() => this.summary().roundedUpIds.length);
  /** Who could: everyone whose exact share has a fraction of a cent. */
  candidates = computed(() => this.summary().roundableIds);
  /** Who's shown as paying it: the hand-picked ones, or else the default. */
  selected = computed(() => {
    const chosen = this.chosen();
    return chosen === undefined
      ? this.summary().roundedUpIds
      : chosen.filter(id => this.candidates().includes(id));
  });

  toggle(id: string) {
    const current = this.selected();
    if (current.includes(id)) this.chosenChange.emit(current.filter(x => x !== id));
    else if (current.length < this.count()) this.chosenChange.emit([...current, id]);
  }

  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }
}
