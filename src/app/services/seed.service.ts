import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs, addDoc, doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';

@Injectable({ providedIn: 'root' })
export class SeedService {
  private db   = inject(Firestore);
  private auth = inject(AuthService);

  // Prevents multiple concurrent calls within the same session
  private seeding = false;

  async seedIfEmpty() {
    if (this.seeding) return;
    this.seeding = true;

    try {
      const user = this.auth.user();
      if (!user) return;

      // One-time sentinel: once written, seeding never runs again for this user
      // even if all accounts are later deleted.
      const sentinelRef = doc(this.db, `users/${user.uid}/meta/seed`);
      const sentinelSnap = await getDoc(sentinelRef);
      if (sentinelSnap.exists()) return;

      const accountsSnap = await getDocs(collection(this.db, `users/${user.uid}/accounts`));
      if (accountsSnap.empty) {
        const ref = collection(this.db, `users/${user.uid}/accounts`);
        const now = Date.now();
        await addDoc(ref, { name: 'Cash',        type: 'cash',     openingBalance: 0, currency: 'USD', icon: '💵', color: '#10b981', archived: false, createdAt: now });
        await addDoc(ref, { name: 'Checking',     type: 'checking', openingBalance: 0, currency: 'USD', icon: '🏦', color: '#3b82f6', archived: false, createdAt: now + 1 });
        await addDoc(ref, { name: 'Credit Card',  type: 'credit',   openingBalance: 0, currency: 'USD', icon: '💳', color: '#8b5cf6', archived: false, createdAt: now + 2 });
      }

      const categoriesSnap = await getDocs(collection(this.db, `users/${user.uid}/categories`));
      if (categoriesSnap.empty) {
        const ref = collection(this.db, `users/${user.uid}/categories`);
        const expenseCats = [
          { name: 'Groceries',     icon: '🛒', color: '#10b981' },
          { name: 'Gas',           icon: '⛽', color: '#f59e0b' },
          { name: 'Dining',        icon: '🍽️', color: '#ef4444' },
          { name: 'Parking',       icon: '🅿️', color: '#6b7280' },
          { name: 'RideShare',     icon: '🚗', color: '#3b82f6' },
          { name: 'Car',           icon: '🔧', color: '#8b5cf6' },
          { name: 'Shopping',      icon: '🛍️', color: '#ec4899' },
          { name: 'Entertainment', icon: '🎬', color: '#f97316' },
          { name: 'Rent',          icon: '🏠', color: '#6366f1' },
          { name: 'Utilities',     icon: '💡', color: '#eab308' },
          { name: 'Health',        icon: '💊', color: '#14b8a6' },
          { name: 'Subscriptions', icon: '📺', color: '#a855f7' },
          { name: 'Other',         icon: '📦', color: '#9ca3af' },
        ];
        for (const c of expenseCats) {
          await addDoc(ref, { ...c, kind: 'expense', createdAt: Date.now() });
        }
        const incomeCats = [
          { name: 'Salary',       icon: '💼', color: '#10b981' },
          { name: 'Bonus',        icon: '🎁', color: '#22c55e' },
          { name: 'Interest',     icon: '📈', color: '#06b6d4' },
          { name: 'Other Income', icon: '💰', color: '#84cc16' },
        ];
        for (const c of incomeCats) {
          await addDoc(ref, { ...c, kind: 'income', createdAt: Date.now() });
        }
      }

      // Mark this user as seeded so the block above never runs again
      await setDoc(sentinelRef, { seededAt: Date.now() });
    } finally {
      // Keep seeding=true so repeated effect() firings are ignored this session
    }
  }
}
