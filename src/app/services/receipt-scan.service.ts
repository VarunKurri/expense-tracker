import { EnvironmentInjector, Injectable, inject, runInInjectionContext } from '@angular/core';
import { Functions, httpsCallable } from '@angular/fire/functions';
import { ReceiptScan, cleanScan } from '../utils/receipt';

/** The longest side of the photo we send. Plenty for printed text, and keeps a scan cheap. */
const MAX_SIDE = 1600;

/**
 * Reads a receipt photo: shrinks it in the browser, sends it to the
 * `scanReceipt` Cloud Function (which asks OpenAI), and returns what was read.
 *
 * The photo is never saved — not here, not in Firestore, not by the function.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptScanService {
  // Functions is looked up when a scan happens rather than at construction, so
  // pages that only show the transaction form don't need Firebase in their tests.
  private injector = inject(EnvironmentInjector);

  async scan(file: File): Promise<ReceiptScan> {
    const image = await shrink(file);
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

/** The photo as a JPEG data URL, at most MAX_SIDE pixels on its longest side. */
async function shrink(file: File): Promise<string> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file); // honours the photo's rotation
  } catch {
    throw new Error("Couldn't open that image. Try a JPEG or PNG photo.");
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error("Couldn't open that image.");
  ctx.fillStyle = '#fff'; // transparent PNGs would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}
