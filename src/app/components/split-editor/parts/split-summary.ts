import { Component, computed, inject, input } from '@angular/core';
import { ME, TransactionSplit } from '../../../models';
import { PersonService } from '../../../services/person.service';
import { formatCurrency } from '../../../utils/format';
import { fromCents } from '../../../utils/money';
import { splitStatus } from '../../../utils/splits';

/**
 * What a split comes to: the bill, each person's share (and, item by item,
 * what's in it), and who owes you what. Every figure is read off the engine's
 * result — nothing here adds money up.
 */
@Component({
  selector: 'app-split-summary',
  standalone: true,
  template: `
    <div class="summary">
      <div class="summary-head">
        <span class="form-section-title">Bill</span>
        <span class="fig">{{ money(status().billTotalCents) }}</span>
      </div>
      @for (r of rows(); track r.id) {
        <div class="summary-row">
          <span class="summary-name">{{ people.nameOf(r.id) }}</span>
          <span class="summary-detail">
            @if (r.paidCents > 0) { paid <span class="fig">{{ money(r.paidCents) }}</span> · }
            share <span class="fig">{{ money(r.shareCents) }}</span>
          </span>
          <span class="summary-owes fig">
            @if (r.owesMeCents > 0) { owes you {{ money(r.owesMeCents) }} }
          </span>
          @if (r.detail) { <span class="summary-items">{{ r.detail }}</span> }
        </div>
      }
      @for (t of otherTransfers(); track t.fromPersonId + t.toPersonId) {
        <p class="field-hint">{{ people.nameOf(t.fromPersonId) }} owes {{ people.nameOf(t.toPersonId) }} {{ money(t.amountCents) }} — between them.</p>
      }
      @if (status().owedToMeCents > 0) {
        <p class="summary-total">
          <span class="fig">{{ money(status().owedToMeCents) }}</span> is owed back to you. Until it is,
          you're out of pocket the whole <span class="fig">{{ money(myPaidCents()) }}</span>.
        </p>
      }
    </div>
  `,
  styleUrl: './split-parts.scss',
})
export class SplitSummary {
  people = inject(PersonService);

  split = input.required<TransactionSplit>();
  /** What you paid: the transaction amount, in cents. */
  myPaidCents = input.required<number>();

  status = computed(() => splitStatus(this.split()));

  /** One line per person, you first; item by item, what their share is made of. */
  rows = computed(() => {
    const s = this.status();
    const itemized = this.split().mode === 'itemized';
    const detail = (personId: string) => {
      if (!itemized) return '';
      const p = s.summary.perPerson.find(x => x.personId === personId);
      if (!p || p.totalCents === 0) return '';
      const items = p.lines.map(l => l.shareLabel === 'full' ? l.itemName : `${l.itemName} (${l.shareLabel})`);
      const charges = [
        p.taxCents ? `tax ${this.money(p.taxCents)}` : '',
        p.tipCents ? `tip ${this.money(p.tipCents)}` : '',
      ].filter(Boolean);
      return [items.join(', '), ...charges].filter(Boolean).join(' · ');
    };
    const mine = s.summary.perPerson.find(p => p.personId === ME);
    const me = this.split().participantIds.includes(ME) || (mine?.paidCents ?? 0) > 0
      ? [{ id: ME, shareCents: s.myShareCents, paidCents: s.myPaidCents, owesMeCents: 0, detail: detail(ME) }]
      : [];
    return [
      ...me,
      ...s.people.map(p => ({
        id: p.personId, shareCents: p.shareCents, paidCents: p.paidCents, owesMeCents: p.dueToMeCents, detail: detail(p.personId),
      })),
    ];
  });

  /** Friend-to-friend settling, when someone else paid more than their share. */
  otherTransfers = computed(() =>
    this.status().transfers.filter(t => t.toPersonId !== ME && t.fromPersonId !== ME));

  money(cents: number): string {
    return formatCurrency(fromCents(cents));
  }
}
