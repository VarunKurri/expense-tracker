import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs, doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';

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
      if (sentinelSnap.exists()) return;

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
          { name: 'Other Income', icon: 'Income', color: '#84cc16' },
        ];
        for (const c of incomeCats) {
          batch.set(doc(ref), await this.encryption.encryptForWrite({ ...c, kind: 'income', createdAt: Date.now() }));
        }
        await batch.commit();
      }

      await setDoc(sentinelRef, { seededAt: Date.now() });
    } finally {
      this.seeding = false;
    }
  }
}
