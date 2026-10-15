import { Injectable, computed, inject } from '@angular/core';
import { Transaction } from '../models';
import { TransactionService } from './transaction.service';
import { GroupService } from './group.service';
import { SharedBillService } from './shared-bill.service';
import { PersonService } from './person.service';
import { groupLedger } from '../utils/groups';
import { PaidOut, balancesByPerson, totalOwedCents, totalYouOweCents, withGroups } from '../utils/shared';
import { toCents } from '../utils/money';

/**
 * Who owes whom right now, across every split bill and every group: the
 * Shared page's figures, worked out once so Analysis and Reports show exactly
 * the same "Owed to you" and "You owe". No Firebase of its own; it reads the
 * services that hold the data. The maths is utils/shared.ts and utils/groups.ts.
 */
@Injectable({ providedIn: 'root' })
export class SharedBalanceService {
  private txService = inject(TransactionService);
  private groups = inject(GroupService);
  private sharedBills = inject(SharedBillService);
  private people = inject(PersonService);

  /** Bills in a group that still exists are settled with the group, not one by one. */
  readonly inGroup = (t: Transaction) => !!this.groups.byId(t.split?.groupId);

  /** Every group's ledger. */
  readonly ledgers = computed(() => this.groups.groups()
    .filter(g => g.id)
    .map(g => ({
      group: g,
      ledger: groupLedger(g as typeof g & { id: string }, this.txService.transactions(), this.sharedBills.bills(),
        t => this.txService.moneyBackEntriesFor(t)),
    })));

  /**
   * What you've paid people outside groups: bank payments (an expense marked
   * as settling up with them, not in a group that still exists) and cash
   * recorded on the person.
   */
  readonly paidOut = computed<PaidOut[]>(() => [
    ...this.txService.transactions()
      .filter(t => t.type === 'expense' && t.settlement && !this.groups.byId(t.settlement.groupId))
      .map(t => ({ personId: t.settlement!.personId, amountCents: toCents(t.amount), date: t.date, txId: t.id })),
    ...this.people.people().flatMap(p => (p.payments ?? []).map(x => ({
      personId: p.id!, amountCents: x.amountCents, date: x.date, paymentId: x.id, ...(x.note ? { note: x.note } : {}),
    }))),
  ]);

  /**
   * Each person's total with you, the way Splitwise shows a friend: bills
   * outside groups, plus what each group's settle-up plan has them paying you
   * (or you paying them).
   */
  readonly balances = computed(() => withGroups(
    balancesByPerson(this.txService.transactions(), t => this.txService.moneyBackEntriesFor(t), this.inGroup,
      this.sharedBills.bills().filter(b => !this.groups.byId(b.split.groupId)), this.paidOut()),
    this.ledgers().map(({ group, ledger }) => ({ groupId: group.id!, name: group.name, plan: ledger.plan })),
  ));

  /** What everyone owes you, added up. */
  readonly owedToMeCents = computed(() => totalOwedCents(this.balances()));
  /** What you owe, added up: a positive number. */
  readonly youOweCents = computed(() => totalYouOweCents(this.balances()));
}
