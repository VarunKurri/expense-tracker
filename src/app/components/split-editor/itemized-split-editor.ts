import { Component, computed, inject, input, model, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Item, ME, Payment } from '../../models';
import { PersonService } from '../../services/person.service';
import { formatCurrency } from '../../utils/format';
import { fromCents, toCents } from '../../utils/money';
import { amountGapCents, calculateSplit, splitIsBalanced } from '../../utils/split/split';
import type { ChargeMode, SplitMode, TipBasis } from '../../utils/split/types';
import {
  ItemizedSplitState, assignUnclaimedTo, buildItemizedSplit, myPaymentToCoverCents, newItem, paidTowardsBillCents, removeFromItemized,
  setItemMode, setItemWeight, splitProblems, toBill, toggleAssignee,
} from '../../utils/splits';
import { SplitPayers } from './parts/split-payers';
import { SplitProgress } from './parts/split-progress';
import { SplitPeople } from './parts/split-people';
import { SplitSummary } from './parts/split-summary';
import { SPLIT_MODES, balanceNote, parseWeight } from './split-editor';

/**
 * Item by item: the receipt's lines, who had each, and tax and tip — which
 * Split's engine shares out in proportion to what each person had, so the
 * friend who only had a salad pays tip on a salad.
 *
 * Like the quick editor it holds only the choices; every figure on screen is
 * the engine's answer for exactly what will be saved.
 */
@Component({
  selector: 'app-itemized-split-editor',
  standalone: true,
  imports: [FormsModule, SplitPeople, SplitPayers, SplitProgress, SplitSummary],
  templateUrl: './itemized-split-editor.html',
  styleUrl: './itemized-split-editor.scss',
})
export class ItemizedSplitEditor {
  people = inject(PersonService);

  /** What you paid: the transaction amount, in cents. */
  myPaidCents = input.required<number>();
  state = model.required<ItemizedSplitState>();
  /** "Use $X as the amount": the receipt says you paid something else. */
  useAmount = output<number>();

  readonly modes = SPLIT_MODES;

  // ── Derived, all from the engine ───────────────────────────
  split = computed(() => buildItemizedSplit(this.state(), this.myPaidCents()));
  result = computed(() => calculateSplit(toBill(this.split())));
  problems = computed(() => splitProblems(this.split(), this.myPaidCents()));
  others = computed(() => this.state().participantIds.filter(id => id !== ME));
  includesMe = computed(() => this.state().participantIds.includes(ME));

  /** The bill being split: what you paid plus what anyone else paid. */
  billCents = computed(() => paidTowardsBillCents(this.state(), this.myPaidCents()));

  /** What you'd have had to pay for the receipt to add up, given what others paid. */
  coverCents = computed(() => myPaymentToCoverCents(this.state()));
  mismatch = computed(() => this.result().subtotalCents > 0 && this.coverCents() !== this.myPaidCents());

  private unclaimed = computed(() => new Set(this.result().unassignedItemIds));
  isUnclaimed(item: Item): boolean {
    return item.priceCents > 0 && this.unclaimed().has(item.id);
  }
  anyUnclaimed = computed(() => this.state().items.some(i => this.isUnclaimed(i)));

  // ── People ─────────────────────────────────────────────────
  toggleMe() {
    if (this.includesMe()) this.state.set(removeFromItemized(this.state(), ME));
    else this.state.update(s => ({ ...s, participantIds: [ME, ...s.participantIds] }));
  }

  add(id: string) {
    this.state.update(s => ({ ...s, participantIds: [...s.participantIds, id] }));
  }

  remove(id: string) {
    this.state.set(removeFromItemized(this.state(), id));
  }

  setPayments(otherPayments: Payment[]) {
    this.state.update(s => ({ ...s, otherPayments }));
  }

  // ── Items ──────────────────────────────────────────────────
  private updateItem(index: number, change: (item: Item) => Item) {
    this.state.update(s => ({ ...s, items: s.items.map((it, i) => i === index ? change(it) : it) }));
  }

  addItem() {
    this.state.update(s => ({ ...s, items: [...s.items, newItem()] }));
  }

  removeItem(index: number) {
    this.state.update(s => ({ ...s, items: s.items.filter((_, i) => i !== index) }));
  }

  setName(index: number, name: string) {
    this.updateItem(index, it => ({ ...it, name }));
  }

  priceValue(item: Item): number | null {
    return item.priceCents ? fromCents(item.priceCents) : null;
  }

  setPrice(index: number, raw: number | string | null) {
    const n = Number(raw);
    this.updateItem(index, it => ({ ...it, priceCents: Number.isFinite(n) && n > 0 ? toCents(n) : 0 }));
  }

  hasPart(item: Item, personId: string): boolean {
    return item.assignments.some(a => a.personId === personId && a.weight > 0);
  }

  toggle(index: number, personId: string) {
    this.updateItem(index, it => toggleAssignee(it, personId));
  }

  setMode(index: number, mode: SplitMode) {
    this.updateItem(index, it => setItemMode(it, mode, this.state().participantIds));
  }

  weightValue(item: Item, personId: string): number | null {
    const w = item.assignments.find(a => a.personId === personId)?.weight;
    if (w === undefined || w === 0) return null;
    return item.splitMode === 'amount' ? fromCents(w) : w;
  }

  setWeight(index: number, personId: string, raw: number | string | null) {
    this.updateItem(index, it => setItemWeight(it, personId, parseWeight(it.splitMode, raw)));
  }

  itemNote(item: Item): string {
    return splitIsBalanced(item) ? '' : balanceNote(item.splitMode, item.assignments, amountGapCents(item), 'this item');
  }

  claimTheRest() {
    this.state.set(assignUnclaimedTo(this.state(), ME));
  }

  // ── Tax and tip ────────────────────────────────────────────
  setTaxMode(taxMode: ChargeMode) {
    this.state.update(s => ({ ...s, charges: { ...s.charges, taxMode } }));
  }

  setTipMode(tipMode: ChargeMode) {
    this.state.update(s => ({ ...s, charges: { ...s.charges, tipMode } }));
  }

  setTipBasis(tipBasis: TipBasis) {
    this.state.update(s => ({ ...s, charges: { ...s.charges, tipBasis } }));
  }

  chargeValue(which: 'tax' | 'tip'): number | null {
    const c = this.state().charges;
    const mode = which === 'tax' ? c.taxMode : c.tipMode;
    const v = mode === 'percent'
      ? (which === 'tax' ? c.taxPercent : c.tipPercent)
      : fromCents(which === 'tax' ? c.taxCents : c.tipCents);
    return v || null;
  }

  setCharge(which: 'tax' | 'tip', raw: number | string | null) {
    const n = Number(raw);
    const v = Number.isFinite(n) && n > 0 ? n : 0;
    this.state.update(s => {
      const c = { ...s.charges };
      const mode = which === 'tax' ? c.taxMode : c.tipMode;
      if (which === 'tax') { if (mode === 'percent') c.taxPercent = Math.min(100, v); else c.taxCents = toCents(v); }
      else { if (mode === 'percent') c.tipPercent = Math.min(100, v); else c.tipCents = toCents(v); }
      return { ...s, charges: c };
    });
  }

  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }
}
