import { Component, computed, inject, input, model, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ME } from '../../models';
import { PersonService } from '../../services/person.service';
import { ToastService } from '../../services/toast.service';
import { formatCurrency } from '../../utils/format';
import { fromCents, toCents } from '../../utils/money';
import { amountGapCents, splitIsBalanced } from '../../utils/split/split';
import type { SplitMode } from '../../utils/split/types';
import {
  QuickSplitState, buildQuickSplit, quickBillCents, restateWeights, splitProblems, splitStatus,
} from '../../utils/splits';

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
  imports: [FormsModule],
  templateUrl: './split-editor.html',
  styleUrl: './split-editor.scss',
})
export class SplitEditor {
  private personService = inject(PersonService);
  private toast = inject(ToastService);

  /** What you paid: the transaction amount, in cents. */
  myPaidCents = input.required<number>();
  state = model.required<QuickSplitState>();

  readonly ME = ME;
  readonly modes: { value: SplitMode; label: string }[] = [
    { value: 'equal', label: 'Equally' },
    { value: 'shares', label: 'Shares' },
    { value: 'percent', label: 'Percent' },
    { value: 'amount', label: 'Amounts' },
  ];

  // ── Derived, all from the engine ───────────────────────────
  billCents = computed(() => quickBillCents(this.state(), this.myPaidCents()));
  split = computed(() => buildQuickSplit(this.state(), this.myPaidCents()));
  status = computed(() => splitStatus(this.split()));
  problems = computed(() => splitProblems(this.split(), this.myPaidCents()));
  includesMe = computed(() => this.state().participantIds.includes(ME));
  others = computed(() => this.state().participantIds.filter(id => id !== ME));

  /** Percentages or amounts that don't add up — still divided in proportion, but say so. */
  balanceNote = computed(() => {
    const item = this.split().items[0];
    if (!item || splitIsBalanced(item)) return '';
    const mode = this.state().mode;
    if (mode === 'percent') {
      const total = item.assignments.reduce((s, a) => s + a.weight, 0);
      return `These add up to ${Math.round(total * 100) / 100}%, not 100%. It's divided in proportion until they do.`;
    }
    if (mode === 'amount') {
      const gap = amountGapCents(item);
      return gap > 0
        ? `${this.money(gap)} isn't assigned to anyone yet. It's divided in proportion until it is.`
        : `That's ${this.money(-gap)} more than the bill. It's divided in proportion until it adds up.`;
    }
    return '';
  });

  /** One line per person, in the order they were added, you first. */
  rows = computed(() => {
    const s = this.status();
    const mine = s.summary.perPerson.find(p => p.personId === ME);
    const me = this.includesMe() || (mine?.paidCents ?? 0) > 0
      ? [{ id: ME, shareCents: s.myShareCents, paidCents: s.myPaidCents, owesMeCents: 0 }]
      : [];
    return [
      ...me,
      ...s.people.map(p => ({ id: p.personId, shareCents: p.shareCents, paidCents: p.paidCents, owesMeCents: p.dueToMeCents })),
    ];
  });

  /** Friend-to-friend settling, when someone else paid more than their share. */
  otherTransfers = computed(() =>
    this.status().transfers.filter(t => t.toPersonId !== ME && t.fromPersonId !== ME));

  // ── People ─────────────────────────────────────────────────
  newName = signal('');
  adding = signal(false);

  /** Saved people not on this bill yet, narrowed by what's typed. */
  suggestions = computed(() => {
    const on = new Set(this.state().participantIds);
    const q = this.newName().trim().toLowerCase();
    return this.personService.people()
      .filter(p => p.id && !on.has(p.id) && (!q || p.name.toLowerCase().includes(q)))
      .slice(0, 8);
  });

  name(id: string): string {
    if (id === ME) return 'You';
    return this.personService.people().find(p => p.id === id)?.name ?? 'Someone';
  }

  toggleMe() {
    this.setParticipants(this.includesMe()
      ? this.state().participantIds.filter(id => id !== ME)
      : [ME, ...this.state().participantIds]);
  }

  include(id: string) {
    if (this.state().participantIds.includes(id)) return;
    this.setParticipants([...this.state().participantIds, id]);
    this.newName.set('');
  }

  remove(id: string) {
    this.setParticipants(this.state().participantIds.filter(x => x !== id));
    this.state.update(s => ({ ...s, otherPayments: s.otherPayments.filter(p => p.personId !== id) }));
  }

  /** Add by name: someone already saved is reused, anyone new is saved for next time. */
  async addByName() {
    const name = this.newName().trim();
    if (!name || this.adding()) return;
    const known = this.personService.people().find(p => p.name.trim().toLowerCase() === name.toLowerCase());
    if (known?.id) { this.include(known.id); return; }
    this.adding.set(true);
    try {
      this.include(await this.personService.add({ name }));
    } catch {
      this.toast.error(`Could not save ${name}. Please try again.`);
    } finally {
      this.adding.set(false);
    }
  }

  private setParticipants(ids: string[]) {
    this.state.update(s => {
      const weights = { ...s.weights };
      // Someone new starts with an even share, or nothing where it has to be typed.
      for (const id of ids) if (!(id in weights)) weights[id] = s.mode === 'shares' ? 1 : 0;
      return { ...s, participantIds: ids, weights };
    });
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
    const n = Number(value);
    const clean = Number.isFinite(n) && n > 0 ? n : 0;
    const weight = this.state().mode === 'amount' ? toCents(clean) : clean;
    this.state.update(s => ({ ...s, weights: { ...s.weights, [id]: weight } }));
  }

  // ── Who else paid ──────────────────────────────────────────
  othersPaid = computed(() => this.state().otherPayments.length > 0);

  toggleOthersPaid() {
    if (this.othersPaid()) {
      this.state.update(s => ({ ...s, otherPayments: [] }));
    } else {
      const first = this.others()[0];
      if (!first) { this.toast.error('Add the people you split with first.'); return; }
      this.state.update(s => ({ ...s, otherPayments: [{ personId: first, amountCents: 0 }] }));
    }
  }

  /** People who could still be added as a payer. */
  payerChoices(current: string): string[] {
    const taken = new Set(this.state().otherPayments.map(p => p.personId));
    return this.others().filter(id => id === current || !taken.has(id));
  }

  addPayer() {
    const next = this.payerChoices('').find(Boolean);
    if (!next) return;
    this.state.update(s => ({ ...s, otherPayments: [...s.otherPayments, { personId: next, amountCents: 0 }] }));
  }

  setPayer(index: number, personId: string) {
    this.state.update(s => ({
      ...s, otherPayments: s.otherPayments.map((p, i) => i === index ? { ...p, personId } : p),
    }));
  }

  payerValue(cents: number): number | null {
    return cents ? fromCents(cents) : null;
  }

  setPayerAmount(index: number, value: number | string | null) {
    const n = Number(value);
    const amountCents = Number.isFinite(n) && n > 0 ? toCents(n) : 0;
    this.state.update(s => ({
      ...s, otherPayments: s.otherPayments.map((p, i) => i === index ? { ...p, amountCents } : p),
    }));
  }

  removePayer(index: number) {
    this.state.update(s => ({ ...s, otherPayments: s.otherPayments.filter((_, i) => i !== index) }));
  }

  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }
}
