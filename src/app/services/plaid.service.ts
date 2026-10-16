import { Injectable, inject, signal, NgZone, effect, untracked } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { TransactionService } from './transaction.service';
import { ReconciliationService } from './reconciliation.service';
import { ToastService } from './toast.service';
import { EncryptionService } from './encryption.service';
import { localDateString } from '../utils/date';
import { Account, AccountType } from '../models';
import { accountForPlaidId, linkedTwice, moveToLink, replacementCandidates, sameBankAccount } from '../utils/plaid-accounts';

/** A linked bank (Plaid item). Metadata is plaintext; the access token is not stored here. */
export interface PlaidItem {
  itemId: string;
  institutionName: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  lastError?: string;
  /** Plaid reported an account the user hasn't shared yet (NEW_ACCOUNTS_AVAILABLE): a replaced card, say. */
  newAccountsAvailable?: boolean;
  /** The bank's accounts (balances, card statements) as of its last sync, encrypted to your key. */
  accountsSnapshot?: Record<string, unknown>;
  accountsSnapshotAt?: number;
}

/** A Plaid account newly shared on a bank that already has accounts here: new, or a replaced card? */
export interface PendingPlaidAccount {
  itemId: string;
  institutionName: string;
  plaid: PlaidAccount;
  /** Accounts it might be replacing, the ones Plaid stopped reporting first. */
  candidates: { account: Account; stale: boolean }[];
}

/** An account under a Plaid item, as returned by the getPlaidAccounts callable. */
export interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  credit_limit: number | null;
  minimum_payment: number | null;
  payment_due_day: number | null;
  statement_closing_day: number | null;
  statement_balance: number | null;
  payment_due_date: string | null;
  statement_issue_date: string | null;
  last_payment_date: string | null;
  last_payment_amount: number | null;
  is_overdue: boolean | null;
}

/** Plaid error codes that mean signing in to the bank again (matches the server's list). */
const REAUTH_CODES = new Set(['ITEM_LOGIN_REQUIRED', 'PENDING_EXPIRATION', 'USER_PERMISSION_REVOKED', 'USER_ACCOUNT_REVOKED', 'PENDING_DISCONNECT']);

/** Map a Plaid account type/subtype onto an app AccountType. */
function mapPlaidAccountType(type: string, subtype: string | null): AccountType {
  if (type === 'credit') return 'credit';
  if (type === 'investment') return 'investment';
  // Car loans, mortgages, student loans: a debt. They used to fall through to
  // 'checking', which counted what you owe as money you have.
  if (type === 'loan') return 'loan';
  if (type === 'depository') {
    if (subtype === 'savings') return 'savings';
    return 'checking';
  }
  return 'checking';
}

// Plaid Link is loaded from Plaid's CDN at runtime (no npm package for the
// browser SDK), so it attaches itself to window.Plaid.
const PLAID_LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface CreateLinkTokenResult {
  link_token: string;
  expiration: string;
}

interface ExchangeTokenResult {
  itemId: string;
  institutionName: string;
}

interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  failed: { itemId: string; institutionName: string; status: string }[];
}

@Injectable({ providedIn: 'root' })
export class PlaidService {
  private functions = inject(Functions);
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private accountSvc = inject(AccountService);
  private txService = inject(TransactionService);
  private reconcileSvc = inject(ReconciliationService);
  private toast = inject(ToastService);
  private ngZone = inject(NgZone);
  private encryption = inject(EncryptionService);

  /** True while we are minting a link token / opening Link. */
  connecting = signal(false);

  /** True while a manual transaction sync is running. */
  syncing = signal(false);

  /** item_id currently being disconnected (for per-row button state). */
  disconnectingId = signal<string | null>(null);

  /** item_id currently going through re-auth (Plaid Link update mode). */
  reauthenticatingId = signal<string | null>(null);

  /** True while an on-demand institution refresh is in flight. */
  refreshing = signal(false);

  /**
   * Accounts Plaid started sharing on a bank that already had some here.
   * Rather than quietly adding a second card, the Accounts page asks whether
   * each replaces one you have (so its history carries on) or is new.
   */
  pendingNewAccounts = signal<PendingPlaidAccount[]>([]);

