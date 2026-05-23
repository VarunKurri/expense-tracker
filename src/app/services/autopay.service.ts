import { Injectable, inject, effect, untracked } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { BillService } from './bill.service';

@Injectable({ providedIn: 'root' })
export class AutopayService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private txService = inject(TransactionService);
  private billService = inject(BillService);

  private ranToday = false;

  constructor() {
    // Fires whenever auth.user() or billService.bills() change.
    // Waits for both to be ready before processing — no setTimeout needed.
    effect(() => {
      const user = this.auth.user();
      const bills = this.billService.bills();
      if (!user || bills.length === 0 || this.ranToday) return;
      untracked(() => this.run());
    });
  }

  private async run() {
    // Synchronously guard before any await so parallel effect firings can't double-run
    if (this.ranToday) return;
    this.ranToday = true;

    const user = this.auth.user();
    if (!user) { this.ranToday = false; return; }

    const today = new Date().toISOString().slice(0, 10);

    try {
      const sentinelRef = doc(this.db, `users/${user.uid}/meta/autopay-v2`);
      const sentinel = await getDoc(sentinelRef);
      if (sentinel.exists() && sentinel.data()['lastProcessed'] === today) return;

      for (const bill of this.billService.bills()) {
        if (!bill.active || !bill.autopayEnabled || !bill.id) continue;
        if (bill.nextDueDate > today) continue;

        try {
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
          await this.billService.update(bill.id, { nextDueDate: nextDate });
        } catch (err) {
          console.error(`Autopay: failed to process "${bill.name}"`, err);
        }
      }

      await setDoc(sentinelRef, { lastProcessed: today });
    } catch (err) {
      console.error('Autopay: sentinel error, will retry next load', err);
      this.ranToday = false;
    }
  }
}
