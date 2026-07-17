import { Injectable, inject, NgZone, signal } from '@angular/core';
import {
  Firestore, collection, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc
} from '@angular/fire/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Bill, BillFrequency } from '../models';

@Injectable({ providedIn: 'root' })
export class BillService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private bills$: Observable<Bill[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      return new Observable<Bill[]>(sub => {
        const ref = collection(this.db, `users/${user.uid}/bills`);
        const q = query(ref, orderBy('nextDueDate', 'asc'));
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return { id: d.id, ...(await this.encryption.decryptDoc<Bill>(d.data())) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const bills: Bill[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') bills.push(r.value);
              else { failed++; console.error('Failed to decrypt a bill doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} bill${failed === 1 ? '' : 's'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(bills);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load bills.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  bills = toSignal(this.bills$, { initialValue: [] });

  // Upcoming bills — due within next 30 days
  upcomingBills(days = 30) {
    const today = localDateString();
    const future = new Date();
    future.setDate(future.getDate() + days);
    const futureStr = localDateString(future);
    return this.bills().filter(b =>
      b.active && b.nextDueDate >= today && b.nextDueDate <= futureStr
    );
  }

  overdueBills() {
    const today = localDateString();
    return this.bills().filter(b => b.active && !b.autopayEnabled && b.nextDueDate < today);
  }

  nextDueDate(bill: Bill): string {
    return this.advanceDate(bill.nextDueDate, bill.frequency);
  }

  advanceDate(from: string, frequency: BillFrequency): string {
    const d = new Date(from + 'T00:00:00');
    switch (frequency) {
      case 'weekly':
        d.setDate(d.getDate() + 7);
        break;
      case 'monthly':
        d.setMonth(d.getMonth() + 1);
        break;
      case 'quarterly':
        d.setMonth(d.getMonth() + 3);
        break;
      case 'yearly':
        d.setFullYear(d.getFullYear() + 1);
        break;
    }
    return d.toISOString().slice(0, 10);
  }

  async add(bill: Omit<Bill, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/bills`);
    await addDoc(ref, await this.encryption.encryptForWrite({ ...bill, createdAt: Date.now() }));
  }

  async update(id: string, patch: Partial<Bill>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/bills/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Bill not found');
    const current = await this.encryption.decryptDoc<Bill>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/bills/${id}`));
  }
}

function localDateString(d: Date = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
