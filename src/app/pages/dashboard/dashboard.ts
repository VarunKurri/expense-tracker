import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { MigrationService } from '../../services/migration.service';

@Component({
  selector: 'app-dashboard',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './dashboard.html',
  styleUrl: './dashboard.scss',
})
export class Dashboard {
  private migration = inject(MigrationService);

  migrating = signal(false);
  migrationResult = signal<string | null>(null);

  async runMigration() {
    this.migrating.set(true);
    try {
      const res = await this.migration.migrateOldExpenses();
      this.migrationResult.set(`Migrated ${res.migrated} expense(s) to transactions.`);
    } catch (err) {
      this.migrationResult.set('Error: ' + (err as Error).message);
    } finally {
      this.migrating.set(false);
    }
  }
}
