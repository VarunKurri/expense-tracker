import { Injectable, inject, NgZone, signal, computed } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, query, orderBy, onSnapshot,
  addDoc, updateDoc, deleteDoc, doc, getDoc, writeBatch
} from 'firebase/firestore';
import { Observable, of, switchMap, combineLatest } from 'rxjs';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { AccountService } from './account.service';
import { Transaction } from '../models';
import { Account } from '../models';
import { availableCredit, creditCardBalance, transactionDeltaForAccount } from '../utils/finance';

@Injectable({ providedIn: 'root' })
export class TransactionService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private accountSvc = inject(AccountService);
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
            try {
              const transactions = await Promise.all(
                snap.docs.map(async d => ({ id: d.id, ...(await this.encryption.decryptDoc<Transaction>(d.data())) }))
              );
              this.ngZone.run(() => {
                this.error.set(null);
                sub.next(transactions);
              });
            } catch (err: any) {
              this.ngZone.run(() => {
                this.error.set(err?.message || 'Could not decrypt transactions.');
                sub.next([]);
              });
            }
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
   * Transactions with their account resolved. Bank-synced transactions carry a
   * `plaidAccountId` but no app `accountId`; we fill it in from the auto-created
   * app account that owns that Plaid account. Done in-memory (never written back),
   * so it can't conflict with sync or re-encryption.
   */
  transactions = computed<Transaction[]>(() => {
    const txs = this.rawTransactions();
    const accounts = this.accountSvc.accounts();
    if (accounts.length === 0) return txs;
    return txs.map(t => {
      if (t.accountId || !t.plaidAccountId) return t;
      const match = accounts.find(a => a.plaidAccountId === t.plaidAccountId);
      return match?.id ? { ...t, accountId: match.id } : t;
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
    await updateDoc(ref, await this.encryption.encryptForWrite({ ...current, ...patch, updatedAt: Date.now() }) as any);
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
