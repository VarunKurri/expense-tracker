import { Injectable, inject } from '@angular/core';
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

  private running = false;

  // Called from App component effect once bills signal is populated
  async runIfNeeded() {
    if (this.running) return;
    this.running = true;

    const user = this.auth.user();
    if (!user) { this.running = false; return; }

    // Use local date, not UTC — avoids false "tomorrow" result in US evening hours
    const today = localDateString();

    try {
      const sentinelRef = doc(this.db, `users/${user.uid}/meta/autopay-v3`);
      const sentinel = await getDoc(sentinelRef);
      if (sentinel.exists() && sentinel.data()['lastProcessed'] === today) return;

      let anyError = false;
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
          anyError = true;
        }
      }

      // Only mark as done if everything succeeded — lets failed bills retry next load
      if (!anyError) {
        await setDoc(sentinelRef, { lastProcessed: today });
      }
    } catch (err) {
      console.error('Autopay: error, will retry next load', err);
    } finally {
      this.running = false;
    }
  }
}

function localDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
