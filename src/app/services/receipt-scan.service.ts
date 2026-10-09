import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ReceiptScan, cleanScan } from '../utils/receipt';
import { fitImage } from '../utils/image';

/**
 * Reads a receipt photo: sends it to the `scanReceipt` Cloud Function (which
 * asks OpenAI) and returns what was read.
 *
 * OpenAI doesn't keep the photo, and neither does the function. When a photo
 * is attached to a transaction, that copy is the one in ReceiptService —
 * encrypted, in your own Firestore.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptScanService {
  // Functions is looked up when a scan happens rather than at construction, so
  // pages that only show the transaction form don't need Firebase in their tests.
  private injector = inject(EnvironmentInjector);

  /** Read a photo file (shrunk first). */
  async scan(file: File): Promise<ReceiptScan> {
    return this.scanImage((await fitImage(file)).dataUrl);
  }

  /** Read a photo that's already a JPEG data URL — e.g. one attached to the transaction. */
  async scanImage(image: string): Promise<ReceiptScan> {
    const call = runInInjectionContext(this.injector, () =>
      httpsCallable<{ image: string }, unknown>(inject(Functions), 'scanReceipt', { timeout: 100_000 }));
    try {
      const { data } = await call({ image });
      return cleanScan(data);
    } catch (err: any) {
      // The function's own messages are written for people; anything else isn't.
      const code = String(err?.code ?? '');
      const fromFunction = ['invalid-argument', 'resource-exhausted', 'failed-precondition', 'unauthenticated', 'unavailable', 'internal']
        .some(c => code.endsWith(c));
      throw new Error(fromFunction && err?.message ? err.message : "Couldn't scan that receipt. Check your connection and try again.");
    }
  }
}
