import { Injectable, NgZone, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { Observable, combineLatest, of, switchMap } from 'rxjs';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { TransactionTemplate } from '../models';

@Injectable({ providedIn: 'root' })
export class TransactionTemplateService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private templates$: Observable<TransactionTemplate[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/transactionTemplates`),
        orderBy('updatedAt', 'desc')
      );
      return new Observable<TransactionTemplate[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return {
                    id: d.id,
                    ...(await this.encryption.decryptDoc<TransactionTemplate>(d.data())),
                  };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const templates: TransactionTemplate[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') templates.push(r.value);
              else { failed++; console.error('Failed to decrypt a transaction template doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} template${failed === 1 ? '' : 's'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(templates);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load transaction templates.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  templates = toSignal(this.templates$, { initialValue: [] });

  async add(template: Omit<TransactionTemplate, 'id' | 'createdAt' | 'updatedAt' | 'useCount'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const now = Date.now();
    const data: TransactionTemplate = {
      ...template,
      createdAt: now,
      updatedAt: now,
      useCount: 0,
    };
    await addDoc(
      collection(this.db, `users/${user.uid}/transactionTemplates`),
      await this.encryption.encryptForWrite(data)
    );
  }

  async recordUse(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/transactionTemplates/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) return;
    const current = await this.encryption.decryptDoc<TransactionTemplate>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({
      ...current,
      useCount: (current.useCount || 0) + 1,
      updatedAt: Date.now(),
    }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/transactionTemplates/${id}`));
  }
}
