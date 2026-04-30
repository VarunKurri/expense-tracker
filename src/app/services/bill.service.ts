import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Bill, BillFrequency } from '../models';

@Injectable({ providedIn: 'root' })
export class BillService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private injector = inject(EnvironmentInjector);

  private bills$: Observable<Bill[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      return runInInjectionContext(this.injector, () => {
        const ref = collection(this.db, `users/${user.uid}/bills`);
        const q = query(ref, orderBy('nextDueDate', 'asc'));
        return collectionData(q, { idField: 'id' }) as Observable<Bill[]>;
      });
    })
  );

  bills = toSignal(this.bills$, { initialValue: [] });

  // Upcoming bills — due within next 30 days
  upcomingBills(days = 30) {
    const today = new Date().toISOString().slice(0, 10);
    const future = new Date();
    future.setDate(future.getDate() + days);
    const futureStr = future.toISOString().slice(0, 10);
    return this.bills().filter(b =>
      b.active && b.nextDueDate >= today && b.nextDueDate <= futureStr
    );
  }

  overdueBills() {
    const today = new Date().toISOString().slice(0, 10);
    return this.bills().filter(b => b.active && b.nextDueDate < today);
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
    await addDoc(ref, { ...bill, createdAt: Date.now() });
  }

  async update(id: string, patch: Partial<Bill>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/bills/${id}`), patch);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/bills/${id}`));
  }
}