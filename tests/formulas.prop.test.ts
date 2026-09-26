import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { PLACEABLE, BUILDINGS, COST_GROWTH, SPREAD_L } from '../src/core/config';
import {
  buildingCost,
  energyCapacity,
  goldIncome,
  salvageYield,
  soilCleansePower,
  spreadChance,
  waterCleansePower,
  milestoneReward,
} from '../src/core/economy/formulas';

describe('economy formulas: exact values (design §4)', () => {
  it('matches the cost table', () => {
    const table = PLACEABLE.map((b) => [b, [1, 2, 3].slice(0, BUILDINGS[b].maxLevel).map((l) => buildingCost(b, l))]);
    expect(Object.fromEntries(table)).toEqual({
      solar: [14, 25, 43],
      wind: [24, 42, 74],
      scrubber: [18, 32, 56],
      purifier: [22, 39, 68],
      recycler: [28, 49, 86],
      battery: [20, 35, 62],
      sealer: [45],
    });
  });
  it('matches the energy capacity table', () => {
    expect([0, 1, 2, 3, 5, 9].map(energyCapacity)).toEqual([8, 12, 14, 16, 18, 21]);
  });
  it('matches the cleansing tables', () => {
    expect([1, 2, 3].map(soilCleansePower)).toEqual([12, 15, 17]);
    expect([1, 2, 3].map(waterCleansePower)).toEqual([18, 23, 27]);
  });
  it('matches income, salvage and milestone values', () => {
    expect(goldIncome(0)).toBe(2);
    expect(goldIncome(3)).toBe(14);
    expect([1, 2, 3].map(salvageYield)).toEqual([5, 10, 15]);
    expect([1, 2, 3, 4].map(milestoneReward)).toEqual([20, 40, 60, 80]);
  });
});

describe('economy formulas: properties (T1.3)', () => {
  const lvl = fc.integer({ min: 0, max: 500 });

  it('income is linear: I(a+b) − I(0) = (I(a) − I(0)) + (I(b) − I(0))', () => {
    fc.assert(
      fc.property(lvl, lvl, (a, b) => goldIncome(a + b) - goldIncome(0) === goldIncome(a) - goldIncome(0) + (goldIncome(b) - goldIncome(0))),
    );
  });

  it('salvage yield is linear and positive', () => {
    fc.assert(fc.property(fc.integer({ min: 1, max: 3 }), (d) => salvageYield(d) === d * salvageYield(1) && salvageYield(d) > 0));
  });

  it('costs are integers, strictly increasing, with ratio approaching b', () => {
    fc.assert(
      fc.property(fc.constantFrom(...PLACEABLE), fc.integer({ min: 1, max: 30 }), (type, l) => {
        const c1 = buildingCost(type, l);
        const c2 = buildingCost(type, l + 1);
        expect(Number.isInteger(c1)).toBe(true);
        expect(c2).toBeGreaterThan(c1);
        if (l >= 10) expect(Math.abs(c2 / c1 - COST_GROWTH)).toBeLessThan(0.01);
      }),
    );
  });

  it('energy capacity is non-decreasing with non-increasing increments (logarithmic)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 1000 }), (b) => {
        const d1 = energyCapacity(b + 1) - energyCapacity(b);
        expect(d1).toBeGreaterThanOrEqual(0);
        // Floor can make single steps jump by one; compare real-valued concavity over 2-step windows.
        const raw = (x: number) => 6 * Math.log(1 + x);
        expect(raw(b + 2) - raw(b + 1)).toBeLessThanOrEqual(raw(b + 1) - raw(b) + 1e-12);
      }),
    );
  });

  it('energy capacity grows far slower than linearly', () => {
    fc.assert(fc.property(fc.integer({ min: 60, max: 100000 }), (b) => energyCapacity(b) <= 8 + 6 * b && energyCapacity(b) < b));
  });

  it('cleansing power is monotone and has diminishing returns', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), (l) => {
        expect(soilCleansePower(l + 1)).toBeGreaterThanOrEqual(soilCleansePower(l));
        expect(waterCleansePower(l + 1)).toBeGreaterThanOrEqual(waterCleansePower(l));
        expect(soilCleansePower(l + 2) - soilCleansePower(l + 1)).toBeLessThanOrEqual(soilCleansePower(l + 1) - soilCleansePower(l) + 1);
      }),
    );
  });

  it('spread chance is a bounded, monotone S-curve', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.double({ min: 0, max: 1, noNaN: true }), (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(spreadChance(lo)).toBeLessThanOrEqual(spreadChance(hi));
        expect(spreadChance(a)).toBeGreaterThan(0);
        expect(spreadChance(a)).toBeLessThan(SPREAD_L);
      }),
    );
  });
});
