import { vi } from 'vitest';
import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { Forecast } from './forecast';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { BillService } from '../../services/bill.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { CategoryService } from '../../services/category.service';
import { Account, Bill, ManualAsset, Transaction } from '../../models';
import { MoneyBackLedger } from '../../utils/money-back';
import { localDateString } from '../../utils/date';

/** The real money-back logic, over a fixed list of transactions. */
class FakeTransactions extends MoneyBackLedger {
  constructor(public transactions: () => Transaction[]) { super(); }
}

const checking: Account = { id: 'chk', name: 'Checking', type: 'checking', openingBalance: 1000, currency: 'USD', createdAt: 0 };

/** A date `n` months back (or ahead, if negative), on `day`. */
function monthsAgo(n: number, day: number): string {
  const d = new Date();
  return localDateString(new Date(d.getFullYear(), d.getMonth() - n, day));
}

/** Three months of $3,000 pay and $2,000 spending; the middle one has a $1,500 laptop. */
function history(): Transaction[] {
  const out: Transaction[] = [];
  let id = 0;
  for (const n of [1, 2, 3]) {
    out.push({ id: `i${++id}`, type: 'income', accountId: 'chk', amount: 3000, date: monthsAgo(n, 1), merchant: 'Payroll', createdAt: 0, updatedAt: 0 } as Transaction);
    out.push({ id: `e${++id}`, type: 'expense', accountId: 'chk', amount: 2000, date: monthsAgo(n, 15), merchant: 'Life', createdAt: 0, updatedAt: 0 } as Transaction);
  }
  out.push({ id: 'laptop', type: 'expense', accountId: 'chk', amount: 1500, date: monthsAgo(2, 20), merchant: 'Laptop', createdAt: 0, updatedAt: 0 } as Transaction);
  return out;
}

