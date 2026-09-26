import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { next, nextInt, seedRng, shuffled } from '../src/core/rng';

describe('seeded PRNG (T1.5)', () => {
  it('is deterministic per seed and yields [0, 1)', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = seedRng(seed);
        const b = seedRng(seed);
        for (let i = 0; i < 50; i++) {
          const v = next(a);
          expect(v).toBe(next(b));
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
        }
      }),
    );
  });

  it('resumes from a serialized state', () => {
    const a = seedRng(42);
    next(a);
    const saved = JSON.parse(JSON.stringify(a));
    expect(next(saved)).toBe(next(a));
  });

  it('nextInt stays in range and shuffle is a permutation', () => {
    fc.assert(
      fc.property(fc.integer(), fc.integer({ min: -50, max: 50 }), fc.integer({ min: 0, max: 50 }), (seed, min, span) => {
        const r = seedRng(seed);
        const v = nextInt(r, min, min + span);
        expect(v).toBeGreaterThanOrEqual(min);
        expect(v).toBeLessThanOrEqual(min + span);
        const items = Array.from({ length: span }, (_, i) => i);
        expect(shuffled(r, items).sort((x, y) => x - y)).toEqual(items);
      }),
    );
  });
});
