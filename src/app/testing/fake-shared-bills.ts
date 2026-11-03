import { signal } from '@angular/core';
import { SharedBill } from '../models';

/**
 * Test stand-in for SharedBillService: bills kept in a signal, no Firebase.
 * Only specs import this.
 */
export class FakeSharedBills {
  bills = signal<SharedBill[]>([]);
  loaded = signal(true);
  error = signal<string | null>(null);
  private n = 0;

  byId(id: string | null | undefined): SharedBill | undefined {
    return this.bills().find(b => b.id === id);
  }

  async add(item: Omit<SharedBill, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `s${++this.n}`;
    this.bills.update(list => [...list, { ...item, id, createdAt: this.n, updatedAt: this.n }]);
    return id;
  }

  async update(id: string, patch: Partial<SharedBill>) {
    // Firestore drops undefined fields, as the real service's write does.
    this.bills.update(list => list.map(b => (b.id === id ? JSON.parse(JSON.stringify({ ...b, ...patch })) : b)));
  }

  async remove(id: string) {
    this.bills.update(list => list.filter(b => b.id !== id));
  }
}
