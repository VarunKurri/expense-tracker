import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { SpendingAlert, spendingAlerts } from '../utils/alerts';
import { localDateString } from '../utils/date';

/**
 * The Dashboard's "Worth a look": spending alerts from your own history
 * (utils/alerts.ts), less the ones you've dismissed. Dismissals are kept in
 * `users/{uid}/meta/dismissedAlerts` so they stay dismissed on every device;
 * they hold only alert keys (transaction ids), never amounts.
 */
@Injectable({ providedIn: 'root' })
export class AlertService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private txService = inject(TransactionService);

  private dismissed = signal<Set<string>>(new Set());

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (!user) { this.dismissed.set(new Set()); return; }
      void this.load(user.uid);
    });
  }

  alerts = computed<SpendingAlert[]>(() => {
    const gone = this.dismissed();
    return spendingAlerts(this.txService.transactions(), localDateString()).filter(a => !gone.has(a.key));
  });

  async dismiss(alert: SpendingAlert): Promise<void> {
    const previous = this.dismissed();
    const next = new Set(previous).add(alert.key);
    this.dismissed.set(next);
    const user = this.auth.user();
    if (!user) return;
    try {
      await setDoc(doc(this.db, `users/${user.uid}/meta/dismissedAlerts`), { keys: [...next] });
    } catch (err) {
      this.dismissed.set(previous);
      throw err;
    }
  }

  private async load(uid: string): Promise<void> {
    try {
      const snap = await getDoc(doc(this.db, `users/${uid}/meta/dismissedAlerts`));
      this.dismissed.set(new Set((snap.exists() ? (snap.data()?.['keys'] as string[]) : []) ?? []));
    } catch {
      this.dismissed.set(new Set());
    }
  }
}
