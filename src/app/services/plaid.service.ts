import { Injectable, inject, signal, NgZone } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from './toast.service';

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

@Injectable({ providedIn: 'root' })
export class PlaidService {
  private functions = inject(Functions);
  private toast = inject(ToastService);
  private ngZone = inject(NgZone);

  /** True while we are minting a link token / opening Link. */
  connecting = signal(false);

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
}
