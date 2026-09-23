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
import { CategoryGroup } from '../models';

/**
 * Category groups, stored per user at `users/{uid}/categoryGroups`.
 *
 * Follows CategoryService exactly, including the encrypt-on-write path — group
 * names are user data and must never reach Firestore in the clear.
 */
@Injectable({ providedIn: 'root' })
export class CategoryGroupService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private groups$: Observable<CategoryGroup[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/categoryGroups`),
        orderBy('createdAt', 'asc')
      );
      return new Observable<CategoryGroup[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => ({
                id: d.id,
                ...(await this.encryption.decryptDoc<CategoryGroup>(d.data())),
              }))
            );
            const groups: CategoryGroup[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') groups.push(r.value);
              else { failed++; console.error('Failed to decrypt a category group:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} group${failed === 1 ? '' : 's'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden.`
                : null);
              // Explicit order first, then name — so a user-set order sticks but
              // untouched groups still read alphabetically.
              sub.next(groups.sort((a, b) =>
                (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name)));
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load category groups.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  groups = toSignal(this.groups$, { initialValue: [] });

  async add(group: Omit<CategoryGroup, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const data = { ...group, createdAt: Date.now() };
    await addDoc(
      collection(this.db, `users/${user.uid}/categoryGroups`),
      await this.encryption.encryptForWrite(data)
    );
  }

  async update(id: string, patch: Partial<CategoryGroup>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/categoryGroups/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Group not found');
    const current = await this.encryption.decryptDoc<CategoryGroup>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch }) as any);
  }

  /**
   * Deletes the group only. Categories keep their `groupId`, which then points
   * at nothing and reads as ungrouped — callers that want the members cleared
   * should do that first, so a mis-click cannot silently rewrite many records.
   */
  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/categoryGroups/${id}`));
  }
}
