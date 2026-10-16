import { Injectable, inject, computed, signal, effect } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { ToastService } from './toast.service';
import { Transaction } from '../models';
import { AccountService } from './account.service';
import { relinkDuplicates } from '../utils/relink-duplicates';

/**
 * A likely-duplicate pair. `manual`: a bank row and an entry you added
 * yourself. `relink`: the same bank row sent twice, once by an earlier link
 * of the bank and again by the new one (see utils/relink-duplicates.ts).
 */
export interface ReconcileMatch {
  kind: 'manual' | 'relink';
  plaid: Transaction;   // the bank row removed on merge (doc id === plaidTransactionId)
  manual: Transaction;  // the row kept: your entry, or the copy you already had
}

const MATCH_DAYS = 3; // dates within this many days count as the same transaction

@Injectable({ providedIn: 'root' })
export class ReconciliationService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private txService = inject(TransactionService);
  private accountSvc = inject(AccountService);
  private toast = inject(ToastService);

  /** plaidTransactionIds the user chose to "keep both"; they are never suggested again. */
  private ignoreIds = signal<Set<string>>(new Set());
  busy = signal(false);

  constructor() {
    effect(() => {
      const user = this.auth.user();
      if (!user) { this.ignoreIds.set(new Set()); return; }
      void this.loadIgnore(user.uid);
    });
  }

  /**
   * Candidate duplicate pairs, computed live from decrypted transactions. A bank
   * transaction matches a manual entry when they share type + exact amount and their
   * dates are within MATCH_DAYS, and only when exactly one manual entry qualifies
   * (ambiguous cases are never guessed).
   */
  matches = computed<ReconcileMatch[]>(() => {
    const txs = this.txService.transactions();
    const ignore = this.ignoreIds();
    const results: ReconcileMatch[] = [];
    // A relink sends every bank row again: those pairs first, so a repeat
    // isn't also offered against something you entered by hand.
    const repeats = new Set<string>();
    for (const pair of relinkDuplicates(txs, this.accountSvc.accounts())) {
      if (ignore.has(pair.drop.plaidTransactionId!)) continue;
      results.push({ kind: 'relink', plaid: pair.drop, manual: pair.keep });
      repeats.add(pair.drop.id!);
    }
    const serverPlaid = txs.filter(t => t.plaidTransactionId && t.id === t.plaidTransactionId && !repeats.has(t.id!));
    // Once an entry is merged it's permanently excluded from being reconsidered. A
    // looser rule (re-open matching once the original link target is gone, e.g. after
    // a disconnect/relink) was tried and reverted: with no merchant check and only a
    // 3-day/exact-amount match, it let a just-merged entry immediately become
    // "eligible" again and cascade into matching unrelated same-amount transactions
    // (recurring charges especially). The Discover disconnect/relink case this was
    // meant to fix is handled as a one-off manual merge instead.
    const manual = txs.filter(t => !t.plaidTransactionId);

    const usedManual = new Set<string>();
    for (const p of serverPlaid) {
      if (ignore.has(p.plaidTransactionId!)) continue;
      const cands = manual.filter(m =>
        m.id && !usedManual.has(m.id) &&
        m.type === p.type &&
        Math.abs(m.amount - p.amount) < 0.005 &&
        this.dayDiff(m.date, p.date) <= MATCH_DAYS,
      );
      if (cands.length === 1) {
        results.push({ kind: 'manual', plaid: p, manual: cands[0] });
        usedManual.add(cands[0].id!);
      }
    }
    return results;
  });

  /** Merge one pair: keep the manual entry's merchant/notes/category, take the
   *  date and account from the bank row (the source of truth for when/where the
   *  charge actually happened), link it to Plaid, and delete the duplicate bank row. */
  async merge(match: ReconcileMatch): Promise<void> {
    this.busy.set(true);
    try {
      await this.linkAndDrop(match);
    } catch (err) {
      this.toast.error('Failed to merge. Please try again.');
    } finally {
      this.busy.set(false);
    }
  }

  /** Merge every current match. Isolated per-item so one failure doesn't abandon the rest. */
  async mergeAll(): Promise<void> {
    const all = this.matches();
    if (all.length === 0) return;
    this.busy.set(true);
    try {
      let succeeded = 0;
      let failed = 0;
      for (const m of all) {
        try {
          await this.linkAndDrop(m);
          succeeded++;
        } catch (err) {
          failed++;
        }
      }
      if (succeeded > 0) {
        this.toast.success(`Merged ${succeeded} duplicate${succeeded === 1 ? '' : 's'}.`);
      }
      if (failed > 0) {
        this.toast.error(`${failed} duplicate${failed === 1 ? '' : 's'} couldn't be merged. Please try again.`);
      }
    } finally {
      this.busy.set(false);
    }
  }

  /** Dismiss a pair as genuinely separate; never suggest it again. */
  async keepBoth(match: ReconcileMatch): Promise<void> {
    const previous = this.ignoreIds();
    const next = new Set(previous);
    next.add(match.plaid.plaidTransactionId!);
    this.ignoreIds.set(next);
    try {
      await this.saveIgnore();
    } catch (err) {
      this.ignoreIds.set(previous);
      this.toast.error('Failed to dismiss. Please try again.');
    }
  }

  /**
   * Delete bank rows that duplicate an already-linked manual entry (e.g. a webhook
   * re-synced a transaction that was previously merged). Keeps reconciliation stable
   * across syncs. Safe to call after every sync.
   */
  async cleanupReconciled(): Promise<void> {
    const txs = this.txService.transactions();
    const linkedPtids = new Set(
      txs.filter(t => t.plaidTransactionId && t.id !== t.plaidTransactionId).map(t => t.plaidTransactionId!),
    );
    const orphans = txs.filter(t => t.plaidTransactionId && t.id === t.plaidTransactionId && linkedPtids.has(t.plaidTransactionId!));
    if (orphans.length > 0) await this.txService.removeMany(orphans.map(t => t.id!));
  }

  private async linkAndDrop(match: ReconcileMatch): Promise<void> {
    // The kept row takes the bank row's ids, so when the bank sends it again
    // cleanupReconciled drops the copy rather than it coming back.
    const patch: Partial<Transaction> = {
      plaidTransactionId: match.plaid.plaidTransactionId,
      plaidItemId: match.plaid.plaidItemId,
      plaidAccountId: match.plaid.plaidAccountId,
    };
    // Your own entry takes the bank's date and account. A relinked copy you
    // already had keeps its own: it's the same row, maybe with your edits.
    if (match.kind === 'manual') {
      patch.date = match.plaid.date;
      if (match.plaid.accountId) patch.accountId = match.plaid.accountId;
    }
    await this.txService.update(match.manual.id!, patch);
    await this.txService.remove(match.plaid.id!);
  }

  private dayDiff(a: string, b: string): number {
    const da = new Date(a + 'T00:00:00').getTime();
    const db = new Date(b + 'T00:00:00').getTime();
    return Math.abs(da - db) / 86_400_000;
  }

  private async loadIgnore(uid: string): Promise<void> {
    try {
      const snap = await getDoc(doc(this.db, `users/${uid}/meta/reconcileIgnore`));
      const ids = (snap.exists() ? (snap.data()?.['ids'] as string[]) : []) ?? [];
      this.ignoreIds.set(new Set(ids));
    } catch {
      this.ignoreIds.set(new Set());
    }
  }

  private async saveIgnore(): Promise<void> {
    const user = this.auth.user();
    if (!user) return;
    await setDoc(doc(this.db, `users/${user.uid}/meta/reconcileIgnore`), { ids: [...this.ignoreIds()] });
  }
}
