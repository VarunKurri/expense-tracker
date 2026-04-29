import { Injectable, signal } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class QuickAddService {
  open = signal(false);

  trigger() { this.open.set(true); }
  close() { this.open.set(false); }
}