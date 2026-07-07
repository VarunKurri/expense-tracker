import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs, doc, getDoc, setDoc, writeBatch, addDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { EncryptionService } from './encryption.service';
import { Category } from '../models';

// The canonical default categories every account gets. New accounts are seeded with
// these; existing accounts are topped up with any they're missing (ensureDefaultCategories).
const DEFAULT_EXPENSE_CATEGORIES = [
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
  { name: 'Bank Fees', icon: '🏦', color: '#6b7280' },
  { name: 'Charity & Gifts', icon: '🎁', color: '#ec4899' },
  { name: 'Financial Services', icon: '🏛️', color: '#0ea5e9' },
  { name: 'Fines & Penalties', icon: '⚠️', color: '#ef4444' },
  { name: 'Personal Care', icon: '🧴', color: '#a855f7' },
  { name: 'Personal Transfers', icon: '🔄', color: '#3b82f6' },
  { name: 'Transportation', icon: '🚌', color: '#f59e0b' },
  { name: 'Travel', icon: '✈️', color: '#14b8a6' },
];

const DEFAULT_INCOME_CATEGORIES = [
  { name: 'Salary', icon: 'Salary', color: '#10b981' },
  { name: 'Bonus', icon: 'Bonus', color: '#22c55e' },
  { name: 'Interest', icon: 'Interest', color: '#06b6d4' },
  { name: 'Pocket Money', icon: '💸', color: '#f59e0b' },
  { name: 'Refund', icon: '↩️', color: '#14b8a6' },
  { name: 'Other Income', icon: 'Income', color: '#84cc16' },
];

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
        await this.ensureDefaultCategories(user.uid);
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
        for (const c of DEFAULT_EXPENSE_CATEGORIES) {
          batch.set(doc(ref), await this.encryption.encryptForWrite({ ...c, kind: 'expense', createdAt: Date.now() }));
        }

        for (const c of DEFAULT_INCOME_CATEGORIES) {
          batch.set(doc(ref), await this.encryption.encryptForWrite({ ...c, kind: 'income', createdAt: Date.now() }));
        }
        await batch.commit();
      } else {
        await this.ensurePocketMoneyCategory(user.uid);
        await this.ensureDefaultCategories(user.uid);
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

  /**
   * Top up an existing account with any default categories it's missing (matched by
   * name + kind), so newly-introduced defaults reach accounts that were seeded earlier.
   * Never removes or renames anything. Since users can't delete categories, this won't
   * fight an intentional removal.
   */
  private async ensureDefaultCategories(uid: string) {
    const ref = collection(this.db, `users/${uid}/categories`);
    const snap = await getDocs(ref);

    // Match by name only (ignoring kind): if a category with this name already
    // exists in any kind, don't add another. No two defaults share a name, so this
    // is safe and avoids creating cross-kind duplicates (e.g. "Personal Transfers").
    const existing = new Set<string>();
    for (const item of snap.docs) {
      const c = await this.encryption.decryptDoc<Category>(item.data());
      existing.add(c.name.trim().toLowerCase());
    }

    const wanted = [
      ...DEFAULT_EXPENSE_CATEGORIES.map(c => ({ ...c, kind: 'expense' as const })),
      ...DEFAULT_INCOME_CATEGORIES.map(c => ({ ...c, kind: 'income' as const })),
    ];
    for (const c of wanted) {
      if (existing.has(c.name.toLowerCase())) continue;
      await addDoc(ref, await this.encryption.encryptForWrite({
        name: c.name,
        icon: c.icon,
        color: c.color,
        kind: c.kind,
        createdAt: Date.now(),
      }));
    }
  }
}
