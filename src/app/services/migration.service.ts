import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import {
  collection, getDocs, addDoc, deleteDoc, doc
} from 'firebase/firestore';
import { AuthService } from './auth.service';
import { AccountService } from './account.service';
import { CategoryService } from './category.service';

@Injectable({ providedIn: 'root' })
export class MigrationService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private accounts = inject(AccountService);
  private categories = inject(CategoryService);

  async migrateOldExpenses(): Promise<{ migrated: number; skipped: number }> {
    const user = this.auth.user();
    if (!user) throw new Error('Not signed in');

    let snap;
    try {
      const oldRef = collection(this.db, `users/${user.uid}/expenses`);
      snap = await getDocs(oldRef);
    } catch (err: any) {
      if (err.code === 'permission-denied') {
        throw new Error(
          'Rules block the expenses collection. In Firebase Console → Firestore → Rules, ' +
          "add 'expenses' to the allowed list, publish, then try again."
        );
      }
      throw err;
    }

    if (snap.empty) return { migrated: 0, skipped: 0 };

    const cashAccount = this.accounts.accounts().find(a => a.name === 'Cash');
    if (!cashAccount?.id) throw new Error('Default accounts not seeded yet — sign out and back in.');

    const allCategories = this.categories.categories();
    const newRef = collection(this.db, `users/${user.uid}/transactions`);
    let migrated = 0;

    for (const oldDoc of snap.docs) {
      const data = oldDoc.data() as any;
      const matchedCat = allCategories.find(
        c => c.name.toLowerCase() === (data.category || '').toLowerCase() && c.kind === 'expense'
      );

      await addDoc(newRef, {
        type: 'expense',
        amount: data.amount,
        date: data.date,
        merchant: data.merchant,
        accountId: cashAccount.id,
        categoryId: matchedCat?.id || null,
        notes: data.notes || null,
        createdAt: data.createdAt || Date.now(),
        updatedAt: Date.now(),
      });

      await deleteDoc(doc(this.db, `users/${user.uid}/expenses/${oldDoc.id}`));
      migrated++;
    }

    return { migrated, skipped: 0 };
  }
}
