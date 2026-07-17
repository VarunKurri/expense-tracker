import { Injectable, inject, NgZone, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, getDoc
} from 'firebase/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Category } from '../models';
import { displayIcon } from '../utils/legacy-icons';

@Injectable({ providedIn: 'root' })
export class CategoryService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private categories$: Observable<Category[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/categories`),
        orderBy('createdAt', 'asc')
      );
      return new Observable<Category[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  const cat = { id: d.id, ...(await this.encryption.decryptDoc<Category>(d.data())) };
                  return { ...cat, icon: displayIcon(cat.icon) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const categories: Category[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') categories.push(r.value);
              else { failed++; console.error('Failed to decrypt a category doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} categor${failed === 1 ? 'y' : 'ies'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(categories.sort((a, b) => a.name.localeCompare(b.name)));
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load categories.');
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
    const data = {
      ...category, createdAt: Date.now()
    };
    await addDoc(collection(this.db, `users/${user.uid}/categories`), await this.encryption.encryptForWrite(data));
  }

  async update(id: string, patch: Partial<Category>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/categories/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Category not found');
    const current = await this.encryption.decryptDoc<Category>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/categories/${id}`));
  }
}
