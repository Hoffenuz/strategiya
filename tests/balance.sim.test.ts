import { describe, expect, it } from 'vitest';
import { runBot } from '../src/core/sim/bot';
import { DIFFICULTIES } from '../src/core/config';

/** Macro-balance regression (R-9.5, design §4.11). Any constant change must keep this green. */
const SEEDS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

describe('macro balance simulation (T5.1)', () => {
  it('the greedy bot wins Balanced on every fixed seed with a safety margin', () => {
    const limit = DIFFICULTIES.balanced.turnLimit!;
    for (const seed of SEEDS) {
      const r = runBot(seed, 'balanced', 'greedy');
      expect(r.won, `seed ${seed}`).toBe(true);
      expect(r.turns, `seed ${seed}`).toBeLessThanOrEqual(limit - 10);
    }
  });

  it('the greedy bot also wins Gentle and Hard', () => {
    for (const seed of SEEDS.slice(0, 5)) {
      expect(runBot(seed, 'gentle', 'greedy').won).toBe(true);
      expect(runBot(seed, 'hard', 'greedy').won).toBe(true);
    }
  });

  it('doing nothing never wins Balanced or Hard', () => {
    for (const seed of SEEDS) {
      expect(runBot(seed, 'balanced', 'passive').won).toBe(false);
      expect(runBot(seed, 'hard', 'passive').won).toBe(false);
    }
  });

  it('on Gentle a passive player never loses', () => {
    for (const seed of SEEDS.slice(0, 4)) {
      const r = runBot(seed, 'gentle', 'passive', 120);
      expect(r.state.outcome).toBeNull();
    }
  });
});