  /** Live list of linked banks (Plaid items). Metadata is plaintext, so no unlock needed. */
  private items$: Observable<PlaidItem[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of<PlaidItem[]>([]);
      const q = query(collection(this.db, `users/${user.uid}/plaidItems`), orderBy('createdAt', 'asc'));
      return new Observable<PlaidItem[]>(sub => {
        const unsub = onSnapshot(
          q,
          snap => this.ngZone.run(() => sub.next(snap.docs.map(d => ({ itemId: d.id, ...(d.data() as any) })))),
          () => this.ngZone.run(() => sub.next([])),
        );
        return unsub;
      });
    }),
  );
  linkedItems = toSignal(this.items$, { initialValue: [] as PlaidItem[] });

  /** Each bank's snapshot already applied, by item id, so it's applied once. */
  private appliedSnapshots = new Map<string, number>();
  private applyingSnapshots = false;
  private repairedPending = false;

  constructor() {
    // Background sync: the server saves each bank's balances and card
    // statements beside it whenever it syncs (webhook, schedule, or Sync).
    // Apply them as they arrive, so nothing waits for you to press Sync.
    effect(() => {
      const items = this.linkedItems();
      const ready = this.encryption.unlocked() && this.accountSvc.loaded();
      if (!ready) return;
      const fresh = items.filter(i => i.accountsSnapshot && (i.accountsSnapshotAt ?? 0) > (this.appliedSnapshots.get(i.itemId) ?? 0));
      if (fresh.length) untracked(() => void this.applySnapshots(fresh));
    });
    // Rows stuck as pending from before pending charges posted into the same row.
    effect(() => {
      const txs = this.txService.transactions();
      if (this.repairedPending || !this.encryption.unlocked() || txs.length === 0) return;
      this.repairedPending = true;
      untracked(() => void this.repairStuckPending());
    });
  }

  private async applySnapshots(items: PlaidItem[]): Promise<void> {
    if (this.applyingSnapshots) return;
    this.applyingSnapshots = true;
    try {
      for (const item of items) {
        const at = item.accountsSnapshotAt ?? 0;
        try {
          const { accounts } = await this.encryption.decryptDoc<{ accounts: PlaidAccount[] }>(item.accountsSnapshot!);
          await this.setupAccountsForItem(item.itemId, item.institutionName, accounts);
        } catch (err) {
          console.error('Could not apply the bank snapshot for', item.institutionName, err);
        }
        this.appliedSnapshots.set(item.itemId, at);
      }
      await this.foldLinkedTwice();
      await this.reconcileSvc.cleanupReconciled();
    } finally {
      this.applyingSnapshots = false;
    }
  }

  /**
   * Before a pending charge posted into the same row, a row you'd edited while
   * pending kept its pending copy and never got the posted one, so old
   * transactions still read Pending. Ask the server to find each one's posted
   * version; anything it can't find that's over two weeks old has posted
   * long since (no hold lasts that long), so it stops being pending.
   */
  private async repairStuckPending(): Promise<void> {
    const cutoff = new Date(localDateString() + 'T00:00:00');
    cutoff.setDate(cutoff.getDate() - 5);
    const stale = localDateString(cutoff);
    const stuck = this.txService.transactions().filter(t => t.plaidPending && t.plaidTransactionId && t.id && t.date < stale);
    if (stuck.length === 0) return;
    try {
      const repair = httpsCallable<
        { rows: { docId: string; plaidTransactionId: string; date: string }[] },
        { fixed: number; unresolved: string[] }
      >(this.functions, 'repairPendingTransactions');
      const { data } = await repair({ rows: stuck.map(t => ({ docId: t.id!, plaidTransactionId: t.plaidTransactionId!, date: t.date })) });
      const longAgo = new Date(localDateString() + 'T00:00:00');
      longAgo.setDate(longAgo.getDate() - 14);
      const old = localDateString(longAgo);
      const settle = stuck.filter(t => data.unresolved.includes(t.id!) && t.date < old).map(t => t.id!);
      if (settle.length) await this.txService.updateMany(settle, { plaidPending: false });
      if (data.fixed + settle.length > 0) {
        this.toast.info(`${data.fixed + settle.length} old transaction${data.fixed + settle.length === 1 ? ' was' : 's were'} still marked pending; ${data.fixed + settle.length === 1 ? 'it has' : 'they have'} posted, and your edits stay.`);
      }
    } catch (err) {
      // Not deployed yet, or offline: tried again next time the app opens.
      console.warn('Pending repair skipped:', err);
    }
  }

  private scriptPromise: Promise<void> | null = null;

  /** Lazy-load the Plaid Link script once and reuse it afterwards. */
  private loadLinkScript(): Promise<void> {
    if ((window as any).Plaid) return Promise.resolve();
    if (this.scriptPromise) return this.scriptPromise;

    this.scriptPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement('script');
      script.src = PLAID_LINK_SRC;
      script.async = true;
      script.onload = () => resolve();
      script.onerror = () => {
        this.scriptPromise = null; // allow a retry on next attempt
        reject(new Error('Could not load Plaid Link. Check your connection and try again.'));
      };
      document.head.appendChild(script);
    });

    return this.scriptPromise;
  }

  /**
   * Open Plaid Link so the user can connect a bank. On success we exchange the
   * public_token for a stored access token via the backend, which links the
   * bank for future syncs.
   */
  async connectBank(daysRequested?: number): Promise<void> {
    if (this.connecting()) return;
    this.connecting.set(true);

    try {
      await this.loadLinkScript();

      const createLinkToken = httpsCallable<{ days_requested?: number }, CreateLinkTokenResult>(
        this.functions,
        'createLinkToken',
      );
      const { data } = await createLinkToken({ days_requested: daysRequested });

      const handler = (window as any).Plaid.create({
        token: data.link_token,
        // Plaid invokes these callbacks outside Angular's zone, so wrap UI work
        // in ngZone.run so toasts/change detection fire reliably.
        onSuccess: (publicToken: string, metadata: any) => {
          this.ngZone.run(() => this.exchange(publicToken, metadata));
        },
        onExit: (err: any) => {
          this.ngZone.run(() => {
            if (err) {
              console.error('Plaid Link exit error:', err);
              this.toast.error(err.display_message || err.error_message || 'Bank connection cancelled.');
            }
          });
        },
      });

      handler.open();
    } catch (err: any) {
      console.error('connectBank failed:', err);
      this.toast.error(err?.message || 'Could not start bank connection. Please try again.');
    } finally {
      this.connecting.set(false);
    }
  }

  /** Send the public_token to the backend to be exchanged and stored. */
  private async exchange(publicToken: string, metadata: any): Promise<void> {
    const institutionName = metadata?.institution?.name || 'your bank';
    try {
      const exchangeToken = httpsCallable<
        { public_token: string; institution_name: string },
        ExchangeTokenResult
      >(this.functions, 'exchangePublicToken');
      const { data } = await exchangeToken({
        public_token: publicToken,
        institution_name: institutionName,
      });
      // Auto-create app accounts for this bank so synced transactions have a home.
      await this.setupAccountsForItem(data.itemId, data.institutionName);
      this.toast.success(`${data.institutionName} connected. Your bank is now linked.`);
    } catch (err: any) {
      console.error('exchangePublicToken failed:', err);
      this.toast.error(`Connected to ${institutionName}, but saving the link failed. Please try again.`);
    }
  }

  /**
   * Create an app account for each Plaid account under an item (idempotent: skips
   * any Plaid account already linked to an app account). Runs client-side so the
   * accounts are encrypted with the user's key like all other app data.
   */
  private async setupAccountsForItem(itemId: string, institutionName: string, known?: PlaidAccount[]): Promise<void> {
    try {
      // From the bank's saved snapshot when there is one; else ask the server.
      const data = known ? { accounts: known } : (await httpsCallable<{ item_id: string }, { accounts: PlaidAccount[] }>(
        this.functions,
        'getPlaidAccounts',
      )({ item_id: itemId })).data;
      const existing = this.accountSvc.accounts();
      // A bank linked before has its accounts already: anything new on it is
      // asked about (a replaced card?) instead of being added as a second card.
      // That includes the same bank linked a second time.
      const askAboutNew = existing.some(acc =>
        acc.plaidItemId === itemId || (!!acc.plaidItemId && !acc.archived && acc.institution === institutionName));
      const returnedIds = data.accounts.map(a => a.account_id);
      const claimed = new Set(existing.filter(acc => returnedIds.includes(acc.plaidAccountId ?? '')).map(acc => acc.id!));

      for (const a of data.accounts) {
        const match = existing.find(acc => acc.plaidAccountId === a.account_id);
        // An id an account has moved on from (a replaced card the bank still
        // reports, or the old link of a bank linked again): already handled.
        if (!match && accountForPlaidId(existing, a.account_id)) continue;
        // The same account (bank, kind, last 4) on an id the bank stopped
        // using: it carries on in the account you have, never a second copy.
        const type = mapPlaidAccountType(a.type, a.subtype);
        const same = match ? undefined : sameBankAccount(existing, institutionName, itemId, type, a.mask, returnedIds, claimed);
        if (same?.id) {
          claimed.add(same.id);
          await this.accountSvc.update(same.id, {
            ...moveToLink(same, a.account_id, itemId),
            ...(a.current_balance != null ? { plaidBalance: a.current_balance, plaidBalanceAt: Date.now() } : {}),
          });
          continue;
        }
        if (match) {
          // Already created, so backfill any credit-card fields Plaid now reports
          // that we didn't have yet (covers accounts created before these fields
          // existed, or before Liabilities was granted for this item).
          const patch: Partial<Account> = {};
          if (!match.creditLimit && a.credit_limit) patch.creditLimit = a.credit_limit;
          if (!match.statementClosingDay && a.statement_closing_day) patch.statementClosingDay = a.statement_closing_day;
          // Dynamic liability fields change every statement cycle, so always refresh
          // to Plaid's latest (unlike the static fields above, which only backfill).
          // These come from Plaid for a linked card; a user wouldn't hand-edit them.
          if (a.minimum_payment != null && a.minimum_payment !== match.minimumPayment) patch.minimumPayment = a.minimum_payment;
          if (a.payment_due_day != null && a.payment_due_day !== match.paymentDueDay) patch.paymentDueDay = a.payment_due_day;
          if (a.statement_balance != null && a.statement_balance !== match.statementBalance) patch.statementBalance = a.statement_balance;
          if (a.payment_due_date && a.payment_due_date !== match.paymentDueDate) patch.paymentDueDate = a.payment_due_date;
          if (a.statement_issue_date && a.statement_issue_date !== match.statementIssueDate) patch.statementIssueDate = a.statement_issue_date;
          if (a.last_payment_date && a.last_payment_date !== match.lastPaymentDate) patch.lastPaymentDate = a.last_payment_date;
          if (a.last_payment_amount != null && a.last_payment_amount !== match.lastPaymentAmount) patch.lastPaymentAmount = a.last_payment_amount;
          if (a.is_overdue != null && a.is_overdue !== match.statementOverdue) patch.statementOverdue = a.is_overdue;
          // A loan account created before 'loan' existed came in as checking.
          if (a.type === 'loan' && match.type !== 'loan') patch.type = 'loan';
          // The bank's balance is the balance (see openingBalanceFor), read fresh
          // every sync. It replaced a one-time seed of the opening balance, which
          // went wrong whenever more history arrived later (a relink sends it all
          // again).
          if (a.current_balance != null) {
            patch.plaidBalance = a.current_balance;
            patch.plaidBalanceAt = Date.now();
          }
          if (Object.keys(patch).length > 0 && match.id) await this.accountSvc.update(match.id, patch);
          continue;
        }
        if (askAboutNew) {
          this.pendingNewAccounts.update(list => list.some(p => p.plaid.account_id === a.account_id) ? list : [...list, {
            itemId, institutionName, plaid: a,
            candidates: replacementCandidates(existing, itemId, type, returnedIds, institutionName),
          }]);
          continue;
        }
        await this.createAccountFor(a, itemId, institutionName);
      }
    } catch (err) {
      // Non-fatal: the bank is still linked; transactions just won't map to an account yet.
      console.error('setupAccountsForItem failed:', err);
    }
  }

  /** An app account for one Plaid account, with whatever card details Plaid reports. */
  private async createAccountFor(a: PlaidAccount, itemId: string, institutionName: string): Promise<void> {
    const account: Omit<Account, 'id' | 'createdAt'> = {
      name: a.name || `${institutionName} ${a.mask ?? ''}`.trim(),
      type: mapPlaidAccountType(a.type, a.subtype),
      openingBalance: 0,
      currency: 'USD',
      institution: institutionName,
      ...(a.mask ? { last4: a.mask } : {}),
      ...(a.credit_limit ? { creditLimit: a.credit_limit } : {}),
      ...(a.minimum_payment ? { minimumPayment: a.minimum_payment } : {}),
      ...(a.payment_due_day ? { paymentDueDay: a.payment_due_day } : {}),
      ...(a.statement_closing_day ? { statementClosingDay: a.statement_closing_day } : {}),
      ...(a.statement_balance != null ? { statementBalance: a.statement_balance } : {}),
      ...(a.payment_due_date ? { paymentDueDate: a.payment_due_date } : {}),
      ...(a.statement_issue_date ? { statementIssueDate: a.statement_issue_date } : {}),
      ...(a.last_payment_date ? { lastPaymentDate: a.last_payment_date } : {}),
      ...(a.last_payment_amount != null ? { lastPaymentAmount: a.last_payment_amount } : {}),
      ...(a.is_overdue != null ? { statementOverdue: a.is_overdue } : {}),
      ...(a.current_balance != null ? { plaidBalance: a.current_balance, plaidBalanceAt: Date.now() } : {}),
      plaidAccountId: a.account_id,
      plaidItemId: itemId,
      archived: false,
    };
    await this.accountSvc.add(account);
  }

  /**
   * Settle a newly shared account: `replaceId` makes an existing account follow
   * the new card (its history and balance carry on); null adds it as new.
   */
  async resolveNewAccount(pending: PendingPlaidAccount, replaceId: string | null): Promise<void> {
    try {
      const existing = replaceId ? this.accountSvc.accounts().find(a => a.id === replaceId) : undefined;
      if (existing?.id) {
        const p = pending.plaid;
        await this.accountSvc.update(existing.id, {
          ...moveToLink(existing, p.account_id, pending.itemId),
          ...(p.mask ? { last4: p.mask } : {}),
          ...(p.current_balance != null ? { plaidBalance: p.current_balance, plaidBalanceAt: Date.now() } : {}),
        });
        this.toast.success(`${existing.name} now follows the new card${pending.plaid.mask ? ` ••${pending.plaid.mask}` : ''}.`);
      } else {
        await this.createAccountFor(pending.plaid, pending.itemId, pending.institutionName);
        this.toast.success(`${pending.plaid.name || 'New account'} added.`);
      }
      this.pendingNewAccounts.update(list => list.filter(p => p.plaid.account_id !== pending.plaid.account_id));
    } catch (err) {
      console.error('resolveNewAccount failed:', err);
      this.toast.error('Could not save. Please try again.');
    }
  }

  /** Not now: it's asked about again on the next sync. */
  skipNewAccount(pending: PendingPlaidAccount) {
    this.pendingNewAccounts.update(list => list.filter(p => p.plaid.account_id !== pending.plaid.account_id));
  }

  /**
   * A bank linked a second time (Connect bank account rather than Manage
   * accounts) used to add every account again. Fold each copy back into the
   * account you had: it follows the new link, keeps the old link's history,
   * and anything saved against the copy moves over. The duplicate rows the
   * second link sent show up in Transactions' duplicate review.
   */
  private async foldLinkedTwice(): Promise<void> {
    for (const { keep, copies } of linkedTwice(this.accountSvc.accounts())) {
      try {
        const newest = copies[copies.length - 1];
        const earlier = copies.flatMap(c => [c.plaidAccountId!, ...(c.previousPlaidAccountIds ?? [])]);
        await this.accountSvc.update(keep.id!, {
          ...moveToLink(keep, newest.plaidAccountId!, newest.plaidItemId!, earlier),
          ...(newest.plaidBalance != null ? { plaidBalance: newest.plaidBalance, plaidBalanceAt: newest.plaidBalanceAt } : {}),
        });
        for (const copy of copies) {
          await this.txService.moveAccountReferences(copy.id!, keep.id!);
          await this.accountSvc.update(copy.id!, {
            archived: true, plaidAccountId: undefined, plaidItemId: undefined, previousPlaidAccountIds: undefined,
          });
        }
        this.toast.info(`${keep.name} was here twice. It's one account again; check Transactions for duplicates.`);
      } catch (err) {
        console.error('foldLinkedTwice failed:', err);
      }
    }
  }

  /** Ensure every linked bank has its app accounts created (covers items linked earlier). */
  private async setupAllAccounts(): Promise<void> {
    await this.foldLinkedTwice();
    for (const item of this.linkedItems()) {
      await this.setupAccountsForItem(item.itemId, item.institutionName);
    }
  }

  /**
   * Manually pull transactions from all linked banks. The server envelope-encrypts
   * each transaction to this user's public key and writes them to Firestore, where
   * the app decrypts and displays them.
   */
  async syncTransactions(): Promise<void> {
    if (this.syncing()) return;
    this.syncing.set(true);
    try {
      const sync = httpsCallable<unknown, SyncResult>(this.functions, 'syncTransactions');
      const { data } = await sync();
      // Make sure every linked bank's accounts exist (covers items linked earlier).
      await this.setupAllAccounts();
      // Remove bank rows that duplicate an already-merged manual entry.
      await this.reconcileSvc.cleanupReconciled();
      const changed = data.added + data.modified + data.removed;
      if (changed === 0) {
        this.toast.info('Already up to date. No new transactions.');
      } else {
        this.toast.success(
          `Synced: ${data.added} added, ${data.modified} updated, ${data.removed} removed.`,
        );
      }
      if (data.failed.length > 0) {
        const names = data.failed.map(f => f.institutionName).join(', ');
        this.toast.error(`Reconnect needed for ${names}. See Accounts to fix.`);
      }
    } catch (err: any) {
      console.error('syncTransactions failed:', err);
      this.toast.error(err?.message || 'Could not sync transactions. Please try again.');
    } finally {
      this.syncing.set(false);
    }
  }

  /**
   * Ask Plaid to proactively re-poll every linked institution right now (outside
   * their normal cadence), rather than waiting for the next scheduled sync. Useful
   * to check whether a low transaction count is a timing issue or a real limit on
   * how much history that institution shares. If a refresh + resync still shows
   * the same count, the institution itself is capping what it returns.
   * The webhook picks up any new data automatically; wait a few seconds after this
   * resolves, then use "Sync transactions" to pull in whatever Plaid found.
   */
  async refreshInstitutions(): Promise<void> {
    if (this.refreshing()) return;
    this.refreshing.set(true);
    try {
      const refresh = httpsCallable<
        unknown,
        { results: { itemId: string; institutionName: string; ok: boolean; error?: string; errorCode?: string }[] }
      >(this.functions, 'refreshPlaidItems');
      const { data } = await refresh();
      const failed = data.results.filter(r => !r.ok);
      if (failed.length > 0) {
        // Say why, per bank: a login problem needs Reconnect (now shown on the
        // bank), anything else is the bank not refreshing on demand, which
        // doesn't stop its normal syncing.
        const why = failed.map(f => REAUTH_CODES.has(f.errorCode ?? '')
          ? `${f.institutionName} needs you to reconnect (see Accounts).`
          : `${f.institutionName} couldn't refresh right now${f.error ? ` (${f.error.replace(/\.$/, '')})` : ''}; it still syncs on its own.`);
        const ok = data.results.length - failed.length;
        this.toast.error([...(ok > 0 ? [`Refresh requested for ${ok} bank${ok === 1 ? '' : 's'}.`] : []), ...why].join(' '));
      } else {
        this.toast.success('Refresh requested. Give it 10-30s, then Sync transactions.');
      }
    } catch (err: any) {
      console.error('refreshInstitutions failed:', err);
      this.toast.error(err?.message || 'Could not request a refresh. Please try again.');
    } finally {
      this.refreshing.set(false);
    }
  }

  /**
   * Disconnect a linked bank: removes it at Plaid and deletes its stored data
   * (item, index, and that item's synced transactions).
   */
  async disconnect(item: PlaidItem): Promise<void> {
    if (this.disconnectingId()) return;
    this.disconnectingId.set(item.itemId);
    try {
      const fn = httpsCallable<{ item_id: string }, { removed: boolean; removedTransactions: number }>(
        this.functions,
        'disconnectPlaidItem',
      );
      const { data } = await fn({ item_id: item.itemId });
      // Remove the app accounts we auto-created for this bank (client-encrypted).
      for (const acc of this.accountSvc.accounts()) {
        if (acc.plaidItemId === item.itemId && acc.id) await this.accountSvc.remove(acc.id);
      }
      this.toast.success(
        `${item.institutionName} disconnected. ${data.removedTransactions} synced transaction(s) removed.`,
      );
    } catch (err: any) {
      console.error('disconnect failed:', err);
      this.toast.error(err?.message || 'Could not disconnect this bank. Please try again.');
    } finally {
      this.disconnectingId.set(null);
    }
  }

  /**
   * Re-authenticate a bank that needs it (expired/revoked login): opens Plaid
   * Link in "update mode" for this exact item, so the user re-logs in at their
   * bank without creating a duplicate item. Update mode doesn't need a fresh
   * token exchange (the existing access_token stays valid), so on success we
   * just clear the item's error status locally.
   */
  async reconnect(item: PlaidItem): Promise<void> {
    return this.openUpdateMode(item, false);
  }

  /**
   * "Manage accounts": the same update mode, letting you choose which of the
   * bank's accounts are shared. How a replaced card (or any new account) gets
   * added to an existing connection, rather than linking the bank again, which
   * for Chase can break the existing link. Afterwards anything new is asked
   * about: a replacement for a card you have, or a new account.
   */
  async manageAccounts(item: PlaidItem): Promise<void> {
    return this.openUpdateMode(item, true);
  }

  private async openUpdateMode(item: PlaidItem, accountSelection: boolean): Promise<void> {
    if (this.reauthenticatingId()) return;
    this.reauthenticatingId.set(item.itemId);

    try {
      await this.loadLinkScript();

      const createReauthLinkToken = httpsCallable<{ item_id: string; account_selection?: boolean }, CreateLinkTokenResult>(
        this.functions,
        'createReauthLinkToken',
      );
      const { data } = await createReauthLinkToken({ item_id: item.itemId, account_selection: accountSelection });

      const handler = (window as any).Plaid.create({
        token: data.link_token,
        onSuccess: () => {
          this.ngZone.run(async () => {
            const user = this.auth.user();
            if (user) {
              await updateDoc(doc(this.db, `users/${user.uid}/plaidItems/${item.itemId}`), {
                status: 'active',
                lastError: null,
                newAccountsAvailable: false,
              }).catch(() => {});
            }
            if (!accountSelection) {
              this.toast.success(`${item.institutionName} reconnected.`);
              return;
            }
            // Anything newly shared is asked about on the Accounts page.
            await this.setupAccountsForItem(item.itemId, item.institutionName);
            const fresh = this.pendingNewAccounts().filter(p => p.itemId === item.itemId).length;
            this.toast.success(fresh
              ? `${item.institutionName} updated. ${fresh === 1 ? 'One new account' : fresh + ' new accounts'} to set up.`
              : `${item.institutionName} updated. Sync to pull the latest transactions.`);
          });
        },
        onExit: (err: any) => {
          this.ngZone.run(() => {
            if (err) {
              console.error('Reconnect exit error:', err);
              this.toast.error(err.display_message || err.error_message || 'Reconnection cancelled.');
            }
          });
        },
      });

      handler.open();
    } catch (err: any) {
      console.error('reconnect failed:', err);
      this.toast.error(err?.message || 'Could not start reconnection. Please try again.');
    } finally {
      this.reauthenticatingId.set(null);
    }
  }
}
