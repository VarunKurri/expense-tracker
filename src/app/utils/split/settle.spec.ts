// Ported verbatim from VarunKurri/split-the-bill src/domain/settle.test.ts @ cc6a8db.

import { describe, expect, it } from 'vitest';
import { settle, type NetPosition } from './settle';
import { sum } from './money';

function net(personId: string, netCents: number): NetPosition {
  return { personId, netCents };
}

describe('settle', () => {
  it('asks nobody for anything when everyone is square', () => {
    expect(settle([net('a', 0), net('b', 0)])).toEqual([]);
  });

  it('returns no transfers when nobody has paid', () => {
    // Everyone owes the restaurant; none of them owe each other.
    expect(settle([net('a', -1000), net('b', -2000)])).toEqual([]);
  });

  it('sends one debtor straight to one creditor', () => {
    expect(settle([net('a', -1500), net('b', 1500)])).toEqual([
      { fromPersonId: 'a', toPersonId: 'b', amountCents: 1500 },
    ]);
  });

  it('settles the common case: one person paid for everyone', () => {
    const transfers = settle([
      net('payer', 6000),
      net('a', -2000),
      net('b', -2000),
      net('c', -2000),
    ]);

    expect(transfers).toHaveLength(3);
    expect(transfers.every((t) => t.toPersonId === 'payer')).toBe(true);
    expect(sum(transfers.map((t) => t.amountCents))).toBe(6000);
  });

  it('handles two payers covering four people', () => {
    const positions = [
      net('p1', 4000),
      net('p2', 1000),
      net('a', -2000),
      net('b', -2000),
      net('c', -1000),
    ];
    const transfers = settle(positions);

    // Every creditor ends up whole and every debtor ends up clear.
    for (const position of positions) {
      const received = sum(
        transfers.filter((t) => t.toPersonId === position.personId).map((t) => t.amountCents),
      );
      const sent = sum(
        transfers.filter((t) => t.fromPersonId === position.personId).map((t) => t.amountCents),
      );
      expect(received - sent).toBe(position.netCents);
    }
  });

  it('never needs more than n-1 transfers', () => {
    const transfers = settle([
      net('a', 5000),
      net('b', 3000),
      net('c', -1000),
      net('d', -2500),
      net('e', -4500),
    ]);
    expect(transfers.length).toBeLessThanOrEqual(4);
  });

  it('invents no money: what leaves the debtors arrives at the creditors', () => {
    const transfers = settle([net('a', 1234), net('b', -567), net('c', -667)]);
    expect(sum(transfers.map((t) => t.amountCents))).toBe(1234);
  });

  it('never asks anyone to send more than they owe', () => {
    const positions = [net('a', 900), net('b', 100), net('c', -450), net('d', -550)];
    const transfers = settle(positions);

    for (const position of positions.filter((p) => p.netCents < 0)) {
      const sent = sum(
        transfers.filter((t) => t.fromPersonId === position.personId).map((t) => t.amountCents),
      );
      expect(sent).toBeLessThanOrEqual(-position.netCents);
    }
  });

  it('leaves the shortfall outstanding rather than fabricating a transfer', () => {
    // $30 owed between them, but only $10 has been paid.
    const transfers = settle([net('payer', 1000), net('a', -1500), net('b', -1500)]);

    expect(sum(transfers.map((t) => t.amountCents))).toBe(1000);
    const stillOwed =
      3000 - sum(transfers.map((t) => t.amountCents)) - 1000; /* payer's own share */
    expect(stillOwed).toBe(1000);
  });

  it('is deterministic across calls', () => {
    const positions = [net('c', -2000), net('a', 3000), net('b', -1000)];
    expect(settle(positions)).toEqual(settle(positions));
  });

  it('does not mutate the positions it is given', () => {
    const positions = [net('a', 1000), net('b', -1000)];
    settle(positions);
    expect(positions).toEqual([net('a', 1000), net('b', -1000)]);
  });

  it('balances across a sweep of awkward splits', () => {
    for (let total = 1; total <= 400; total += 7) {
      for (let people = 2; people <= 6; people += 1) {
        // One payer covers the lot; everyone owes an equal-ish share.
        const each = Math.floor(total / people);
        const remainder = total - each * people;

        const positions: NetPosition[] = [];
        positions.push(net('payer', total - each - remainder));
        for (let i = 1; i < people; i += 1) positions.push(net(`p${i}`, -each));

        const transfers = settle(positions);
        const moved = sum(transfers.map((t) => t.amountCents));
        const owedToCreditors = sum(positions.filter((p) => p.netCents > 0).map((p) => p.netCents));
        const owedByDebtors = sum(positions.filter((p) => p.netCents < 0).map((p) => -p.netCents));

        // Whatever moves is capped by both sides, and clears the smaller one.
        expect(moved).toBe(Math.min(owedToCreditors, owedByDebtors));
        expect(transfers.every((t) => t.amountCents > 0)).toBe(true);
      }
    }
  });
});
