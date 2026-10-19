import { Component, computed, inject, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Account, Transaction } from '../../models';
import { TransactionService } from '../../services/transaction.service';
import { AccountService } from '../../services/account.service';
import { addsToBankBalance, handAddedTotal, isBankRow, owesMoney, pendingTotal, roundMoney } from '../../utils/finance';
import { StatementCheck, checkStatement } from '../../utils/statement-check';
import { fromCents } from '../../utils/money';
import { localDateString } from '../../utils/date';

/**
 * On an account's page: where its balance comes from, what's pending, and a
 * check of the history against a statement. A linked account's balance is
 * the bank's, so this is how you see that the transactions here add up to it.
 */
@Component({
  selector: 'app-balance-check',
  standalone: true,
  imports: [FormsModule],
  templateUrl: './balance-check.html',
  styleUrl: './balance-check.scss',
})
export class BalanceCheck {
  account = input.required<Account>();
  /** Open a transaction (a hand-added entry listed here). */
  openTx = output<Transaction>();

  private txService = inject(TransactionService);
  private accountService = inject(AccountService);

  bank = computed(() => this.account().institution || 'your bank');
  owes = computed(() => owesMoney(this.account().type));

  /** Where the balance comes from, in a sentence; `ok: false` when it needs you. */
  source = computed<{ ok: boolean; text: string } | null>(() => {
    const a = this.account();
    if (!a.plaidAccountId) return null;
    const bank = this.bank();
    if (a.plaidBalance == null || !a.plaidBalanceAt) {
      return { ok: false, text: `${bank} hasn't sent this account's balance yet, so it's worked out from the opening balance. Sync on Accounts; if this stays, open Manage accounts on ${bank} and make sure this account is ticked.` };
    }
    const sameLink = this.accountService.accounts().filter(o => !o.archived && o.plaidItemId === a.plaidItemId && o.plaidBalanceAt);
    const latest = Math.max(...sameLink.map(o => o.plaidBalanceAt!));
    if (latest - a.plaidBalanceAt > 6 * 3_600_000) {
      return { ok: false, text: `${bank} stopped sending this account after ${this.shortTime(a.plaidBalanceAt)}. If its number changed, open Manage accounts on ${bank} and tick it.` };
    }
    return { ok: true, text: `The balance is ${bank}'s, as of ${this.shortTime(a.plaidBalanceAt)}.` };
  });

  /** Money still pending: out is positive. Not in the balance until it posts. */
  pending = computed(() => pendingTotal(this.txService.transactions(), this.account().id!));
  pendingCount = computed(() => this.txService.transactions().filter(t => t.plaidPending && t.accountId === this.account().id).length);
  /**
   * Entries you added by hand on this account, newest first. A recent one
   * counts on top of the bank's balance (the bank may not have it yet); an
   * older one is already in it, usually something Plaid never sent.
   */
  handAddedRows = computed(() => {
    const a = this.account();
    if (a.plaidBalance == null) return [];
    return this.txService.transactions()
      .filter(t => !isBankRow(t) && (t.accountId === a.id || t.fromAccountId === a.id || t.toAccountId === a.id))
      .sort((x, y) => y.date.localeCompare(x.date))
      .map(t => ({ t, onTop: addsToBankBalance(t, a), moneyIn: this.moneyIn(t) }));
  });
  /** What the recent ones add on top: money out positive, in negative. */
  handAdded = computed(() => this.account().plaidBalance == null ? 0 : handAddedTotal(this.txService.transactions(), this.account()));
  showHandAdded = signal(false);

  private moneyIn(t: Transaction): boolean {
    const id = this.account().id;
    return t.type === 'income' || (t.type === 'transfer' && t.toAccountId === id);
  }

  /** The balance once everything pending posts. */
  afterPending = computed(() => {
    const a = this.account();
    const now = this.txService.balanceForAccount(a.id!);
    const opening = a.openingBalance || 0;
    const balance = this.owes() ? opening - now : opening + now;
    return roundMoney(this.owes() ? balance + this.pending() : balance - this.pending());
  });

  /** The bank's last statement, when it reports one (cards with statement data). */
  lastStatement = computed<{ date: string; amount: number; check: StatementCheck } | null>(() => {
    const a = this.account();
    if (a.plaidBalance == null || a.statementBalance == null || !a.statementIssueDate) return null;
    return {
      date: a.statementIssueDate, amount: a.statementBalance,
      check: checkStatement(a, this.txService.transactions(), a.statementIssueDate, a.statementBalance),
    };
  });

  // ── Check against a statement you have ──
  checkDate = signal(this.lastMonthEnd());
  checkAmount = signal<number | null>(null);
  result = computed<StatementCheck | null>(() => {
    const amount = this.checkAmount();
    const date = this.checkDate();
    if (amount == null || !date) return null;
    return checkStatement(this.account(), this.txService.transactions(), date, Number(amount));
  });

  /** A sentence for a check's outcome. */
  verdict(check: StatementCheck, date: string): string {
    if (check.matches) return `They match: every transaction here from ${this.long(date)} to today adds up.`;
    const gap = this.money(fromCents(Math.abs(check.diffCents)));
    // The app walks back from today's balance, so a gap is in the rows since
    // that day. For money you have, the statement saying more means the app
    // took too much off on the way back: a charge missing here, or money in
    // counted twice. For a card (what you owe) it's the other way round.
    const missingCharge = (check.diffCents > 0) !== this.owes();
    const [missing, twice] = missingCharge ? ['a charge', 'money in'] : ['money in', 'a charge'];
    return `${gap} apart. Since ${this.long(date)}, ${missing} is likely missing here, or ${twice} counted twice. Check that stretch on Transactions.`;
  }

  short(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  money(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  long(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }

  private shortTime(t: number): string {
    return new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }

  private lastMonthEnd(): string {
    const today = new Date(localDateString() + 'T00:00:00');
    return localDateString(new Date(today.getFullYear(), today.getMonth(), 0));
  }
}
