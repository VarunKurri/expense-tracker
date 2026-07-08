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

  private accounts$: Observable<Account[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/accounts`),
        orderBy('createdAt', 'asc')
      );
      return new Observable<Account[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            try {
              const accounts = await Promise.all(
                snap.docs.map(async d => {
                  const acc = { id: d.id, ...(await this.encryption.decryptDoc<Account>(d.data())) };
                  return { ...acc, icon: displayIcon(acc.icon) };
                })
              );
              this.ngZone.run(() => {
                this.error.set(null);
                sub.next(accounts);
              });
            } catch (err: any) {
              this.ngZone.run(() => {
                this.error.set(err?.message || 'Could not decrypt accounts.');
                sub.next([]);
              });
            }
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load accounts.');
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
