import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../src/core/save';
import { createGame, SAVE_VERSION } from '../src/core/state';
import { restorationSummary } from '../src/core/systems/restorable';
import { arbDifficulty, arbScript, arbSeed } from './arbitraries';
import { endTurn } from './helpers';
import { reach } from './reach';

const round = (v: number, digits: number) => Math.round(v * 10 ** digits) / 10 ** digits;

describe('history and save migration (T10.5)', () => {
  it('starts with a genesis point for turn 0', () => {
    const s = createGame(5, 'balanced');
    const r = restorationSummary(s);
    expect(s.history).toEqual([{ turn: 0, ratio: round(r.ratio, 3), pollution: round(r.averagePollution, 1) }]);
  });

  it('records the ratio and average pollution of every resolved turn', () => {
    // Random events start on turn 3, so the preparation of turn 2 cannot change the map.
    const s = endTurn(createGame(5, 'gentle'));
    const r = restorationSummary(s);
    expect(s.history).toHaveLength(2);
    expect(s.history[1]).toEqual({ turn: 1, ratio: round(r.ratio, 3), pollution: round(r.averagePollution, 1) });
  });

  it('Invariant 15: one point per resolution, in turn order, within bounds', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        const s = reach(seed, d, script);
        const resolved = s.outcome ? s.turn : s.turn - 1;
        expect(s.history.map((p) => p.turn)).toEqual([...Array(resolved + 1).keys()]);
        for (const p of s.history) {
          expect(p.ratio >= 0 && p.ratio <= 1).toBe(true);
          expect(p.pollution >= 0 && p.pollution <= 100).toBe(true);
        }
      }),
      { numRuns: 60 },
    );
  });

  it('migrates a version-1 save instead of discarding it', () => {
    const s = endTurn(endTurn(createGame(9, 'balanced')));
    const v1 = JSON.parse(serialize(s)) as Record<string, unknown>;
    v1.version = 1;
    delete v1.history;
    const m = deserialize(JSON.stringify(v1));
    expect(m).not.toBeNull();
    expect(m!.version).toBe(SAVE_VERSION);
    expect(SAVE_VERSION).toBe(2);
    const r = restorationSummary(s);
    expect(m!.history).toEqual([{ turn: s.turn - 1, ratio: round(r.ratio, 3), pollution: round(r.averagePollution, 1) }]);
    expect({ ...m!, history: s.history }).toEqual(s);
  });

  it('rejects unknown versions and a malformed history', () => {
    const good = JSON.parse(serialize(createGame(1, 'gentle'))) as Record<string, unknown>;
    expect(deserialize(JSON.stringify({ ...good, version: 3 }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...good, history: 'nope' }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...good, history: [{ turn: 'x' }] }))).toBeNull();
    expect(deserialize(serialize(createGame(1, 'gentle')))).not.toBeNull();
  });
});
