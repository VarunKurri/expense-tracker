import { Injectable, inject, NgZone } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc
} from 'firebase/firestore';
import { Observable, of, switchMap } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { Category } from '../models';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private ngZone = inject(NgZone);

  private categories$: Observable<Category[]> = toObservable(this.auth.user).pipe(
    switchMap(user => {
      if (!user) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/categories`),
        orderBy('name', 'asc')
      );
      return new Observable<Category[]>(sub => {
        const unsub = onSnapshot(
          q,
          snap => this.ngZone.run(() =>
            sub.next(snap.docs.map(d => ({ id: d.id, ...d.data() } as Category)))
          ),
          err => this.ngZone.run(() => {
            console.error('categories error:', err.message);
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  categories = toSignal(this.categories$, { initialValue: [] });

  async add(category: Omit<Category, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await addDoc(collection(this.db, `users/${user.uid}/categories`), {
      ...category, createdAt: Date.now()
    });
  }

  async update(id: string, patch: Partial<Category>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await updateDoc(doc(this.db, `users/${user.uid}/categories/${id}`), patch);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/categories/${id}`));
  }
}
