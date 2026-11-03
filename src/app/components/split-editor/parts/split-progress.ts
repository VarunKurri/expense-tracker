import { Component, computed, input } from '@angular/core';
import { formatCurrency } from '../../../utils/format';
import { fromCents } from '../../../utils/money';

/**
 * "$56.78 of $56.87 added · $0.09 left": how much of the bill the split
 * accounts for so far. Always on screen while splitting, so entering tax and
 * tip shows at once what's still missing.
 */
@Component({
  selector: 'app-split-progress',
  standalone: true,
  template: `
    <div class="progress" [class.over]="leftCents() < 0" [class.done]="leftCents() === 0" aria-live="polite">
      <div class="progress-text">
        <span>
          <span class="fig">{{ money(addedCents()) }}</span> of
          <span class="fig">{{ money(totalCents()) }}</span> {{ verb() }}
        </span>
        <span class="progress-state fig">
          @if (leftCents() === 0) { ✓ Adds up }
          @else if (leftCents() > 0) { {{ money(leftCents()) }} left }
          @else { {{ money(-leftCents()) }} over }
        </span>
      </div>
      <div class="progress-track" role="progressbar" [attr.aria-label]="'Amount ' + verb()"
           aria-valuemin="0" [attr.aria-valuemax]="totalCents()" [attr.aria-valuenow]="addedCents()">
        <div class="progress-fill" [style.width.%]="fillPct()"></div>
      </div>
    </div>
  `,
  styles: `
    :host { display: block; }
    .progress { display: flex; flex-direction: column; gap: 6px; }
    .progress-text {
      display: flex; justify-content: space-between; align-items: baseline; gap: 12px;
      font-size: 13px; color: var(--fg-3);
      .fig { color: var(--fg); }
    }
    .progress-state { font-weight: 600; color: var(--fg); white-space: nowrap; }
    .progress-track { height: 4px; border-radius: var(--radius-pill); background: var(--line); overflow: hidden; }
    .progress-fill { height: 100%; border-radius: inherit; background: var(--fg); transition: width var(--t); }
    .over .progress-state { color: var(--red); }
    .over .progress-fill { background: var(--red); }
  `,
})
export class SplitProgress {
  /** The bill being split. */
  totalCents = input.required<number>();
  /** What the split accounts for so far. */
  addedCents = input.required<number>();
  verb = input('added');

  leftCents = computed(() => this.totalCents() - this.addedCents());
  fillPct = computed(() =>
    this.totalCents() > 0 ? Math.min(100, (this.addedCents() / this.totalCents()) * 100) : 0);

  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }
}
