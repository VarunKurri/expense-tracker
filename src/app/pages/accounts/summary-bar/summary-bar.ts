import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';
import { formatCurrency } from '../../../utils/format';

@Component({
  selector: 'app-summary-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './summary-bar.html',
  styleUrl: './summary-bar.scss'
})
export class SummaryBar {
  @Input() assets = 0;
  @Input() liabilities = 0;

  get netWorth(): number {
    return this.assets - this.liabilities;
  }

  format(val: number): string {
    return formatCurrency(val);
  }
}
