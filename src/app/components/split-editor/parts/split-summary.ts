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
        <span class="form-section-title">Shares</span>
        <span class="summary-bill">Bill <span class="fig">{{ money(status().billTotalCents) }}</span></span>
      </div>
      @for (r of rows(); track r.id) {
        <div class="summary-row">
          <div class="summary-who">
            <span class="summary-name">{{ people.nameOf(r.id) }}</span>
            <span class="summary-note">{{ r.note }}</span>
          </div>
          <span class="summary-amount fig">{{ money(r.shareCents) }}</span>
        </div>
      }
      @if (status().owedToMeCents > 0) {
        <div class="summary-foot">
          <span>Owed back to you</span>
          <span class="fig">{{ money(status().owedToMeCents) }}</span>
        </div>
        <p class="summary-total">
          Until it's paid back, you're out of pocket the whole <span class="fig">{{ money(myPaidCents()) }}</span>.
        </p>
      }
      @for (t of otherTransfers(); track t.fromPersonId + t.toPersonId) {
        <p class="summary-total">{{ people.nameOf(t.fromPersonId) }} owes {{ people.nameOf(t.toPersonId) }} {{ money(t.amountCents) }} — between them.</p>
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

  /** One line per person, you first: their share, and a short note on what it means. */
  rows = computed(() => {
    const s = this.status();
    const itemized = this.split().mode === 'itemized';
    // Item by item, what the share is made of — counted, not listed, so a long
    // dish name doesn't repeat down every row.
    const made = (personId: string): string[] => {
      if (!itemized) return [];
      const p = s.summary.perPerson.find(x => x.personId === personId);
      if (!p || p.totalCents === 0) return [];
      return [
        `${p.lines.length} item${p.lines.length === 1 ? '' : 's'}`,
        p.taxCents ? `tax & fees ${this.money(p.taxCents)}` : '',
        p.tipCents ? `tip ${this.money(p.tipCents)}` : '',
      ].filter(Boolean);
    };
    const note = (parts: string[]) => parts.filter(Boolean).join(' · ');

    const mine = s.summary.perPerson.find(p => p.personId === ME);
    const me = this.split().participantIds.includes(ME) || (mine?.paidCents ?? 0) > 0
      ? [{ id: ME, shareCents: s.myShareCents, note: note([`You paid ${this.money(s.myPaidCents)}`, ...made(ME)]) }]
      : [];
    return [
      ...me,
      ...s.people.map(p => {
        const owes = p.dueToMeCents > 0
          ? (p.paidCents > 0 ? `Paid ${this.money(p.paidCents)} · owes you ${this.money(p.dueToMeCents)}` : 'Owes you')
          : p.paidCents > 0 ? `Paid ${this.money(p.paidCents)}` : p.shareCents === 0 ? 'Nothing to pay' : '';
        return { id: p.personId, shareCents: p.shareCents, note: note([owes, ...made(p.personId)]) };
      }),
    ];
  });

  /** Friend-to-friend settling, when someone else paid more than their share. */
  otherTransfers = computed(() =>
    this.status().transfers.filter(t => t.toPersonId !== ME && t.fromPersonId !== ME));

  money(cents: number): string {
    return cents < 0 ? `−${formatCurrency(fromCents(-cents))}` : formatCurrency(fromCents(cents));
  }
}
