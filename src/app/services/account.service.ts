import { Injectable, inject, NgZone, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, doc, getDoc
} from 'firebase/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Account } from '../models';
import { displayIcon } from '../utils/legacy-icons';

@Injectable({ providedIn: 'root' })
export class AccountService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);
  // True once the first accounts snapshot (empty or not) has been received — lets
  // callers (autopay's Plaid-linked check) tell "genuinely no accounts" apart from
  // "still loading," since the signal itself starts at [] either way.
  loaded = signal(false);

  private accounts$: Observable<Account[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) { this.loaded.set(false); return of([]); }
      const q = query(
        collection(this.db, `users/${user.uid}/accounts`),
        orderBy('createdAt', 'asc')
      );
      return new Observable<Account[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  const acc = { id: d.id, ...(await this.encryption.decryptDoc<Account>(d.data())) };
                  return { ...acc, icon: displayIcon(acc.icon) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const accounts: Account[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') accounts.push(r.value);
              else { failed++; console.error('Failed to decrypt an account doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} account${failed === 1 ? '' : 's'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(accounts);
              this.loaded.set(true);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load accounts.');
            sub.next([]);
            this.loaded.set(true);
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
    const data = {
      ...account, createdAt: Date.now()
    };
    await addDoc(collection(this.db, `users/${user.uid}/accounts`), await this.encryption.encryptForWrite(data));
  }

  async update(id: string, patch: Partial<Account>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/accounts/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Account not found');
    const current = await this.encryption.decryptDoc<Account>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch }) as any);
  }

  async remove(id: string) {
    await this.update(id, { archived: true });
  }

  getById(id: string): Account | undefined {
    return this.accounts().find(a => a.id === id);
  }
}
