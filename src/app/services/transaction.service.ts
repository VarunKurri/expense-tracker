import { Injectable, inject, NgZone, signal, computed } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, setDoc, deleteDoc, doc, getDoc, writeBatch
} from 'firebase/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { AccountService } from './account.service';
import { CategoryService } from './category.service';
import { Transaction } from '../models';
import { Account } from '../models';
import { availableCredit, creditCardBalance, transactionDeltaForAccount } from '../utils/finance';
import { plaidCategoryName } from '../utils/plaid-category-map';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private accountSvc = inject(AccountService);
  private categorySvc = inject(CategoryService);
  private ngZone = inject(NgZone);
  error = signal<string | null>(null);

  private transactions$: Observable<Transaction[]> = combineLatest([
    toObservable(this.auth.user),
    toObservable(this.encryption.unlocked),
  ]).pipe(
    switchMap(([user, unlocked]) => {
      if (!user || !unlocked) return of([]);
      const q = query(
        collection(this.db, `users/${user.uid}/transactions`),
        orderBy('date', 'desc'),
        orderBy('createdAt', 'desc')
      );
      return new Observable<Transaction[]>(sub => {
        const unsub = onSnapshot(
          q,
          async snap => {
            const results = await Promise.allSettled(
              snap.docs.map(async d => {
                try {
                  return { id: d.id, ...(await this.encryption.decryptDoc<Transaction>(d.data())) };
                } catch (err) {
                  throw new Error(`doc ${d.id}: ${(err as Error)?.message || err}`);
                }
              })
            );
            const transactions: Transaction[] = [];
            let failed = 0;
            for (const r of results) {
              if (r.status === 'fulfilled') transactions.push(r.value);
              else { failed++; console.error('Failed to decrypt a transaction doc:', r.reason); }
            }
            this.ngZone.run(() => {
              this.error.set(failed > 0
                ? `${failed} transaction${failed === 1 ? '' : 's'} failed to decrypt and ${failed === 1 ? 'is' : 'are'} hidden. The rest are shown below.`
                : null);
              sub.next(transactions);
            });
          },
          err => this.ngZone.run(() => {
            this.error.set(err.message || 'Could not load transactions.');
            sub.next([]);
          })
        );
        return unsub;
      });
    })
  );

  private rawTransactions = toSignal(this.transactions$, { initialValue: [] as Transaction[] });

  /**
   * Transactions with their account and category resolved for bank-synced rows.
   * Synced transactions carry `plaidAccountId` / `plaidPersonalFinanceCategory` but
   * no app `accountId` / `categoryId`; we fill those in from the auto-created account
   * and the Plaid→category mapping. Resolved in-memory (never written back), so it
   * can't conflict with sync/re-encryption, and any real value the user set wins.
   */
  transactions = computed<Transaction[]>(() => {
    const txs = this.rawTransactions();
    const accounts = this.accountSvc.accounts();
    const categories = this.categorySvc.categories();

    return txs.map(t => {
      let out = t;

      if (!out.accountId && out.plaidAccountId) {
        const match = accounts.find(a => a.plaidAccountId === out.plaidAccountId);
        if (match?.id) out = { ...out, accountId: match.id };
      }

      if (!out.categoryId && out.plaidPersonalFinanceCategory && (out.type === 'income' || out.type === 'expense')) {
        const name = plaidCategoryName(out.plaidPersonalFinanceCategory, out.type);
        const cat = categories.find(c => c.name === name && c.kind === out.type);
        if (cat?.id) out = { ...out, categoryId: cat.id };
      }

      return out;
    });
  });

  balanceForAccount(accountId: string): number {
    return transactionDeltaForAccount(this.transactions(), accountId);
  }

  // For credit cards: currentBalance = openingBalance + txBalance
  // openingBalance is positive debt, expenses add to it, payments reduce it
  creditCardBalance(account: Account): number {
    return creditCardBalance(account, this.transactions());
  }

availableCredit(account: Account): number {
  return availableCredit(account, this.transactions());
}

  async add(tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const now = Date.now();
    const data = {
      ...tx, createdAt: now, updatedAt: now
    };
    await addDoc(collection(this.db, `users/${user.uid}/transactions`), await this.encryption.encryptForWrite(data));
  }

  async addMany(txs: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'>[]) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (txs.length === 0) return;

    const ref = collection(this.db, `users/${user.uid}/transactions`);
    let batch = writeBatch(this.db);
    let count = 0;
    const now = Date.now();

    for (const tx of txs) {
      const data = { ...tx, createdAt: now + count, updatedAt: now + count };
      batch.set(doc(ref), await this.encryption.encryptForWrite(data));
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(this.db);
      }
    }

    if (count % 400 !== 0) await batch.commit();
  }

  async update(id: string, patch: Partial<Transaction>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    const ref = doc(this.db, `users/${user.uid}/transactions/${id}`);
    const snap = await getDoc(ref);
    if (!snap.exists()) throw new Error('Transaction not found');
    const current = await this.encryption.decryptDoc<Transaction>(snap.data());
    // setDoc (full replace), not updateDoc (partial merge): a Plaid-synced transaction
    // is a differently-shaped `__envelope` document (encryptedDEK, tag, no __encrypted
    // flag). Editing it re-encrypts it as a symmetric `__encrypted` doc — updateDoc
    // would leave the old envelope-only fields in place alongside the new ciphertext,
    // producing a document that's neither validly enveloped nor validly symmetric.
    await setDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: Date.now() }) as any);
  }

  async updateMany(ids: string[], patch: Partial<Transaction>) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (ids.length === 0) return;

    let batch = writeBatch(this.db);
    let count = 0;
    const now = Date.now();

    for (const id of ids) {
      const ref = doc(this.db, `users/${user.uid}/transactions/${id}`);
      const snap = await getDoc(ref);
      if (!snap.exists()) continue;
      const current = await this.encryption.decryptDoc<Transaction>(snap.data());
      batch.set(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: now + count }));
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(this.db);
      }
    }

    if (count % 400 !== 0) await batch.commit();
  }

  async removeMany(ids: string[]) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    if (ids.length === 0) return;

    let batch = writeBatch(this.db);
    let count = 0;

    for (const id of ids) {
      batch.delete(doc(this.db, `users/${user.uid}/transactions/${id}`));
      count++;

      if (count % 400 === 0) {
        await batch.commit();
        batch = writeBatch(this.db);
      }
    }

    if (count % 400 !== 0) await batch.commit();
  }

  async remove(id: string) {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');
    await deleteDoc(doc(this.db, `users/${user.uid}/transactions/${id}`));
  }
}
