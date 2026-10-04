import {
  Component, EventEmitter, Input, OnChanges, Output, SimpleChanges, inject,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Modal } from '../../../components/modal/modal';
import { ToastService } from '../../../services/toast.service';
import { ManualAsset, ManualAssetType, Valuation } from '../../../models';
import { MANUAL_TYPES, manualType, sortedValuations, valueOn, withValuation } from '../../../utils/net-worth';
import { localDateString, parseLocalDate } from '../../../utils/date';

export type AssetFormResult = Omit<ManualAsset, 'id' | 'createdAt' | 'updatedAt'>;

/**
 * Add or edit something you own or owe that has no bank connection.
 *
 * Changing the value doesn't overwrite it — it records a new valuation on the
 * "as of" date, so last month's net worth still shows last month's value.
 * Past valuations are listed underneath and can be removed if one was wrong.
 */
@Component({
  selector: 'app-asset-form',
  standalone: true,
  imports: [CommonModule, FormsModule, Modal],
  templateUrl: './asset-form.html',
  styleUrl: './asset-form.scss',
})
export class AssetForm implements OnChanges {
  private toast = inject(ToastService);

  @Input() open = false;
  @Input() asset: ManualAsset | null = null;
  @Output() closed = new EventEmitter<void>();
  @Output() saved = new EventEmitter<AssetFormResult>();
  @Output() deleteRequested = new EventEmitter<void>();

  readonly owns = MANUAL_TYPES.filter(t => t.side === 'asset');
  readonly owes = MANUAL_TYPES.filter(t => t.side === 'liability');
  readonly today = localDateString();

  type: ManualAssetType = 'property';
  name = '';
  value: number | null = null;
  asOf = this.today;
  notes = '';
  /** Working copy of the history; saved only when you press Save. */
  history: Valuation[] = [];

  ngOnChanges(changes: SimpleChanges) {
    if (changes['open'] && this.open) this.load();
  }

  private load() {
    const a = this.asset;
    this.type = a?.type ?? 'property';
    this.name = a?.name ?? '';
    this.notes = a?.notes ?? '';
    this.history = a ? sortedValuations(a) : [];
    this.asOf = this.today;
    this.value = a ? valueOn({ ...a, valuations: this.history }, this.today) : null;
  }

  get isDebt() { return manualType(this.type).side === 'liability'; }

  get namePlaceholder(): string {
    return {
      property: 'e.g. Home', vehicle: 'e.g. 2021 Honda Civic', investment: 'e.g. Fidelity 401(k)',
      cash: 'e.g. Security deposit', valuable: 'e.g. Watch', 'other-asset': 'e.g. Money lent to a friend',
      mortgage: 'e.g. Home mortgage', 'auto-loan': 'e.g. Civic loan', 'student-loan': 'e.g. Federal student loan',
      'personal-loan': 'e.g. Loan from family', 'other-liability': 'e.g. Medical bill',
    }[this.type];
  }

  removeValuation(v: Valuation) {
    this.history = this.history.filter(h => h !== v);
  }

  formatDate(d: string) {
    return parseLocalDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  money(n: number) {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  save() {
    const name = this.name.trim();
    if (!name) { this.toast.error('Give it a name.'); return; }
    const value = Number(this.value);
    if (this.value === null || !isFinite(value) || value < 0) {
      this.toast.error(this.isDebt ? 'Enter how much you owe.' : 'Enter what it is worth.');
      return;
    }
    if (!this.asOf || this.asOf > this.today) { this.toast.error('Pick a date that isn\'t in the future.'); return; }

    // Only record a valuation if it says something new for that date.
    const current = valueOn({ valuations: this.history } as ManualAsset, this.asOf);
    const valuations = current === value ? this.history : withValuation(this.history, this.asOf, value);
    if (!valuations.length) { this.toast.error('Add at least one value.'); return; }

    const result: AssetFormResult = { name, type: this.type, valuations };
    if (this.notes.trim()) result.notes = this.notes.trim();
    this.saved.emit(result);
  }
}
