import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, type Difficulty } from '../src/core/config';
import { must, query } from '../src/core/ecs/world';
import { chebyshev } from '../src/core/grid';
import { createGame } from '../src/core/state';
import { sanctuary } from './helpers';

const arbDifficulty = fc.constantFrom<Difficulty>('gentle', 'balanced', 'hard');

describe('map generation (T2.3)', () => {
  it('is deterministic per seed and difficulty', () => {
    fc.assert(fc.property(fc.integer(), arbDifficulty, (seed, d) => {
      expect(createGame(seed, d)).toEqual(createGame(seed, d));
    }), { numRuns: 30 });
  });

  it('has the documented composition', () => {
    fc.assert(
      fc.property(fc.integer(), arbDifficulty, (seed, d) => {
        const s = createGame(seed, d);
        const kinds = s.tiles.map((e) => must(s.world, e, 'Terrain').kind);
        const count = (k: string) => kinds.filter((x) => x === k).length;
        expect(s.tiles.length).toBe(s.width * s.height);
        expect(count('stack')).toBe(DIFFICULTIES[d].stacks);
        expect(count('ruin')).toBeGreaterThanOrEqual(8);
        expect(count('water')).toBeGreaterThanOrEqual(s.height);
        expect(count('rock')).toBeGreaterThan(0);
        const home = sanctuary(s);
        for (const e of s.tiles) {
          const p = must(s.world, e, 'GridPosition');
          const v = must(s.world, e, 'PollutionLevel').value;
          expect(Number.isInteger(v) && v >= 0 && v <= 100).toBe(true);
          if (chebyshev(p.x, p.y, home.x, home.y) <= 1) expect(v).toBe(0);
        }
        expect(query(s.world, 'Salvage').length).toBe(count('ruin'));
        expect(query(s.world, 'ToxicSource').length).toBe(count('stack'));
      }),
      { numRuns: 60 },
    );
  });

  it('starts in the action phase of turn 1 with genesis resources', () => {
    const s = createGame(1, 'balanced');
    expect(s.phase).toBe('action');
    expect(s.turn).toBe(1);
    expect(s.gold).toEqual({ balance: 40, earned: 40, spent: 0 });
    expect(s.energy.current).toBe(s.energy.max);
    expect(s.energy.produced).toBe(s.energy.max);
  });
});
