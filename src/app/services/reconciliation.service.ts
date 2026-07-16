import { Injectable, inject, computed, signal, effect } from '@angular/core';
import { Firestore } from '@angular/fire/firestore';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { AuthService } from './auth.service';
import { TransactionService } from './transaction.service';
import { ToastService } from './toast.service';
import { Transaction } from '../models';

/** A likely-duplicate pair: a bank-synced transaction and a manual entry that look like the same thing. */
export interface ReconcileMatch {
  plaid: Transaction;   // server-written Plaid transaction (doc id === plaidTransactionId)
  manual: Transaction;  // user's manual entry (no plaidTransactionId yet)
}

const MATCH_DAYS = 3; // dates within this many days count as the same transaction

@Injectable({ providedIn: 'root' })
export class ReconciliationService {
  private db = inject(Firestore);
  private auth = inject(AuthService);
  private txService = inject(TransactionService);
  private toast = inject(ToastService);

  /** plaidTransactionIds the user chose to "keep both" — never suggested again. */
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
   * dates are within MATCH_DAYS — and only when exactly one manual entry qualifies
   * (ambiguous cases are never guessed).
   */
  matches = computed<ReconcileMatch[]>(() => {
    const txs = this.txService.transactions();
    const ignore = this.ignoreIds();
    const serverPlaid = txs.filter(t => t.plaidTransactionId && t.id === t.plaidTransactionId);
    // A manual entry merged with an earlier Plaid transaction stays tagged with that
    // plaidTransactionId forever (see linkAndDrop). If that item was later disconnected
    // and relinked, the same real-world charge comes back under a brand-new
    // plaidTransactionId — the old tag is now orphaned, so treat it as manual again
    // instead of permanently blocking it from ever being reconciled.
    const livePlaidIds = new Set(serverPlaid.map(p => p.plaidTransactionId!));
    const manual = txs.filter(t => !t.plaidTransactionId || !livePlaidIds.has(t.plaidTransactionId));

    const results: ReconcileMatch[] = [];
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
        results.push({ plaid: p, manual: cands[0] });
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
    } finally {
      this.busy.set(false);
    }
  }

  /** Merge every current match. */
  async mergeAll(): Promise<void> {
    const all = this.matches();
    if (all.length === 0) return;
    this.busy.set(true);
    try {
      for (const m of all) await this.linkAndDrop(m);
      this.toast.success(`Merged ${all.length} duplicate${all.length === 1 ? '' : 's'}.`);
    } finally {
      this.busy.set(false);
    }
  }

  /** Dismiss a pair as genuinely separate; never suggest it again. */
  async keepBoth(match: ReconcileMatch): Promise<void> {
    const next = new Set(this.ignoreIds());
    next.add(match.plaid.plaidTransactionId!);
    this.ignoreIds.set(next);
    await this.saveIgnore();
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
    const patch: Partial<Transaction> = {
      date: match.plaid.date,
      plaidTransactionId: match.plaid.plaidTransactionId,
      plaidItemId: match.plaid.plaidItemId,
      plaidAccountId: match.plaid.plaidAccountId,
    };
    if (match.plaid.accountId) patch.accountId = match.plaid.accountId;
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
