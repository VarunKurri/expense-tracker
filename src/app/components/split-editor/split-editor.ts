import { Component, computed, inject, input, model } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ME, Payment } from '../../models';
import { PersonService } from '../../services/person.service';
import { formatCurrency } from '../../utils/format';
import { fromCents, toCents } from '../../utils/money';
import { amountGapCents, splitIsBalanced } from '../../utils/split/split';
import type { SplitMode } from '../../utils/split/types';
import {
  QuickSplitState, buildQuickSplit, quickBillCents, restateWeights, splitProblems,
} from '../../utils/splits';
import { SplitPayers } from './parts/split-payers';
import { SplitPeople } from './parts/split-people';
import { SplitSummary } from './parts/split-summary';

export const SPLIT_MODES: { value: SplitMode; label: string }[] = [
  { value: 'equal', label: 'Equally' },
  { value: 'shares', label: 'Shares' },
  { value: 'percent', label: 'Percent' },
  { value: 'amount', label: 'Amounts' },
];

/**
 * The quick split, inside the transaction form: who shared the bill, how it
 * was divided, and who else paid towards it.
 *
 * It holds only the choices (`QuickSplitState`). Every number shown comes from
 * Split's engine through `utils/splits.ts` — this component does no money
 * arithmetic of its own — so what you see is exactly what gets saved.
 */
@Component({
  selector: 'app-split-editor',
  standalone: true,
  imports: [FormsModule, SplitPeople, SplitPayers, SplitSummary],
  templateUrl: './split-editor.html',
  styleUrl: './split-editor.scss',
})
export class SplitEditor {
  people = inject(PersonService);

  /** What you paid: the transaction amount, in cents. */
  myPaidCents = input.required<number>();
  state = model.required<QuickSplitState>();

  readonly modes = SPLIT_MODES;

  // ── Derived, all from the engine ───────────────────────────
  billCents = computed(() => quickBillCents(this.state(), this.myPaidCents()));
  split = computed(() => buildQuickSplit(this.state(), this.myPaidCents()));
  problems = computed(() => splitProblems(this.split(), this.myPaidCents()));
  others = computed(() => this.state().participantIds.filter(id => id !== ME));

  /** Percentages or amounts that don't add up — still divided in proportion, but say so. */
  balanceNote = computed(() => {
    const item = this.split().items[0];
    return item && !splitIsBalanced(item) ? balanceNote(item.splitMode, item.assignments, amountGapCents(item), 'the bill') : '';
  });

  // ── People ─────────────────────────────────────────────────
  toggleMe() {
    const ids = this.state().participantIds;
    this.setParticipants(ids.includes(ME) ? ids.filter(id => id !== ME) : [ME, ...ids]);
  }

  add(id: string) {
    this.setParticipants([...this.state().participantIds, id]);
  }

  remove(id: string) {
    this.setParticipants(this.state().participantIds.filter(x => x !== id));
    this.state.update(s => ({ ...s, otherPayments: s.otherPayments.filter(p => p.personId !== id) }));
  }

  private setParticipants(ids: string[]) {
    this.state.update(s => {
      const weights = { ...s.weights };
      // Someone new starts with an even share, or nothing where it has to be typed.
      for (const id of ids) if (!(id in weights)) weights[id] = s.mode === 'shares' ? 1 : 0;
      return { ...s, participantIds: ids, weights };
    });
  }

  setPayments(otherPayments: Payment[]) {
    this.state.update(s => ({ ...s, otherPayments }));
  }

  // ── How it's divided ───────────────────────────────────────
  setMode(mode: SplitMode) {
    const s = this.state();
    if (s.mode === mode) return;
    this.state.set({ ...s, mode, weights: restateWeights(s, mode, this.billCents()) });
  }

  /** What the weight input shows: dollars in amount mode, the number otherwise. */
  weightValue(id: string): number | null {
    const w = this.state().weights[id];
    if (w === undefined) return null;
    return this.state().mode === 'amount' ? fromCents(w) : w;
  }

  setWeight(id: string, value: number | string | null) {
    const weight = parseWeight(this.state().mode, value);
    this.state.update(s => ({ ...s, weights: { ...s.weights, [id]: weight } }));
  }
}

/** A typed weight in the engine's terms: cents in amount mode, the number otherwise; never negative. */
export function parseWeight(mode: SplitMode, value: number | string | null): number {
  const n = Number(value);
  const clean = Number.isFinite(n) && n > 0 ? n : 0;
  return mode === 'amount' ? toCents(clean) : clean;
}

/** The note under weights that don't add up. They're still divided in proportion. */
export function balanceNote(mode: SplitMode, assignments: { weight: number }[], gapCents: number, what: string): string {
  if (mode === 'percent') {
    const total = assignments.reduce((s, a) => s + a.weight, 0);
    return `These add up to ${Math.round(total * 100) / 100}%, not 100%. It's divided in proportion until they do.`;
  }
  if (mode === 'amount') {
    return gapCents > 0
      ? `${formatCurrency(fromCents(gapCents))} isn't assigned to anyone yet. It's divided in proportion until it is.`
      : `That's ${formatCurrency(fromCents(-gapCents))} more than ${what}. It's divided in proportion until it adds up.`;
  }
  return '';
}
