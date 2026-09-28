import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import { must } from '../src/core/ecs/world';
import type { GameEvent } from '../src/core/events';
import { forecastResolution } from '../src/core/forecast';
import { isTerminal } from '../src/core/phases';
import { createGame, type GameState } from '../src/core/state';
import { restorationSummary } from '../src/core/systems/restorable';
import { arbDifficulty, arbScript, arbSeed } from './arbitraries';
import { deepFreeze } from './helpers';
import { DOOMED, doomedGrass, freshTx, reach } from './reach';

/** Events of a real End turn up to (not including) the next preparation. */
function resolutionEvents(events: GameEvent[]): GameEvent[] {
  const i = events.findIndex((e) => e.type === 'phase:changed' && e.phase === 'preparation');
  return i < 0 ? events : events.slice(0, i);
}

type Placed = { x: number; y: number; species: string };
const keys = (list: Placed[]) => list.map((p) => `${p.species}@${p.x},${p.y}`).sort();
const pollutionOf = (s: GameState) => s.tiles.map((e) => must(s.world, e, 'PollutionLevel').value);

describe('forecast of the coming resolution (T10.1, Invariant 13)', () => {
  it('equals the real resolution for random reachable states', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        const s = reach(seed, d, script);
        if (s.phase !== 'action') return;
        const f = forecastResolution(s);
        expect(f).not.toBeNull();
        const real = applyAction(s, { kind: 'endTurn', txId: freshTx('forecast') });
        const ev = resolutionEvents(real.events);
        expect(keys(f!.withered)).toEqual(keys(ev.flatMap((e) => (e.type === 'flora:withered' ? [e] : []))));
        expect(keys(f!.matured)).toEqual(keys(ev.flatMap((e) => (e.type === 'flora:matured' ? [e] : []))));
        expect(f!.outcome).toEqual(real.state.outcome);
        // The next preparation only changes tiles through random events (acid rain, pollinators).
        const random = real.events.some((e) => e.type === 'event:random');
        if (isTerminal(real.state.phase) || !random) {
          expect(f!.pollution).toEqual(pollutionOf(real.state));
          const after = restorationSummary(real.state);
          expect(f!.ratio).toBe(after.ratio);
          expect(f!.averagePollution).toBe(after.averagePollution);
        }
      }),
      { numRuns: 70 },
    );
  });

  it('never changes the state it forecasts (deep-frozen input)', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        const s = reach(seed, d, script.slice(0, 80));
        const snapshot = JSON.stringify(s);
        const frozen = deepFreeze(structuredClone(s));
        forecastResolution(frozen); // throws in strict mode on any write to the input
        expect(JSON.stringify(frozen)).toBe(snapshot);
      }),
      { numRuns: 30 },
    );
  });

  it('is null outside the action phase', () => {
    let s = createGame(4, 'hard');
    for (let i = 0; !isTerminal(s.phase) && i < 200; i++) s = applyAction(s, { kind: 'endTurn', txId: `t${i}` }).state;
    expect(isTerminal(s.phase)).toBe(true);
    expect(forecastResolution(s)).toBeNull();
  });

  it('reports a doomed plant with the pollution it will reach', () => {
    const s = doomedGrass();
    const f = forecastResolution(s)!;
    expect(f.withered).toEqual([{ ...DOOMED.plant, species: 'grass' }]);
    expect(f.pollution[DOOMED.plant.y * s.width + DOOMED.plant.x]).toBe(64);
    expect(f.matured).toEqual([]);
    expect(f.outcome).toBeNull();
  });
});
