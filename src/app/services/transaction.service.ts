import { Injectable, inject, NgZone } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc
} from 'firebase/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Transaction } from '../models';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private ngZone = inject(NgZone);

  private transactions$: Observable<Transaction[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/transactions`),
        orderBy('date', 'desc'),
        orderBy('createdAt', 'desc')
      );
      return new Observable<Transaction[]>(sub => {
        const unsub = onSnapshot(
          q,
          snap => this.ngZone.run(() =>
            sub.next(snap.docs.map(d => ({ id: d.id, ...d.data() } as Transaction)))
          ),
          err => this.ngZone.run(() => {
            console.error('transactions error:', err.message);
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  transactions = toSignal(this.transactions$, { initialValue: [] });

  balanceForAccount(accountId: string): number {
    let balance = 0;
    for (const t of this.transactions()) {
      if (t.type === 'income' && t.accountId === accountId) balance += t.amount;
      else if (t.type === 'expense' && t.accountId === accountId) balance -= t.amount;
      else if (t.type === 'transfer') {
        if (t.fromAccountId === accountId) balance -= t.amount;
        if (t.toAccountId === accountId) balance += t.amount;
      }
    }
    return balance;
  }

  async add(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const now = Date.now();
    await addDoc(collection(this.db, `users/${user.uid}/transactions`), {
      ...tx, createdAt: now, updatedAt: now
    });
  }

  async update(id: string, patch: Partial<Transaction>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/transactions/${id}`), {
      ...patch, updatedAt: Date.now()
    });
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/transactions/${id}`));
  }
}
