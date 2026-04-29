import { Component, inject, signal, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router } from '@angular/router';
import { AccountService } from '../../services/account.service';
import { CategoryService } from '../../services/category.service';
import { TransactionService } from '../../services/transaction.service';
import { Transaction } from '../../models';

interface ParsedRow {
  type: 'expense' | 'income' | 'transfer';
  merchant: string;
  amount: number;
  date: string;
  accountId?: string;
  categoryId?: string;
  fromAccountId?: string;
  toAccountId?: string;
  notes?: string;
  refunded?: boolean;
  // display helpers
  accountName?: string;
  categoryName?: string;
  fromAccountName?: string;
  toAccountName?: string;
  warning?: string;
}

@Component({
  selector: 'app-import',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './import.html',
  styleUrl: './import.scss'
})
export class Import {
  private router = inject(Router);
  private accountService = inject(AccountService);
  private categoryService = inject(CategoryService);
  private txService = inject(TransactionService);

  step = signal<'upload' | 'preview' | 'done'>('upload');
  importing = signal(false);
  importedCount = signal(0);

  expenseRows = signal<ParsedRow[]>([]);
  incomeRows = signal<ParsedRow[]>([]);
  transferRows = signal<ParsedRow[]>([]);

  allRows = computed(() => [
    ...this.expenseRows(),
    ...this.incomeRows(),
    ...this.transferRows()
  ]);

  warningRows = computed(() =>
    this.allRows().filter(r => r.warning)
  );

  // ── Notion URL extractor ──────────────────────────────────
  private extractName(cell: string): string {
    // "Chase Credit (https://...)" → "Chase Credit"
    const match = cell.match(/^(.+?)\s*\(https?:\/\//);
    return match ? match[1].trim() : cell.trim();
  }

  private parseAmount(cell: string): number {
    return parseFloat(cell.replace(/[$,]/g, '')) || 0;
  }

  private parseDate(cell: string): string {
    // "February 21, 2026" → "2026-02-21"
    const d = new Date(cell.trim());
    if (isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  }

  // Notion name → Trackr name mappings
  private accountMappings: Record<string, string> = {
    'chase credit': 'Chase Freedom Unlimited',
    'chase debit': 'Chase Checking',
    'amex': 'AMEX',
    'discover': 'Discover',
    'cash': 'Cash',
  };

  private findAccount(name: string): { id?: string; name: string } {
    const extracted = this.extractName(name).trim();
    const extractedLower = extracted.toLowerCase();

    // Check explicit mappings first
    const mapped = this.accountMappings[extractedLower];
    const searchName = mapped || extracted;

    const accounts = this.accountService.accounts();

    // Exact match
    let match = accounts.find(a =>
        a.name.toLowerCase() === searchName.toLowerCase()
    );

    // Fuzzy match
    if (!match) {
        match = accounts.find(a =>
        a.name.toLowerCase().includes(searchName.toLowerCase()) ||
        searchName.toLowerCase().includes(a.name.toLowerCase())
        );
    }

    return match
        ? { id: match.id, name: match.name }
        : { id: undefined, name: searchName };
  }

  private categoryMappings: Record<string, string> = {
    'food & restaurants': 'Food & Restaurants',
    'financial services': 'Financial Services',
    'shopping': 'Shopping',
    'housing': 'Housing',
    'transportation': 'Transportation',
    'healthcare': 'Healthcare',
    'entertainment': 'Entertainment',
    'career development': 'Career Development',
    'travel': 'Travel',
    'charity & gifts': 'Charity & Gifts',
    'subscription': 'Subscriptions',
    'subscriptions': 'Subscriptions',
    'other': 'Other',
    'groceries & household': 'Groceries & Household',
    'personal care': 'Personal Care',
    'personal transfers': 'Personal Transfers',
    'bank fees': 'Bank Fees',
    'fines & penalties': 'Fines & Penalties',
    // existing Trackr categories
    'groceries': 'Groceries',
    'gas': 'Gas',
    'dining': 'Dining',
    'parking': 'Parking',
    'rideshare': 'RideShare',
    'car': 'Car',
    'health': 'Healthcare',
    'rent': 'Housing',
    'utilities': 'Utilities',
  };
  
  private findCategory(name: string): { id?: string; name: string } {
    const extracted = this.extractName(name).trim();
    const extractedLower = extracted.toLowerCase();

    // Check explicit mappings first
    const mapped = this.categoryMappings[extractedLower];
    const searchName = mapped || extracted;

    const categories = this.categoryService.categories();

    // Exact match
    let match = categories.find(c =>
        c.name.toLowerCase() === searchName.toLowerCase()
    );

    // Fuzzy match
    if (!match) {
        match = categories.find(c =>
        c.name.toLowerCase().includes(searchName.toLowerCase()) ||
        searchName.toLowerCase().includes(c.name.toLowerCase())
        );
    }

    return match
        ? { id: match.id, name: match.name }
        : { id: undefined, name: searchName };
  }

  // ── CSV Parser ────────────────────────────────────────────
  private parseCSV(text: string): string[][] {
    const rows: string[][] = [];
    const lines = text.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;
      const cells: string[] = [];
      let current = '';
      let inQuotes = false;

      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
          inQuotes = !inQuotes;
        } else if (ch === ',' && !inQuotes) {
          cells.push(current.trim());
          current = '';
        } else {
          current += ch;
        }
      }
      cells.push(current.trim());
      rows.push(cells);
    }

    return rows;
  }

