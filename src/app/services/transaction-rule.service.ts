import { Injectable, inject, NgZone, signal, computed } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, getDoc
} from 'firebase/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { CategoryService } from './category.service';
import { dropMissingCategories } from '../utils/rules';
import { TransactionRule } from '../models';

/**
 * Transaction rules, stored per user at `users/{uid}/transactionRules`.
 *
 * Same encrypt-on-write path as every other record. That choice has a
 * consequence worth stating plainly: because the rules are encrypted with the
 * user's key, the Plaid sync Cloud Function cannot read them, so bank-synced
 * transactions are categorised on the client rather than at write time. See
 * `utils/rules.ts`.
 */
@Injectable({ providedIn: 'root' })
export class TransactionRuleService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private ngZone = inject(NgZone);
  private categoryService = inject(CategoryService);
  error = signal<string | null>(null);

  private rules$: Observable<TransactionRule[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/transactionRules`),
        orderBy('createdAt', 'asc')
      );
      return new Observable<TransactionRule[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => ({
                id: d.id,
                ...(await this.encryption.decryptDoc<TransactionRule>(d.data())),
              }))
            );
            const rules: TransactionRule[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') rules.push(r.value);
              else { failed++; console.error('Failed to decrypt a transaction rule:', r.reason); }
            }
            this.ngZone.run(() => {
              // A rule that fails to decrypt is hidden, which means it also
              // stops running — say so, rather than letting categorisation go
              // quietly wrong.
              this.error.set(failed > 0
                ? `${failed} rule${failed === 1 ? '' : 's'} failed to decrypt, so ${failed === 1 ? 'it is' : 'they are'} hidden and not running.`
                : null);
              sub.next(rules.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0)));
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load transaction rules.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  /** Every rule as stored — for listing and editing. */
  rules = toSignal(this.rules$, { initialValue: [] });

  /**
   * The rules that are safe to *run*: any action filing into a category that
   * has since been deleted is dropped. Everything that applies rules — manual
   * add, CSV import, bulk apply and its preview counts — must read this rather
   * than `rules`, or a deleted category gets written back onto transactions.
   */
  activeRules = computed(() => {
    const valid = new Set(
      this.categoryService.categories().map(c => c.id).filter((id): id is string => !!id));
    return dropMissingCategories(this.rules(), valid);
  });

  /** New rules go to the end of the run order unless a priority is given. */
  async add(rule: Omit<TransactionRule, 'id' | 'createdAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const existing = this.rules();
    const priority = rule.priority ?? (existing.length
      ? Math.max(...existing.map(r => r.priority ?? 0)) + 1
      : 0);
    const data = { ...rule, priority, createdAt: Date.now() };
    await addDoc(
      collection(this.db, `users/${user.uid}/transactionRules`),
      await this.encryption.encryptForWrite(data)
    );
  }

  async update(id: string, patch: Partial<TransactionRule>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/transactionRules/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Rule not found');
    const current = await this.encryption.decryptDoc<TransactionRule>(snap.data());
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch }) as any);
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/transactionRules/${id}`));
  }

  /** Moves a rule up or down the run order by swapping priorities. */
  async reorder(id: string, direction: -1 | 1) {
    const ordered = [...this.rules()].sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));
    const i = ordered.findIndex(r => r.id === id);
    const j = i + direction;
    if (i < 0 || j < 0 || j >= ordered.length) return;
    const a = ordered[i], b = ordered[j];
    await Promise.all([
      this.update(a.id!, { priority: b.priority ?? j }),
      this.update(b.id!, { priority: a.priority ?? i }),
    ]);
  }
}
