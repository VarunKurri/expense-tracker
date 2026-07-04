import { Injectable, inject, signal, NgZone } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { Firestore } from '@angular/fire/firestore';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { ToastService } from './toast.service';

/** A linked bank (Plaid item). Metadata is plaintext; the access token is not stored here. */
export interface PlaidItem {
  itemId: string;
  institutionName: string;
  status?: string;
  createdAt?: number;
  updatedAt?: number;
  lastError?: string;
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
}

@Injectable({ providedIn: 'root' })
export class PlaidService {
  private functions = inject(Functions);
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private toast = inject(ToastService);
  private ngZone = inject(NgZone);

  /** True while we are minting a link token / opening Link. */
  connecting = signal(false);

  /** True while a manual transaction sync is running. */
  syncing = signal(false);

  /** item_id currently being disconnected (for per-row button state). */
  disconnectingId = signal<string | null>(null);

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
  async connectBank(): Promise<void> {
    if (this.connecting()) return;
    this.connecting.set(true);

    try {
      await this.loadLinkScript();

      const createLinkToken = httpsCallable<unknown, CreateLinkTokenResult>(
        this.functions,
        'createLinkToken',
      );
      const { data } = await createLinkToken();

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
      this.toast.success(`${data.institutionName} connected. Your bank is now linked.`);
    } catch (err: any) {
      console.error('exchangePublicToken failed:', err);
      this.toast.error(`Connected to ${institutionName}, but saving the link failed. Please try again.`);
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
      const changed = data.added + data.modified + data.removed;
      if (changed === 0) {
        this.toast.info('Already up to date — no new transactions.');
      } else {
        this.toast.success(
          `Synced: ${data.added} added, ${data.modified} updated, ${data.removed} removed.`,
        );
      }
    } catch (err: any) {
      console.error('syncTransactions failed:', err);
      this.toast.error(err?.message || 'Could not sync transactions. Please try again.');
    } finally {
      this.syncing.set(false);
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
}
