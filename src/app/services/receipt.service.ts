import { Injectable, Injector, inject } from '@angular/core';
import { Firestore, addDoc, collection, deleteDoc, doc, getDoc } from '@angular/fire/firestore';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { ReceiptImage } from '../models';
import { FittedImage, MAX_IMAGE_CHARS, fitImage } from '../utils/image';

/** Past this, the encrypted document wouldn't fit in Firestore's 1 MiB. */
const HARD_LIMIT_CHARS = Math.round(MAX_IMAGE_CHARS * 1.15);

/**
 * Receipt photos attached to transactions.
 *
 * One encrypted document per photo in `users/{uid}/receipts`, with the same
 * encryption and rules as every other collection, so nothing new to set up
 * and nothing readable outside the app. Unlike other services there's no live
 * listener: photos are big, so each is fetched only when it's opened, and kept
 * in memory for the rest of the visit.
 */
@Injectable({ providedIn: 'root' })
export class ReceiptService {
  // Looked up on first use rather than at construction, so every page that can
  // show a transaction doesn't need Firebase in its tests.
  private injector = inject(Injector);
  private get db() { return this.injector.get(Firestore); }
  private get auth() { return this.injector.get(AuthService); }
  private get encryption() { return this.injector.get(EncryptionService); }
  private cache = new Map<string, Promise<ReceiptImage | null>>();

  private path(): string {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    return `users/${user.uid}/receipts`;
  }

  /** A picked photo, shrunk to fit one document (utils/image.ts). */
  fit(file: Blob): Promise<FittedImage> {
    return fitImage(file);
  }

  /** Store a photo; returns the id to put on the transaction as `receiptId`. */
  async save(photo: FittedImage): Promise<string> {
    if (photo.dataUrl.length > HARD_LIMIT_CHARS) {
      throw new Error('That receipt photo is too large to store. Try a closer, tighter photo.');
    }
    const data: Omit<ReceiptImage, 'id'> = { image: photo.dataUrl, width: photo.width, height: photo.height, createdAt: Date.now() };
    const ref = await addDoc(collection(this.db, this.path()), await this.encryption.encryptForWrite(data));
    this.cache.set(ref.id, Promise.resolve({ id: ref.id, ...data }));
    return ref.id;
  }

  /** The photo, or null if it's gone (deleted, or from before a restore). */
  load(id: string): Promise<ReceiptImage | null> {
    let pending = this.cache.get(id);
    if (!pending) {
      pending = (async () => {
        const snap = await getDoc(doc(this.db, `${this.path()}/${id}`));
        if (!snap.exists()) return null;
        return { id, ...(await this.encryption.decryptDoc<ReceiptImage>(snap.data())) };
      })();
      // A failed load shouldn't stick: let the next open try again.
      pending.catch(() => this.cache.delete(id));
      this.cache.set(id, pending);
    }
    return pending;
  }

  async remove(id: string): Promise<void> {
    this.cache.delete(id);
    await deleteDoc(doc(this.db, `${this.path()}/${id}`));
  }
}
