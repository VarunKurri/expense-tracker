import { Injectable, signal } from '@angular/core';

export type QuickAddType = 'expense' | 'income' | 'transfer' | null;

@Injectable({ providedIn: 'root' })
export class QuickAddService {
  open = signal(false);
  defaultType = signal<QuickAddType>(null);

  trigger(type: QuickAddType = null) {
    this.defaultType.set(type);
    this.open.set(true);
  }

  close() {
    this.open.set(false);
    this.defaultType.set(null);
  }
}