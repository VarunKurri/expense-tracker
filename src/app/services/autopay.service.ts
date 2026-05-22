import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { collection, getDocs, doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { BillService } from './bill.service';
import { Bill } from '../models';

@Injectable({ providedIn: 'root' })
export class AutopayService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private txService = inject(TransactionService);
  private billService = inject(BillService);

  private processed = false;

  async processOverdueBills() {
    if (this.processed) return;
    this.processed = true;

    const user = this.auth.user();
    if (!user) return;

    const today = new Date().toISOString().slice(0, 10);

    // Daily sentinel — skip if already processed today
    const sentinelRef = doc(this.db, `users/${user.uid}/meta/autopay`);
    const sentinel = await getDoc(sentinelRef);
    if (sentinel.exists() && sentinel.data()['lastProcessed'] === today) return;

    const billsSnap = await getDocs(collection(this.db, `users/${user.uid}/bills`));

    for (const snap of billsSnap.docs) {
      const bill = { id: snap.id, ...snap.data() } as Bill;
      if (!bill.active || !bill.autopayEnabled) continue;
      if (bill.nextDueDate > today) continue;

      // Walk through every missed cycle and log a transaction for each
      let nextDate = bill.nextDueDate;
      while (nextDate <= today) {
        await this.txService.add({
          type: 'expense',
          amount: bill.amount,
          date: nextDate,
          merchant: bill.name,
          accountId: bill.accountId,
          categoryId: bill.categoryId,
          notes: `Autopay — ${bill.frequency} bill`,
        });
        nextDate = this.billService.advanceDate(nextDate, bill.frequency);
      }

      // Advance nextDueDate past today
      await this.billService.update(bill.id!, { nextDueDate: nextDate });
    }

    await setDoc(sentinelRef, { lastProcessed: today });
  }
}
