import { describe, it, expect } from 'vitest';
import { Transaction } from '../models';
import { merchantKey, spendingAlerts } from './alerts';

const TODAY = '2026-10-19';
let n = 0;
const tx = (merchant: string, amount: number, date: string, over: Partial<Transaction> = {}): Transaction =>
  ({ id: `t${++n}`, type: 'expense', merchant, amount, date, accountId: 'card', ...over }) as Transaction;

describe('spending alerts', () => {
  it('flags a charge well above the usual at that merchant', () => {
    const txs = [
      tx('The Kebab Shop', 18, '2026-07-02'), tx('The Kebab Shop', 22, '2026-08-10'),
      tx('The Kebab Shop', 20, '2026-09-05'), tx('The Kebab Shop', 84.19, '2026-10-15'),
    ];
    const [a] = spendingAlerts(txs, TODAY);
    expect(a).toMatchObject({ kind: 'big', usual: 20, tx: { amount: 84.19 } });
  });

  it('leaves a merchant alone until it has some history, and small bumps alone', () => {
    expect(spendingAlerts([tx('New Place', 300, '2026-10-15')], TODAY)).toEqual([]);
    const txs = [tx('Cafe', 4, '2026-08-01'), tx('Cafe', 4, '2026-08-20'), tx('Cafe', 5, '2026-09-10'), tx('Cafe', 12, '2026-10-15')];
    expect(spendingAlerts(txs, TODAY)).toEqual([]);
  });

  it('flags the same charge twice within a day, but not two on different accounts', () => {
    const a = tx('DoorDash', 23.5, '2026-10-12');
    const b = tx('DOORDASH*', 23.5, '2026-10-13');
    const other = tx('DoorDash', 23.5, '2026-10-13', { accountId: 'checking' });
    const alerts = spendingAlerts([a, b, other], TODAY).filter(x => x.kind === 'twice');
    expect(alerts.map(x => [x.other?.id, x.tx.id])).toEqual([[a.id, b.id]]);
  });

  it('flags a monthly charge that went up', () => {
    const txs = [tx('Netflix', 15.49, '2026-07-18'), tx('Netflix', 15.49, '2026-08-18'), tx('Netflix', 17.99, '2026-09-18')];
    const [a] = spendingAlerts(txs, TODAY);
    expect(a).toMatchObject({ kind: 'price', usual: 15.49, tx: { amount: 17.99 } });
  });

  it('ignores old charges, transfers and paying friends back', () => {
    const txs = [
      tx('Gym', 30, '2026-05-01'), tx('Gym', 30, '2026-05-01'),
      tx('Chase Autopay', 900, '2026-10-15', { isInternalTransfer: true }),
      tx('Chase Autopay', 900, '2026-10-15', { isInternalTransfer: true }),
      tx('Venmo', 40, '2026-10-15', { settlement: { personId: 'p' } }),
      tx('Venmo', 40, '2026-10-15', { settlement: { personId: 'p' } }),
    ];
    expect(spendingAlerts(txs, TODAY)).toEqual([]);
  });

  it('matches merchant names without numbers and punctuation', () => {
    expect(merchantKey('UBER *TRIP 1234')).toBe(merchantKey('Uber Trip'));
  });
});
