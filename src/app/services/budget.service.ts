import { Injectable, inject, NgZone, signal } from '@angular/core';
import {
  Firestore, collection, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc
} from '@angular/fire/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Budget } from '../models';

@Injectable({ providedIn: 'root' })
export class BudgetService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private budgets$: Observable<Budget[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      return new Observable<Budget[]>(sub => {
        const ref = collection(this.db, `users/${user.uid}/budgets`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(
          q,
          async snap => {
            try {
              const budgets = await Promise.all(
                snap.docs.map(async d => ({ id: d.id, ...(await this.encryption.decryptDoc<Budget>(d.data())) }))
              );
              this.ngZone.run(() => {
                this.error.set(null);
                sub.next(budgets);
              });
            } catch (err: any) {
              this.ngZone.run(() => {
                this.error.set(err?.message || 'Could not decrypt budgets.');
                sub.next([]);
              });
            }
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load budgets.');
            sub.next([]);
          })
        );
        return unsub;
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
    await addDoc(ref, await this.encryption.encryptForWrite({ ...budget, createdAt: Date.now() }));
  }

  async update(id: string, patch: Partial<Budget>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/budgets/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Budget not found');
    const current = await this.encryption.decryptDoc<Budget>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/budgets/${id}`));
  }
}
