import { Injectable, inject, NgZone, signal } from '@angular/core';
import {
  Firestore, collection, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc
} from '@angular/fire/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Group } from '../models';

@Injectable({ providedIn: 'root' })
/**
 * Groups: a trip, a flat, a weekend away (models/group.model.ts). Encrypted
 * like every other collection. The balances are utils/groups.ts.
 */
export class GroupService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);
  /** True once the first list of groups has arrived (so "not found" isn't shown while loading). */
  loaded = signal(false);

  private groups$: Observable<Group[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      return new Observable<Group[]>(sub => {
        const ref = collection(this.db, `users/${user.uid}/groups`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return { id: d.id, ...(await this.encryption.decryptDoc<Group>(d.data())) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const items: Group[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') items.push(r.value);
              else { failed++; console.error('Failed to decrypt a group doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.loaded.set(true);
              this.error.set(failed > 0
                ? `${failed} ${failed === 1 ? 'group' : 'groups'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(items);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load your groups.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  groups = toSignal(this.groups$, { initialValue: [] });

  byId(id: string | null | undefined): (Group & { id: string }) | undefined {
    return this.groups().find(g => g.id === id) as (Group & { id: string }) | undefined;
  }

  async add(item: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/groups`);
    const created = await addDoc(ref, await this.encryption.encryptForWrite({ ...item, createdAt: Date.now(), updatedAt: Date.now() }));
    return created.id;
  }

  async update(id: string, patch: Partial<Group>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/groups/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Not found');
    const current = await this.encryption.decryptDoc<Group>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: Date.now() }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/groups/${id}`));
  }
}
