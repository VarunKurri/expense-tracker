import { Injectable } from '@angular/core';

/**
 * Counts who currently wants the page behind an overlay frozen.
 *
 * Overlays used to set `document.body.style.overflow` directly, which is fine
 * while only one can be open. It stops being fine once they stack: the day
 * popup hands off to the transaction view and takes it back when that closes,
 * so for a moment both are live. Whichever one wrote to `body` last won,
 * and since these writes come from Angular effects the order is not something
 * a caller controls — the page could end up scrollable behind an open overlay,
 * or frozen after the last one closed.
 *
 * Holding a set of keys instead makes the result order-independent: the body is
 * locked while anything holds a lock, and released exactly when the last holder
 * lets go.
 *
 * Pages with a single overlay still set `body.overflow` themselves; they are
 * correct as they are and were left alone.
 */
@Injectable({ providedIn: 'root' })
export class ScrollLockService {
  private holders = new Set<string>();

  lock(key: string) {
    this.holders.add(key);
    this.apply();
  }

  unlock(key: string) {
    this.holders.delete(key);
    this.apply();
  }

  /** `locked` is the caller's current state, so an effect can just pass a boolean. */
  set(key: string, locked: boolean) {
    locked ? this.lock(key) : this.unlock(key);
  }

  private apply() {
    document.body.style.overflow = this.holders.size > 0 ? 'hidden' : '';
  }
}