describe('Forecast page', () => {
  let fixture: ComponentFixture<Forecast>;
  let el: HTMLElement;

  async function settle() {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function button(text: string): HTMLButtonElement {
    const b = [...el.querySelectorAll('button')].find(x => x.textContent!.trim().startsWith(text));
    if (!b) throw new Error(`No button "${text}"`);
    return b as HTMLButtonElement;
  }

  async function setup(txs: Transaction[], bills: Bill[] = [], manual: ManualAsset[] = []) {
    try { localStorage.removeItem('trackr.forecast.excluded'); } catch { /* fine */ }
    TestBed.configureTestingModule({
      imports: [Forecast],
      providers: [
        provideRouter([]),
        { provide: AccountService, useValue: { accounts: signal([checking]) } },
        {
          provide: TransactionService,
          useValue: new FakeTransactions(signal(txs)),
        },
        { provide: BillService, useValue: { bills: signal(bills) } },
        { provide: ManualAssetService, useValue: { items: signal(manual), error: signal(null) } },
        {
          provide: CategoryService,
          useValue: { categories: signal([
            { id: 'groceries', name: 'Groceries', icon: '🛒', kind: 'expense', createdAt: 0 },
            { id: 'fun', name: 'Entertainment', icon: '🎬', kind: 'expense', createdAt: 0 },
          ]) },
        },
      ],
    });
    fixture = TestBed.createComponent(Forecast);
    el = fixture.nativeElement;
    await settle();
  }

  it('with no history, it says it needs some instead of guessing', async () => {
    await setup([]);
    expect(el.querySelector('.empty')!.textContent).toContain('a month of history');
    expect(el.querySelector('.hero')).toBeNull();
  });

  it('shows where cash is heading, month by month, and why', async () => {
    await setup(history());
    const f = fixture.componentInstance.f();
    expect(f.startCash).toBe(1000 + 3 * 1000 - 1500);
    expect(el.querySelector('.hero .card-label')!.textContent).toContain('Cash by');
    expect(el.querySelector('.hero .tag')!.textContent).toContain('Projected');
    // The laptop month drags the average: $2,500 a month spent, $500 saved.
    expect(el.querySelector('.hero-sentence')!.textContent).toContain('put away about $500 a month');
    expect(el.querySelectorAll('.month-row:not(.head)')).toHaveLength(7);  // rest of this month + 6
    expect(el.querySelector('.month-row:not(.head)')!.textContent).toContain('(rest)');
  });

  it('leaving out the one-off month changes the pace — on the same card as what it changes', async () => {
    await setup(history());
    const card = el.querySelector('.typical')!;
    // The months, the choice of how many, and the figures they make are one card.
    expect(card.querySelector('.spans')!.textContent).toContain('Last 3');
    const tiles = [...card.querySelectorAll('.month-tile')];
    expect(tiles).toHaveLength(3);
    expect(card.querySelector('.typical-figures')!.textContent).toContain('$2,500');
    const laptopMonth = tiles[1] as HTMLButtonElement;
    laptopMonth.click();
    await settle();
    expect(laptopMonth.classList).toContain('off');
    expect(laptopMonth.getAttribute('aria-pressed')).toBe('false');
    expect(card.querySelector('.typical-figures')!.textContent).toContain('$2,000');
    expect(el.querySelector('.hero-sentence')!.textContent).toContain('put away about $1,000 a month');
    // The explanation card below has no controls of its own any more.
    expect(el.querySelector('.basis .chip')).toBeNull();
    // Remembered on this device.
    expect(JSON.parse(localStorage.getItem('trackr.forecast.excluded')!)).toHaveLength(1);
  });

  it('bills land on their dates and show in the next 30 days', async () => {
    const d = new Date(); d.setDate(d.getDate() + 10);
    const soon = localDateString(d);
    const insurance: Bill = {
      id: 'ins', name: 'Car insurance', amount: 1140, frequency: 'yearly', nextDueDate: soon,
      autopayEnabled: false, active: true, createdAt: 0,
    };
    await setup(history(), [insurance]);
    expect(el.querySelector('.soon')!.textContent).toContain('Car insurance');
    expect(el.querySelector('.hero-sentence')!.textContent).toContain('Car insurance ($1,140)');
    // Open the month it falls in: the bill is listed there.
    const at = fixture.componentInstance.f().months.findIndex(m => m.month === soon.slice(0, 7));
    expect(fixture.componentInstance.f().months[at].bills).toBe(1140);
    const row = [...el.querySelectorAll('.month-row:not(.head)')][at] as HTMLButtonElement;
    row.click();
    await settle();
    expect(el.querySelector('.month-detail')!.textContent).toContain('Car insurance');
  });

  it('the horizon chips change how far it looks', async () => {
    await setup(history());
    button('3 months').click();
    await settle();
    expect(el.querySelectorAll('.month-row:not(.head)')).toHaveLength(4);
    button('12 months').click();
    await settle();
    expect(el.querySelectorAll('.month-row:not(.head)')).toHaveLength(13);
  });

  it('breaks everyday spending into categories that add up, and opens their transactions', async () => {
    const txs = history().map(t => (t.type === 'expense' && t.id !== 'laptop' ? { ...t, categoryId: 'groceries' } : t));
    // Netflix: a bill whose payments are filed under Entertainment, so it comes off there.
    for (const n of [1, 2, 3]) {
      txs.push({ id: `nf${n}`, type: 'expense', accountId: 'chk', amount: 20, date: monthsAgo(n, 5), merchant: 'NETFLIX.COM', categoryId: 'fun', createdAt: 0, updatedAt: 0 } as Transaction);
    }
    const netflix: Bill = { id: 'nf', name: 'Netflix', amount: 20, frequency: 'monthly', nextDueDate: monthsAgo(-1, 5), autopayEnabled: true, active: true, createdAt: 0 };
    await setup(txs, [netflix]);

    const card = el.querySelector('.typical')!;
    const rows = [...card.querySelectorAll('.cat-row')];
    // Groceries $2,000 a month; the laptop month adds $500 uncategorised; Netflix nets to nothing.
    expect(rows.map(r => r.querySelector('.cat-name')!.textContent!.trim())).toEqual(['Groceries', 'Uncategorised', 'Entertainment']);
    expect(rows[0].querySelector('.cat-amount')!.textContent).toContain('$2,000');
    expect(rows[2].textContent).toContain('All bills (Netflix)');
    expect(card.querySelector('.everyday-total')!.textContent).toContain('$2,500');
    expect(card.querySelector('.everyday-sentence')!.textContent).toContain('Groceries is the biggest part, at $2,000 (80%)');

    const nav = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
    (rows[0] as HTMLButtonElement).click();
    expect(nav).toHaveBeenCalledWith(['/transactions'], {
      queryParams: expect.objectContaining({ view: 'analysis', categoryId: 'groceries', start: `${monthsAgo(3, 1).slice(0, 7)}-01` }),
    });
  });

  it('a bill nobody filed is shown as its own line, not hidden in a category', async () => {
    const gym: Bill = { id: 'gym', name: 'Gym', amount: 40, frequency: 'monthly', nextDueDate: monthsAgo(-1, 2), autopayEnabled: true, active: true, createdAt: 0 };
    await setup(history(), [gym]);
    const unfiled = el.querySelector('.typical .unfiled')!;
    expect(unfiled.textContent).toContain('Gym');
    expect(unfiled.textContent).toContain('−$40');
    expect(el.querySelector('.everyday-total')!.textContent).toContain('$2,460');
  });
});
