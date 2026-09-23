import { Component, computed, input, output } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Transaction } from '../../models';
import { DayCell, WEEKDAYS, buildMonthGrid, dateKeyOf } from '../../utils/calendar';

/**
 * A month of spending as a heat-shaded calendar, after Origin's "Spent in
 * September" card.
 *
 * Presentational by design: it takes transactions that have *already* been
 * narrowed to spending by the caller and never applies money rules of its own,
 * so the calendar cannot disagree with the total printed above it. All the grid
 * maths lives in `utils/calendar.ts` and is unit-tested there.
 *
 * Heat is scaled to the heaviest day of the month shown, not to a fixed dollar
 * amount — a £40 day is the darkest square in a quiet month and a pale one in a
 * heavy month, which is the comparison that actually reads at a glance.
 */
@Component({
  selector: 'app-spend-calendar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './spend-calendar.html',
  styleUrl: './spend-calendar.scss',
})
export class SpendCalendar {
  /** `YYYY-MM`. */
  month = input.required<string>();
  /** Spending transactions only — the caller filters. */
  transactions = input<Transaction[]>([]);
  /** Lets a caller's netting rule carry into the day totals. */
  amountOf = input<(t: Transaction) => number>(t => t.amount);
  /** `YYYY-MM-DD` of the currently open day, so it can be highlighted. */
  selected = input<string | null>(null);

  daySelected = output<DayCell>();

  weekdays = WEEKDAYS;

  grid = computed(() =>
    buildMonthGrid(this.month(), this.transactions(), this.amountOf(), dateKeyOf()));

  /** Whole dollars, the way Origin's cells read — cents are noise at this size. */
  cellAmount(cell: DayCell): string {
    if (cell.amount === 0) return '$0';
    if (cell.amount >= 10000) return '$' + Math.round(cell.amount / 1000) + 'k';
    return '$' + Math.round(cell.amount).toLocaleString('en-US');
  }

  /** Spoken label, since the visual cell is a bare number and a dollar figure. */
  ariaLabel(cell: DayCell): string {
    const day = new Date(cell.date + 'T00:00:00')
      .toLocaleDateString('en-US', { month: 'long', day: 'numeric' });
    if (cell.future) return `${day}, upcoming`;
    if (cell.count === 0) return `${day}, nothing spent`;
    return `${day}, ${this.cellAmount(cell)} spent across ` +
      `${cell.count} transaction${cell.count === 1 ? '' : 's'}`;
  }

  pick(cell: DayCell) {
    if (cell.future) return;
    this.daySelected.emit(cell);
  }
}
