import { Injectable, inject, EnvironmentInjector, runInInjectionContext } from '@angular/core';
import {
  Firestore, collection, collectionData, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy
} from '@angular/fire/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Budget } from '../models';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private injector = inject(EnvironmentInjector);

  private budgets$: Observable<Budget[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      return runInInjectionContext(this.injector, () => {
        const ref = collection(this.db, `users/${user.uid}/budgets`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        return collectionData(q, { idField: 'id' }) as Observable<Budget[]>;
      });
    })
  );

  budgets = toSignal(this.budgets$, { initialValue: [] });

  // Get budget for a category in a specific month
  // Month-specific overrides take priority over defaults
  getBudgetForCategory(categoryId: string, month: string): Budget | null {
    const all = this.budgets();
    // Check month-specific override first
    const specific = all.find(b =>
      b.categoryId === categoryId && b.month === month && !b.isDefault
    );
    if (specific) return specific;
    // Fall back to default
    return all.find(b =>
      b.categoryId === categoryId && b.isDefault
    ) || null;
  }

  // Get all default budgets
  defaultBudgets(): Budget[] {
    return this.budgets().filter(b => b.isDefault);
  }

  async add(budget: Omit<Budget, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/budgets`);
    await addDoc(ref, { ...budget, createdAt: Date.now() });
  }

  async update(id: string, patch: Partial<Budget>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/budgets/${id}`), patch);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/budgets/${id}`));
  }
}