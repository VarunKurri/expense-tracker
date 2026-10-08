import { Injectable, inject, NgZone, signal } from '@angular/core';
import {
  Firestore, collection, addDoc,
  updateDoc, deleteDoc, doc, query, orderBy, onSnapshot, getDoc
} from '@angular/fire/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { SplitPerson } from '../models';
import { personName } from '../utils/splits';

@Injectable({ providedIn: 'root' })
/**
 * People you split bills with. Saved once so the same person is recognised
 * across every split — that's what lets the Shared page say "Alex owes you
 * $85 across three dinners". Encrypted like every other collection.
 */
export class PersonService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private people$: Observable<SplitPerson[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      return new Observable<SplitPerson[]>(sub => {
        const ref = collection(this.db, `users/${user.uid}/people`);
        const q = query(ref, orderBy('createdAt', 'asc'));
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return { id: d.id, ...(await this.encryption.decryptDoc<SplitPerson>(d.data())) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const items: SplitPerson[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') items.push(r.value);
              else { failed++; console.error('Failed to decrypt a person doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} ${failed === 1 ? 'person' : 'people'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(items);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load the people you split with.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  people = toSignal(this.people$, { initialValue: [] });

  /** A display name for anyone on a bill — "You" for you. */
  nameOf(id: string): string {
    return personName(this.people(), id);
  }

  async add(item: Omit<SplitPerson, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = collection(this.db, `users/${user.uid}/people`);
    const created = await addDoc(ref, await this.encryption.encryptForWrite({ ...item, createdAt: Date.now(), updatedAt: Date.now() }));
    return created.id;
  }

  async update(id: string, patch: Partial<SplitPerson>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/people/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Not found');
    const current = await this.encryption.decryptDoc<SplitPerson>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: Date.now() }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/people/${id}`));
  }
}
