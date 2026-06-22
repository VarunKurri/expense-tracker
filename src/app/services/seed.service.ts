import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs, doc, getDoc, setDoc, writeBatch, addDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Category } from '../models';

@Injectable({ providedIn: 'root' })
export class SeedService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private encryption = inject(EncryptionService);
  private seeding = false;

  async seedIfEmpty() {
    if (this.seeding) return;
    this.seeding = true;

    try {
      const user = this.auth.user();
      if (!user || !this.encryption.unlocked()) return;

      const sentinelRef = doc(this.db, `users/${user.uid}/meta/seed`);
      const sentinelSnap = await getDoc(sentinelRef);
      if (sentinelSnap.exists()) {
        await this.ensurePocketMoneyCategory(user.uid);
        await this.ensureRefundCategory(user.uid);
        return;
      }

      const accountsSnap = await getDocs(collection(this.db, `users/${user.uid}/accounts`));
      if (accountsSnap.empty) {
        const ref = collection(this.db, `users/${user.uid}/accounts`);
        const now = Date.now();
        const batch = writeBatch(this.db);
        const accounts = [
          { name: 'Cash', type: 'cash', openingBalance: 0, currency: 'USD', icon: 'Cash', color: '#10b981', archived: false, createdAt: now },
          { name: 'Checking', type: 'checking', openingBalance: 0, currency: 'USD', icon: 'Bank', color: '#3b82f6', archived: false, createdAt: now + 1 },
          { name: 'Credit Card', type: 'credit', openingBalance: 0, currency: 'USD', icon: 'Card', color: '#8b5cf6', archived: false, createdAt: now + 2 },
        ];
        for (const account of accounts) {
          batch.set(doc(ref), await this.encryption.encryptForWrite(account));
        }
        await batch.commit();
      }

      const categoriesSnap = await getDocs(collection(this.db, `users/${user.uid}/categories`));
      if (categoriesSnap.empty) {
        const ref = collection(this.db, `users/${user.uid}/categories`);
        const batch = writeBatch(this.db);
        const expenseCats = [
          { name: 'Groceries', icon: 'Groceries', color: '#10b981' },
          { name: 'Gas', icon: 'Gas', color: '#f59e0b' },
          { name: 'Dining', icon: 'Dining', color: '#ef4444' },
          { name: 'Parking', icon: 'Parking', color: '#6b7280' },
          { name: 'RideShare', icon: 'Car', color: '#3b82f6' },
          { name: 'Car', icon: 'Auto', color: '#8b5cf6' },
          { name: 'Shopping', icon: 'Shopping', color: '#ec4899' },
          { name: 'Entertainment', icon: 'Entertainment', color: '#f97316' },
          { name: 'Rent', icon: 'Home', color: '#6366f1' },
          { name: 'Utilities', icon: 'Utilities', color: '#eab308' },
          { name: 'Health', icon: 'Health', color: '#14b8a6' },
          { name: 'Subscriptions', icon: 'Subscriptions', color: '#a855f7' },
          { name: 'Other', icon: 'Other', color: '#9ca3af' },
        ];
        for (const c of expenseCats) {
          batch.set(doc(ref), await this.encryption.encryptForWrite({ ...c, kind: 'expense', createdAt: Date.now() }));
        }

        const incomeCats = [
          { name: 'Salary', icon: 'Salary', color: '#10b981' },
          { name: 'Bonus', icon: 'Bonus', color: '#22c55e' },
          { name: 'Interest', icon: 'Interest', color: '#06b6d4' },
          { name: 'Pocket Money', icon: '💸', color: '#f59e0b' },
          { name: 'Refund', icon: '↩️', color: '#14b8a6' },
          { name: 'Other Income', icon: 'Income', color: '#84cc16' },
        ];
        for (const c of incomeCats) {
          batch.set(doc(ref), await this.encryption.encryptForWrite({ ...c, kind: 'income', createdAt: Date.now() }));
        }
        await batch.commit();
      } else {
        await this.ensurePocketMoneyCategory(user.uid);
        await this.ensureRefundCategory(user.uid);
      }

      await setDoc(sentinelRef, { seededAt: Date.now() });
    } finally {
      this.seeding = false;
    }
  }

  private async ensurePocketMoneyCategory(uid: string) {
    const ref = collection(this.db, `users/${uid}/categories`);
    const snap = await getDocs(ref);
    for (const item of snap.docs) {
      const category = await this.encryption.decryptDoc<Category>(item.data());
      const name = category.name.trim().toLowerCase();
      if (category.kind === 'income' && (name === 'pocket money' || name === 'gift pocket money')) {
        if (category.name !== 'Pocket Money' || category.icon !== '💸') {
          await setDoc(item.ref, await this.encryption.encryptForWrite({
            ...category,
            name: 'Pocket Money',
            icon: '💸',
          }));
        }
        return;
      }
    }
    await addDoc(ref, await this.encryption.encryptForWrite({
      name: 'Pocket Money',
      icon: '💸',
      color: '#f59e0b',
      kind: 'income',
      createdAt: Date.now(),
    }));
  }

  private async ensureRefundCategory(uid: string) {
    const ref = collection(this.db, `users/${uid}/categories`);
    const snap = await getDocs(ref);
    for (const item of snap.docs) {
      const category = await this.encryption.decryptDoc<Category>(item.data());
      if (category.kind === 'income' && category.name.trim().toLowerCase() === 'refund') {
        return;
      }
    }
    await addDoc(ref, await this.encryption.encryptForWrite({
      name: 'Refund',
      icon: '↩️',
      color: '#14b8a6',
      kind: 'income',
      createdAt: Date.now(),
    }));
  }
}
