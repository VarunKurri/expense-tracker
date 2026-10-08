import { signal } from '@angular/core';
import { TestBed, ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { NetWorth } from './net-worth';
import { AccountService } from '../../services/account.service';
import { TransactionService } from '../../services/transaction.service';
import { ManualAssetService } from '../../services/manual-asset.service';
import { BillService } from '../../services/bill.service';
import { Account, ManualAsset, Transaction } from '../../models';
import { MoneyBackLedger } from '../../utils/money-back';
import { localDateString } from '../../utils/date';

/** The real money-back logic, over a fixed list of transactions. */
class FakeTransactions extends MoneyBackLedger {
  constructor(public transactions: () => Transaction[]) { super(); }
}

/** In-memory stand-in that serialises like the encrypted Firestore service. */
class FakeManual {
  items = signal<ManualAsset[]>([]);
  error = signal<string | null>(null);
  private n = 0;
  async add(m: Omit<ManualAsset, 'id' | 'createdAt' | 'updatedAt'>) {
    this.items.update(all => [...all, { ...m, id: `m${++this.n}`, createdAt: 1, updatedAt: 1 }]);
  }
  async update(id: string, patch: Partial<ManualAsset>) {
    this.items.update(all => all.map(m => m.id === id ? JSON.parse(JSON.stringify({ ...m, ...patch })) : m));
  }
  async remove(id: string) { this.items.update(all => all.filter(m => m.id !== id)); }
}

const today = localDateString();
const checking: Account = { id: 'chk', name: 'Chase College', type: 'checking', openingBalance: 2000, currency: 'USD', createdAt: 0 };
const card: Account = { id: 'card', name: 'Freedom Unlimited', type: 'credit', openingBalance: 500, currency: 'USD', createdAt: 0 };

describe('Net worth page', () => {
  let fixture: ComponentFixture<NetWorth>;
  let manual: FakeManual;
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

  function fill(selector: string, value: string) {
    const input = el.querySelector(`app-asset-form ${selector}`) as HTMLInputElement | HTMLSelectElement;
    input.value = value;
    input.dispatchEvent(new Event(input.tagName === 'SELECT' ? 'change' : 'input'));
  }

  async function setup(items: ManualAsset[] = [], txs: Transaction[] = []) {
    manual = new FakeManual();
    manual.items.set(items);
    TestBed.configureTestingModule({
      imports: [NetWorth],
      providers: [
        provideRouter([]),
        { provide: AccountService, useValue: { accounts: signal([checking, card]) } },
        {
          provide: TransactionService,
          useValue: new FakeTransactions(signal(txs)),
        },
        { provide: ManualAssetService, useValue: manual },
        { provide: BillService, useValue: { bills: signal([]) } },
      ],
    });
    fixture = TestBed.createComponent(NetWorth);
    el = fixture.nativeElement;
    await settle();
  }

  const figure = () => el.querySelector('.hero-figure')!.textContent!.trim();

  it('shows accounts on the right sides and nets them', async () => {
    await setup();
    expect(figure()).toBe('$1,500.00');
    const [assets, debts] = [...el.querySelectorAll('.side')];
    expect(assets.textContent).toContain('Chase College');
    expect(assets.querySelector('.side-total')!.textContent).toContain('$2,000.00');
    expect(debts.textContent).toContain('Credit cards');
    expect(debts.textContent).toContain('$500.00');
    expect(el.querySelector('.hero-sentence')!.textContent).toContain('You own $2,000.00 and owe $500.00.');
    expect(el.querySelector('.promo')).not.toBeNull(); // invites adding a home, car, loan
  });

  it('adds an asset from today, and it counts', async () => {
    await setup();
    button('+ Add asset or debt').click();
    await settle();
    fill('select', 'vehicle');
    fill('input[name=name]', 'Civic');
    fill('input[name=value]', '15000');
    await settle();
    button('Add').click();
    await settle();

    expect(manual.items()).toEqual([expect.objectContaining({
      name: 'Civic', type: 'vehicle', valuations: [{ date: today, value: 15000 }],
    })]);
    expect(figure()).toBe('$16,500.00');
    expect(el.querySelector('.sides')!.textContent).toContain('Vehicles');
    expect(el.querySelector('.promo')).toBeNull();
  });

  it('updating a value keeps the old one in history', async () => {
    await setup([{ id: 'car', name: 'Civic', type: 'vehicle', createdAt: 1, updatedAt: 1,
      valuations: [{ date: '2025-01-01', value: 18000 }] }]);
    expect(figure()).toBe('$19,500.00');

    [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('Civic'))!.dispatchEvent(new Event('click'));
    await settle();
    expect(el.querySelector('app-asset-form')!.textContent).toContain('Value history');
    fill('input[name=value]', '14500');
    await settle();
    button('Save changes').click();
    await settle();

    expect(manual.items()[0].valuations).toEqual([
      { date: '2025-01-01', value: 18000 },
      { date: today, value: 14500 },
    ]);
    expect(figure()).toBe('$16,000.00');
  });

  it('a debt subtracts', async () => {
    await setup([{ id: 'loan', name: 'Civic loan', type: 'auto-loan', createdAt: 1, updatedAt: 1,
      valuations: [{ date: '2026-01-01', value: 9000 }] }]);
    expect(figure()).toBe('−$7,500.00');
    expect(el.querySelectorAll('.side')[1].textContent).toContain('Loans');
  });

  it('deletes after confirming', async () => {
    await setup([{ id: 'car', name: 'Civic', type: 'vehicle', createdAt: 1, updatedAt: 1,
      valuations: [{ date: '2025-01-01', value: 18000 }] }]);
    [...el.querySelectorAll('.row')].find(r => r.textContent!.includes('Civic'))!.dispatchEvent(new Event('click'));
    await settle();
    button('Delete').click();
    await settle();
    expect(el.textContent).toContain('past months included');
    [...el.querySelectorAll('app-confirm button')].find(b => b.textContent!.trim() === 'Delete')!.dispatchEvent(new Event('click'));
    await settle();
    expect(manual.items()).toEqual([]);
    expect(figure()).toBe('$1,500.00');
  });

  it('the range chips change the change line', async () => {
    await setup([], [
      { type: 'income', accountId: 'chk', amount: 300, date: today, createdAt: 0, updatedAt: 0 } as Transaction,
    ]);
    expect(el.querySelector('.hero-change')!.textContent).toContain('+$300.00');
    expect(el.querySelector('.hero-change')!.textContent).toContain('over the past 3 months');
    button('1Y').click();
    await settle();
    expect(el.querySelector('.hero-change')!.textContent).toContain('over the past year');
  });

  it('"+6M ahead" carries the line on, dashed, from the forecast', async () => {
    // Three months of $3,000 pay and $2,000 spending: about $1,000 a month saved.
    const month = (n: number, day: number) => {
      const d = new Date(); return localDateString(new Date(d.getFullYear(), d.getMonth() - n, day));
    };
    const txs: Transaction[] = [];
    for (const n of [1, 2, 3]) {
      txs.push({ type: 'income', accountId: 'chk', amount: 3000, date: month(n, 1), createdAt: 0, updatedAt: 0 } as Transaction);
      txs.push({ type: 'expense', accountId: 'chk', amount: 2000, date: month(n, 15), createdAt: 0, updatedAt: 0 } as Transaction);
    }
    await setup([], txs);
    const nw = fixture.componentInstance;
    expect(nw.projection()).toEqual([]);
    expect(el.querySelector('.projection-note')).toBeNull();

    button('+6M ahead').click();
    await settle();
    const ahead = nw.projection();
    expect(ahead).toHaveLength(7);   // the rest of this month, then six month-ends
    expect(ahead[6].net - ahead[0].net).toBeCloseTo(6000, -1);
    expect(nw.chartPoints().filter(p => p.projected)).toHaveLength(7);
    expect(el.querySelector('.projection-note')!.textContent).toContain('See the forecast');

    // Scrubbing into the future says so.
    nw.hoverIndex.set(nw.chartPoints().length - 1);
    await settle();
    expect(el.querySelector('.hero .card-label')!.textContent).toContain('Projected for');
  });
});
