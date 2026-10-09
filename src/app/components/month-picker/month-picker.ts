import { Component, ElementRef, HostListener, computed, inject, input, output, signal } from '@angular/core';
import { addMonths, monthKeyOf, monthLabel } from '../../utils/calendar';

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `‹ October 2026 ›`: step a month at a time, or click the name to jump
 * anywhere through a year grid.
 *
 * Budgets used to show a fixed row of nine month pills (five back, three
 * ahead), so anything older simply could not be reached. A stepper has no
 * edge, and the grid makes a long jump two clicks instead of twelve.
 *
 * Months in `marks` get a small dot in the grid ("there is something here"),
 * so you can find the months that matter without opening each one.
 */
@Component({
  selector: 'app-month-picker',
  standalone: true,
  templateUrl: './month-picker.html',
  styleUrl: './month-picker.scss',
})
export class MonthPicker {
  private host = inject(ElementRef<HTMLElement>);

  /** `YYYY-MM`. */
  month = input.required<string>();
  /** Earliest / latest selectable month, inclusive. Omit for no limit. */
  min = input<string | null>(null);
  max = input<string | null>(null);
  /** Months to mark with a dot in the grid. */
  marks = input<string[]>([]);

  monthChange = output<string>();

  readonly thisMonth = monthKeyOf();
  open = signal(false);
  /** The year the grid is showing; independent of the selection while browsing. */
  gridYear = signal(new Date().getFullYear());

  label = computed(() => monthLabel(this.month()));
  canPrev = computed(() => this.allowed(addMonths(this.month(), -1)));
  canNext = computed(() => this.allowed(addMonths(this.month(), 1)));
  private markSet = computed(() => new Set(this.marks()));

  cells = computed(() => {
    const y = this.gridYear();
    return SHORT.map((name, i) => {
      const value = `${y}-${String(i + 1).padStart(2, '0')}`;
      return {
        value, name,
        selected: value === this.month(),
        current: value === this.thisMonth,
        disabled: !this.allowed(value),
        marked: this.markSet().has(value),
      };
    });
  });

  canPrevYear = computed(() => !this.min() || `${this.gridYear() - 1}-12` >= this.min()!);
  canNextYear = computed(() => !this.max() || `${this.gridYear() + 1}-01` <= this.max()!);

  private allowed(m: string): boolean {
    return (!this.min() || m >= this.min()!) && (!this.max() || m <= this.max()!);
  }

  step(by: number) {
    const next = addMonths(this.month(), by);
    if (this.allowed(next)) this.monthChange.emit(next);
  }

  toggle() {
    if (!this.open()) this.gridYear.set(Number(this.month().slice(0, 4)));
    this.open.update(o => !o);
  }

  pick(value: string) {
    if (!this.allowed(value)) return;
    this.open.set(false);
    if (value !== this.month()) this.monthChange.emit(value);
  }

  stepYear(by: number) { this.gridYear.update(y => y + by); }

  @HostListener('document:click', ['$event'])
  onDocClick(e: MouseEvent) {
    if (this.open() && !this.host.nativeElement.contains(e.target as Node)) this.open.set(false);
  }

  @HostListener('document:keydown.escape')
  onEscape() { this.open.set(false); }
}
