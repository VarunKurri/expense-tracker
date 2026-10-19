import { Component, computed, inject, output, signal } from '@angular/core';
import { Transaction } from '../../models';
import { AlertService } from '../../services/alert.service';
import { ToastService } from '../../services/toast.service';
import { SpendingAlert } from '../../utils/alerts';
import { Icon } from '../icon/icon';

/**
 * The Dashboard's "Worth a look": charges that differ from your own history
 * (much bigger than usual somewhere, charged twice, a monthly price that went
 * up). Shows nothing when there's nothing to look at. Tapping one opens it;
 * the cross dismisses it for good.
 */
@Component({
  selector: 'app-spending-alerts',
  standalone: true,
  imports: [Icon],
  templateUrl: './spending-alerts.html',
  styleUrl: './spending-alerts.scss',
})
export class SpendingAlerts {
  private alertService = inject(AlertService);
  private toast = inject(ToastService);

  openTx = output<Transaction>();

  /** Newest first; four until "Show all". */
  alerts = this.alertService.alerts;
  showAllAlerts = signal(false);
  shownAlerts = computed(() => this.showAllAlerts() ? this.alerts() : this.alerts().slice(0, 4));

  /** One plain sentence on why a charge is here. */
  alertText(a: SpendingAlert): string {
    if (a.kind === 'big') {
      const times = Math.round(a.tx.amount / a.usual!);
      return `About ${times}× what you usually spend here (${this.money(a.usual!)}), on ${this.short(a.tx.date)}.`;
    }
    if (a.kind === 'twice') {
      return `Charged twice: ${this.money(a.tx.amount)} on ${this.short(a.other!.date)} and again on ${this.short(a.tx.date)}. If you only paid once, ask them about it.`;
    }
    return `Went up from ${this.money(a.usual!)} to ${this.money(a.tx.amount)} a month, on ${this.short(a.tx.date)}.`;
  }

  async dismissAlert(a: SpendingAlert) {
    try {
      await this.alertService.dismiss(a);
    } catch {
      this.toast.error('Could not dismiss. Please try again.');
    }
  }

  money(n: number): string {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(n);
  }

  private short(date: string): string {
    return new Date(date + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
}
