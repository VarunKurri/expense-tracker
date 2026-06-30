import { Injectable, inject, signal } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ToastService } from './toast.service';

// Plaid Link is loaded from Plaid's CDN at runtime (no npm package for the
// browser SDK), so it attaches itself to window.Plaid.
const PLAID_LINK_SRC = 'https://cdn.plaid.com/link/v2/stable/link-initialize.js';

interface CreateLinkTokenResult {
  link_token: string;
  expiration: string;
}

@Injectable({ providedIn: 'root' })
export class PlaidService {
  private functions = inject(Functions);
  private toast = inject(ToastService);

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
   * Open Plaid Link so the user can connect a bank.
   *
   * Milestone 1 only proves the round-trip: we mint a link token server-side,
   * open Link, and confirm we receive a public_token on success. Exchanging the
   * public_token for an access token comes in the next roadmap item.
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
        onSuccess: (publicToken: string, metadata: any) => {
          // TODO (next milestone): send publicToken to an exchange function.
          console.log('Plaid Link success. public_token:', publicToken, metadata);
          const institution = metadata?.institution?.name || 'your bank';
          this.toast.success(`Connected to ${institution} (sandbox). Ready for the next step.`);
        },
        onExit: (err: any) => {
          if (err) {
            console.error('Plaid Link exit error:', err);
            this.toast.error(err.display_message || err.error_message || 'Bank connection cancelled.');
          }
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
}
