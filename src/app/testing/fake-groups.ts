import { signal } from '@angular/core';
import { Group } from '../models';

/**
 * Test stand-in for GroupService: groups kept in a signal, no Firebase.
 * Only specs import this.
 */
export class FakeGroups {
  groups = signal<Group[]>([]);
  loaded = signal(true);
  error = signal<string | null>(null);
  private n = 0;

  byId(id: string | null | undefined): (Group & { id: string }) | undefined {
    return this.groups().find(g => g.id === id) as (Group & { id: string }) | undefined;
  }

  async add(item: Omit<Group, 'id' | 'createdAt' | 'updatedAt'>): Promise<string> {
    const id = `g${++this.n}`;
    this.groups.update(list => [...list, { ...item, id, createdAt: 0, updatedAt: 0 }]);
    return id;
  }

  async update(id: string, patch: Partial<Group>) {
    this.groups.update(list => list.map(g => (g.id === id ? { ...g, ...patch } : g)));
  }

  async remove(id: string) {
    this.groups.update(list => list.filter(g => g.id !== id));
  }
}
