import { Injectable, computed, inject } from '@angular/core';
import { Transaction } from '../models';
import { TransactionService } from './transaction.service';
import { GroupService } from './group.service';
import { SharedBillService } from './shared-bill.service';
import { groupLedger } from '../utils/groups';
import { balancesByPerson, totalOwedCents, totalYouOweCents, withGroups } from '../utils/shared';

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
   * Each person's total with you, the way Splitwise shows a friend: bills
   * outside groups, plus what each group's settle-up plan has them paying you
   * (or you paying them).
   */
  readonly balances = computed(() => withGroups(
    balancesByPerson(this.txService.transactions(), t => this.txService.moneyBackEntriesFor(t), this.inGroup,
      this.sharedBills.bills().filter(b => !this.groups.byId(b.split.groupId))),
    this.ledgers().map(({ group, ledger }) => ({ groupId: group.id!, name: group.name, plan: ledger.plan })),
  ));

  /** What everyone owes you, added up. */
  readonly owedToMeCents = computed(() => totalOwedCents(this.balances()));
  /** What you owe, added up: a positive number. */
  readonly youOweCents = computed(() => totalYouOweCents(this.balances()));
}