  // ── File readers ──────────────────────────────────────────
  onExpenseFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = this.parseCSV(reader.result as string);
      this.expenseRows.set(this.parseExpenses(rows));
    };
    reader.readAsText(file);
  }

  onIncomeFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = this.parseCSV(reader.result as string);
      this.incomeRows.set(this.parseIncome(rows));
    };
    reader.readAsText(file);
  }

  onTransferFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const rows = this.parseCSV(reader.result as string);
      this.transferRows.set(this.parseTransfers(rows));
    };
    reader.readAsText(file);
  }

  // ── Parsers ───────────────────────────────────────────────
  private parseExpenses(rows: string[][]): ParsedRow[] {
    const header = rows[0];
    const idx = {
      name: header.indexOf('Name'),
      account: header.indexOf('Account'),
      amount: header.indexOf('Amount'),
      category: header.indexOf('Budget Category'),
      date: header.indexOf('Date'),
      refunded: header.indexOf('Refunded'),
      reason: header.indexOf('Reason'),
    };

    return rows.slice(1).map(row => {
      const account = this.findAccount(row[idx.account] || '');
      const category = this.findCategory(row[idx.category] || '');
      const date = this.parseDate(row[idx.date] || '');
      const refunded = (row[idx.refunded] || '').toLowerCase() === 'yes';

      const parsed: ParsedRow = {
        type: 'expense',
        merchant: row[idx.name]?.trim() || 'Unknown',
        amount: this.parseAmount(row[idx.amount] || '0'),
        date,
        accountId: account.id,
        accountName: account.name,
        categoryId: category.id,
        categoryName: category.name,
        notes: row[idx.reason]?.trim() || undefined,
        refunded,
      };

      if (!account.id) parsed.warning = `Account "${account.name}" not found in Trackr`;
      if (!date) parsed.warning = (parsed.warning ? parsed.warning + '; ' : '') + 'Invalid date';

      return parsed;
    }).filter(r => r.merchant && r.amount > 0);
  }

  private parseIncome(rows: string[][]): ParsedRow[] {
    const header = rows[0];
    const idx = {
      name: header.indexOf('Name'),
      account: header.indexOf('Account'),
      amount: header.indexOf('Amount'),
      date: header.indexOf('Date'),
      reason: header.indexOf('Reason'),
    };

    return rows.slice(1).map(row => {
      const account = this.findAccount(row[idx.account] || '');
      const date = this.parseDate(row[idx.date] || '');

      const parsed: ParsedRow = {
        type: 'income',
        merchant: row[idx.name]?.trim() || 'Unknown',
        amount: this.parseAmount(row[idx.amount] || '0'),
        date,
        accountId: account.id,
        accountName: account.name,
        notes: row[idx.reason]?.trim() || undefined,
      };

      if (!account.id) parsed.warning = `Account "${account.name}" not found in Trackr`;
      if (!date) parsed.warning = (parsed.warning ? parsed.warning + '; ' : '') + 'Invalid date';

      return parsed;
    }).filter(r => r.merchant && r.amount > 0);
  }

  private parseTransfers(rows: string[][]): ParsedRow[] {
    const header = rows[0];
    const idx = {
      name: header.indexOf('Transfer'),
      amount: header.indexOf('Amount'),
      date: header.indexOf('Date'),
      from: header.indexOf('From'),
      to: header.indexOf('To'),
    };

    return rows.slice(1).map(row => {
      const from = this.findAccount(row[idx.from] || '');
      const to = this.findAccount(row[idx.to] || '');
      const date = this.parseDate(row[idx.date] || '');

      const parsed: ParsedRow = {
        type: 'transfer',
        merchant: row[idx.name]?.trim() || 'Transfer',
        amount: this.parseAmount(row[idx.amount] || '0'),
        date,
        fromAccountId: from.id,
        fromAccountName: from.name,
        toAccountId: to.id,
        toAccountName: to.name,
      };

      if (!from.id) parsed.warning = `From account "${from.name}" not found`;
      if (!to.id) parsed.warning = (parsed.warning ? parsed.warning + '; ' : '') + `To account "${to.name}" not found`;
      if (!date) parsed.warning = (parsed.warning ? parsed.warning + '; ' : '') + 'Invalid date';

      return parsed;
    }).filter(r => r.amount > 0);
  }

  // ── Preview & Import ──────────────────────────────────────
  goToPreview() {
    if (this.allRows().length === 0) {
      alert('Upload at least one CSV file first');
      return;
    }
    this.step.set('preview');
  }

  async seedCategories() {
    const newCats = [
      { name: 'Food & Restaurants', icon: '🍽️', color: '#ef4444' },
      { name: 'Financial Services', icon: '🏛️', color: '#3b82f6' },
      { name: 'Housing',            icon: '🏠', color: '#6366f1' },
      { name: 'Transportation',     icon: '🚌', color: '#f59e0b' },
      { name: 'Healthcare',         icon: '💊', color: '#14b8a6' },
      { name: 'Career Development', icon: '💼', color: '#8b5cf6' },
      { name: 'Travel',             icon: '✈️', color: '#06b6d4' },
      { name: 'Charity & Gifts',    icon: '🎁', color: '#ec4899' },
      { name: 'Groceries & Household', icon: '🛒', color: '#10b981' },
      { name: 'Personal Care',      icon: '🪥', color: '#a855f7' },
      { name: 'Personal Transfers', icon: '🔄', color: '#64748b' },
      { name: 'Bank Fees',          icon: '🏦', color: '#dc2626' },
      { name: 'Fines & Penalties',  icon: '⚠️', color: '#f97316' },
    ];

    const existing = this.categoryService.categories().map(c => c.name.toLowerCase());

    let added = 0;
    for (const cat of newCats) {
      if (!existing.includes(cat.name.toLowerCase())) {
        await this.categoryService.add({
          name: cat.name,
          icon: cat.icon,
          color: cat.color,
          kind: 'expense',
          archived: false,
        });
        added++;
      }
    }
    alert(`✅ Added ${added} new categories. ${newCats.length - added} already existed.`);
  }
  
  async runImport() {
    this.importing.set(true);
    let count = 0;

    try {
      for (const row of this.allRows()) {
        const tx: Omit<Transaction, 'id' | 'createdAt' | 'updatedAt'> = {
          type: row.type,
          amount: row.amount,
          date: row.date,
        };

        if (row.type === 'transfer') {
          tx.fromAccountId = row.fromAccountId;
          tx.toAccountId = row.toAccountId;
          tx.merchant = row.merchant;
        } else {
          tx.merchant = row.merchant;
          tx.accountId = row.accountId;
          if (row.categoryId) tx.categoryId = row.categoryId;
          if (row.notes) tx.notes = row.notes;
          if (row.refunded) tx.refunded = true;
        }

        await this.txService.add(tx);
        count++;
      }

      this.importedCount.set(count);
      this.step.set('done');
    } catch (err) {
      alert('Import failed: ' + (err as Error).message);
    } finally {
      this.importing.set(false);
    }
  }

  goBack() { this.step.set('upload'); }
  goToTransactions() { this.router.navigate(['/transactions']); }
}