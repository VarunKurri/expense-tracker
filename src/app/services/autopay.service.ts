import { Injectable, inject } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
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
  private failedBillIds = new Set<string>();

  // Called from App component effect once bills signal is populated
  async runIfNeeded() {
    if (this.running) return;
    this.running = true;

    const user = this.auth.user();
    if (!user) { this.running = false; return; }

    // Use local date, not UTC — avoids false "tomorrow" result in US evening hours
    const today = localDateString();

    try {
      let anyError = false;
      for (const bill of this.billService.bills()) {
        if (!bill.active || !bill.autopayEnabled || !bill.id) continue;
        if (this.failedBillIds.has(bill.id)) continue;
        if (bill.nextDueDate > today) continue;

        try {
          let nextDate = bill.nextDueDate;
          while (nextDate <= today) {
            // Check if there is already a manual/existing transaction matching this bill around this date (within 2 days)
            const hasExisting = this.txService.transactions().some(t => {
              if (t.type !== 'expense') return false;
              if (t.merchant?.toLowerCase() !== bill.name.toLowerCase()) return false;
              if (Math.abs(t.amount - bill.amount) >= 0.01) return false;

              const tDate = new Date(t.date + 'T00:00:00').getTime();
              const bDate = new Date(nextDate + 'T00:00:00').getTime();
              const diffDays = Math.abs(tDate - bDate) / (1000 * 60 * 60 * 24);
              return diffDays <= 2;
            });

            if (!hasExisting) {
              await this.txService.add({
                type: 'expense',
                amount: bill.amount,
                date: nextDate,
                merchant: bill.name,
                accountId: bill.accountId,
                categoryId: bill.categoryId,
                notes: `Autopay — ${bill.frequency} bill`,
              });
            }
            nextDate = this.billService.advanceDate(nextDate, bill.frequency);
          }
          await this.billService.update(bill.id, { nextDueDate: nextDate });
        } catch (err) {
          console.error(`Autopay: failed to process "${bill.name}"`, err);
          this.failedBillIds.add(bill.id);
          anyError = true;
        }
      }
    } catch (err) {
      console.error('Autopay: error', err);
    } finally {
      this.running = false;
    }
  }
}

function localDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
