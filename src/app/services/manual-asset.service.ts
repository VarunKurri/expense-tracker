import { Injectable, inject, NgZone, signal } from '@angular/core';
import {
  Firestore, collection, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc
} from '@angular/fire/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { ManualAsset } from '../models';

@Injectable({ providedIn: 'root' })
/**
 * Manual assets and debts (home, car, loans…) — anything without a bank
 * connection. Encrypted like every other collection.
 */
export class ManualAssetService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private items$: Observable<ManualAsset[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      return new Observable<ManualAsset[]>(sub => {
        const ref = collection(this.db, `users/${user.uid}/manualAssets`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return { id: d.id, ...(await this.encryption.decryptDoc<ManualAsset>(d.data())) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const items: ManualAsset[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') items.push(r.value);
              else { failed++; console.error('Failed to decrypt a manual asset doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} asset${failed === 1 ? '' : 's'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(items);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load your assets.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  items = toSignal(this.items$, { initialValue: [] });

  async add(item: Omit<ManualAsset, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/manualAssets`);
    const created = await addDoc(ref, await this.encryption.encryptForWrite({ ...item, createdAt: Date.now(), updatedAt: Date.now() }));
    return created.id;
  }

  async update(id: string, patch: Partial<ManualAsset>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/manualAssets/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Not found');
    const current = await this.encryption.decryptDoc<ManualAsset>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: Date.now() }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/manualAssets/${id}`));
  }
}
