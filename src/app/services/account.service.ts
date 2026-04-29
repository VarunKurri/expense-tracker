import { Injectable, inject, NgZone } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc
} from 'firebase/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Account } from '../models';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private ngZone = inject(NgZone);

  private accounts$: Observable<Account[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/accounts`),
        orderBy('createdAt', 'asc')
      );
      return new Observable<Account[]>(sub => {
        const unsub = onSnapshot(
          q,
          snap => this.ngZone.run(() =>
            sub.next(snap.docs.map(d => ({ id: d.id, ...d.data() } as Account)))
          ),
          err => this.ngZone.run(() => {
            console.error('accounts error:', err.message);
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  accounts = toSignal(this.accounts$, { initialValue: [] });

  async add(account: Omit<Account, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await addDoc(collection(this.db, `users/${user.uid}/accounts`), {
      ...account, createdAt: Date.now()
    });
  }

  async update(id: string, patch: Partial<Account>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/accounts/${id}`), patch);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/accounts/${id}`));
  }

  getById(id: string): Account | undefined {
    return this.accounts().find(a => a.id === id);
  }
}
