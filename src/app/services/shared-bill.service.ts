import { Injectable, Injector, inject, NgZone, signal } from '@angular/core';
import {
  Firestore, collection, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc
} from '@angular/fire/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { SharedBill } from '../models';
import { ReceiptService } from './receipt.service';

@Injectable({ providedIn: 'root' })
/**
 * Bills someone else paid ("Ben paid $200 for the tents"), in
 * users/{uid}/sharedBills, encrypted like every other collection. They aren't
 * transactions: no money left your accounts. Your share becomes spending when
 * you pay them back. See models/group.model.ts; the maths is utils/groups.ts
 * and utils/shared.ts.
 */
export class SharedBillService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);
  /** True once the first list has arrived. */
  loaded = signal(false);

  private bills$: Observable<SharedBill[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      return new Observable<SharedBill[]>(sub => {
        const ref = collection(this.db, `users/${user.uid}/sharedBills`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return { id: d.id, ...(await this.encryption.decryptDoc<SharedBill>(d.data())) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const items: SharedBill[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') items.push(r.value);
              else { failed++; console.error('Failed to decrypt a shared bill doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.loaded.set(true);
              this.error.set(failed > 0
                ? `${failed} ${failed === 1 ? 'bill' : 'bills'} someone else paid failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(items);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load the bills other people paid.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  bills = toSignal(this.bills$, { initialValue: [] });

  // Looked up when a bill with a photo is deleted, so tests don't need it.
  private injector = inject(Injector);

  byId(id: string | null | undefined): SharedBill | undefined {
    return this.bills().find(b => b.id === id);
  }

  async add(item: Omit<SharedBill, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/sharedBills`);
    const created = await addDoc(ref, await this.encryption.encryptForWrite({ ...item, createdAt: Date.now(), updatedAt: Date.now() }));
    return created.id;
  }

  async update(id: string, patch: Partial<SharedBill>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/sharedBills/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Not found');
    const current = await this.encryption.decryptDoc<SharedBill>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: Date.now() }) as any);
  }

  /** Delete the bill, and its receipt photo if it has one. */
  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const receiptId = this.byId(id)?.receiptId;
    await deleteDoc(doc(this.db, `users/${user.uid}/sharedBills/${id}`));
    if (receiptId) await this.injector.get(ReceiptService).remove(receiptId).catch(() => {});
  }
}
