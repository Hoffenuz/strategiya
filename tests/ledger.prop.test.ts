import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  creditGold,
  produceEnergy,
  setEnergyMax,
  tryConsumeEnergy,
  tryDebitGold,
  type EnergyLedger,
  type GoldLedger,
} from '../src/core/economy/ledger';

type Op =
  | { op: 'credit'; n: number }
  | { op: 'debit'; n: number }
  | { op: 'produce'; n: number }
  | { op: 'consume'; n: number }
  | { op: 'max'; n: number };

const arbOp: fc.Arbitrary<Op> = fc.oneof(
  fc.record({ op: fc.constant('credit' as const), n: fc.nat(200) }),
  fc.record({ op: fc.constant('debit' as const), n: fc.nat(200) }),
  fc.record({ op: fc.constant('produce' as const), n: fc.nat(40) }),
  fc.record({ op: fc.constant('consume' as const), n: fc.nat(40) }),
  fc.record({ op: fc.constant('max' as const), n: fc.nat(30) }),
);

function check(g: GoldLedger, e: EnergyLedger): void {
  // Invariant 1: consumed + current = produced
  expect(e.consumed + e.current).toBe(e.produced);
  // Invariant 2: spent + balance = earned
  expect(g.spent + g.balance).toBe(g.earned);
  // Invariant 3: non-negative
  expect(g.balance).toBeGreaterThanOrEqual(0);
  expect(e.current).toBeGreaterThanOrEqual(0);
  // Invariant 4: capacity
  expect(e.current).toBeLessThanOrEqual(e.max);
}

describe('ledger invariants (T2.1)', () => {
  it('any sequence of ledger operations keeps conservation, non-negativity and capacity', () => {
    fc.assert(
      fc.property(fc.nat(100), fc.integer({ min: 0, max: 30 }), fc.array(arbOp, { maxLength: 300 }), (g0, max, ops) => {
        const g: GoldLedger = { balance: g0, earned: g0, spent: 0 };
        const e: EnergyLedger = { current: 0, produced: 0, consumed: 0, curtailed: 0, max };
        check(g, e);
        for (const o of ops) {
          const before = JSON.stringify([g, e]);
          switch (o.op) {
            case 'credit':
              creditGold(g, o.n);
              break;
            case 'debit':
              if (!tryDebitGold(g, o.n)) expect(JSON.stringify([g, e])).toBe(before);
              break;
            case 'produce': {
              const added = produceEnergy(e, o.n);
              expect(added).toBeLessThanOrEqual(o.n);
              break;
            }
            case 'consume':
              if (!tryConsumeEnergy(e, o.n)) expect(JSON.stringify([g, e])).toBe(before);
              break;
            case 'max':
              setEnergyMax(e, o.n);
              break;
          }
          check(g, e);
        }
      }),
    );
  });

  it('curtailed energy never counts as produced', () => {
    fc.assert(
      fc.property(fc.nat(20), fc.array(fc.nat(30), { maxLength: 50 }), (max, amounts) => {
        const e: EnergyLedger = { current: 0, produced: 0, consumed: 0, curtailed: 0, max };
        let offered = 0;
        for (const a of amounts) {
          produceEnergy(e, a);
          offered += a;
        }
        expect(e.produced + e.curtailed).toBe(offered);
        expect(e.produced).toBeLessThanOrEqual(max);
      }),
    );
  });

  it('rejects negative or fractional amounts', () => {
    const g: GoldLedger = { balance: 5, earned: 5, spent: 0 };
    expect(() => creditGold(g, -1)).toThrow();
    expect(() => tryDebitGold(g, 1.5)).toThrow();
  });
});
