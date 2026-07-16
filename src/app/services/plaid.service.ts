import { Injectable, inject, signal, NgZone } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, orderBy, onSnapshot, doc, updateDoc } from 'firebase/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { ReconciliationService } from './reconciliation.service';
import { ToastService } from './toast.service';
import { Account, AccountType } from '../models';

/** A linked bank (Plaid item). Metadata is plaintext; the access token is not stored here. */
export interface PlaidItem {
  itemId: string;
  institutionName: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  lastError?: string;
}

/** An account under a Plaid item, as returned by the getPlaidAccounts callable. */
interface PlaidAccount {
  account_id: string;
  name: string;
  official_name: string | null;
  mask: string | null;
  type: string;
  subtype: string | null;
  current_balance: number | null;
  credit_limit: number | null;
}

/** Map a Plaid account type/subtype onto an app AccountType. */
function mapPlaidAccountType(type: string, subtype: string | null): AccountType {
  if (type === 'credit') return 'credit';
  if (type === 'investment') return 'investment';
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
  private reconcileSvc = inject(ReconciliationService);
  private toast = inject(ToastService);
  private ngZone = inject(NgZone);

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
   * Create an app account for each Plaid account under an item (idempotent — skips
   * any Plaid account already linked to an app account). Runs client-side so the
   * accounts are encrypted with the user's key like all other app data.
   */
  private async setupAccountsForItem(itemId: string, institutionName: string): Promise<void> {
    try {
      const getAccounts = httpsCallable<{ item_id: string }, { accounts: PlaidAccount[] }>(
        this.functions,
        'getPlaidAccounts',
      );
      const { data } = await getAccounts({ item_id: itemId });
      const existing = this.accountSvc.accounts();

      for (const a of data.accounts) {
        const match = existing.find(acc => acc.plaidAccountId === a.account_id);
        if (match) {
          // Already created — backfill creditLimit if Plaid now reports one we
          // didn't have yet (covers accounts created before this field existed).
          if (!match.creditLimit && a.credit_limit && match.id) {
            await this.accountSvc.update(match.id, { creditLimit: a.credit_limit });
          }
          continue;
        }
        const account: Omit<Account, 'id' | 'createdAt'> = {
          name: a.name || `${institutionName} ${a.mask ?? ''}`.trim(),
          type: mapPlaidAccountType(a.type, a.subtype),
          openingBalance: 0,
          currency: 'USD',
          institution: institutionName,
          ...(a.mask ? { last4: a.mask } : {}),
          ...(a.credit_limit ? { creditLimit: a.credit_limit } : {}),
          plaidAccountId: a.account_id,
          plaidItemId: itemId,
          archived: false,
        };
        await this.accountSvc.add(account);
      }
    } catch (err) {
      // Non-fatal: the bank is still linked; transactions just won't map to an account yet.
      console.error('setupAccountsForItem failed:', err);
    }
  }

  /** Ensure every linked bank has its app accounts created (covers items linked earlier). */
  private async setupAllAccounts(): Promise<void> {
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
        this.toast.info('Already up to date — no new transactions.');
      } else {
        this.toast.success(
          `Synced: ${data.added} added, ${data.modified} updated, ${data.removed} removed.`,
        );
      }
      if (data.failed.length > 0) {
        const names = data.failed.map(f => f.institutionName).join(', ');
        this.toast.error(`${names} — reconnect needed. See Accounts to fix.`);
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
   * how much history that institution shares — if a refresh + resync still shows
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
        { results: { itemId: string; institutionName: string; ok: boolean; error?: string }[] }
      >(this.functions, 'refreshPlaidItems');
      const { data } = await refresh();
      const failed = data.results.filter(r => !r.ok);
      if (failed.length > 0) {
        this.toast.error(`Refresh failed for ${failed.map(f => f.institutionName).join(', ')}.`);
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
        `${item.institutionName} disconnected — ${data.removedTransactions} synced transaction(s) removed.`,
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
   * token exchange — the existing access_token stays valid — so on success we
   * just clear the item's error status locally.
   */
  async reconnect(item: PlaidItem): Promise<void> {
    if (this.reauthenticatingId()) return;
    this.reauthenticatingId.set(item.itemId);

    try {
      await this.loadLinkScript();

      const createReauthLinkToken = httpsCallable<{ item_id: string }, CreateLinkTokenResult>(
        this.functions,
        'createReauthLinkToken',
      );
      const { data } = await createReauthLinkToken({ item_id: item.itemId });

      const handler = (window as any).Plaid.create({
        token: data.link_token,
        onSuccess: () => {
          this.ngZone.run(async () => {
            const user = this.auth.user();
            if (user) {
              await updateDoc(doc(this.db, `users/${user.uid}/plaidItems/${item.itemId}`), {
                status: 'active',
                lastError: null,
              }).catch(() => {});
            }
            this.toast.success(`${item.institutionName} reconnected.`);
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
