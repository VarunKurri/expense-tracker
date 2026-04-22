import { Injectable, inject, signal } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc,
  deleteDoc, doc, query, orderBy
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Expense } from '../models/expense.model';
import { runInInjectionContext, EnvironmentInjector } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ExpenseService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private injector = inject(EnvironmentInjector);

  private expenses$: Observable<Expense[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      return runInInjectionContext(this.injector, () => {
        const ref = collection(this.db, `users/${user.uid}/expenses`);
        const q = query(ref, orderBy('createdAt', 'desc'));
        return collectionData(q, { idField: 'id' }) as Observable<Expense[]>;
      });
    })
  );

  expenses = toSignal(this.expenses$, { initialValue: [] });

  async add(expense: Omit<Expense, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/expenses`);
    await addDoc(ref, { ...expense, createdAt: Date.now() });
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/expenses/${id}`));
  }
}