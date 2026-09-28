import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction, type Action } from '../src/core/actions';
import { BUILDINGS, G_RESTORE, MILESTONES, G_MILESTONE_STEP } from '../src/core/config';
import { must, query } from '../src/core/ecs/world';
import type { GameEvent } from '../src/core/events';
import { isTerminal } from '../src/core/phases';
import { deserialize, serialize } from '../src/core/save';
import { greedyIntent } from '../src/core/sim/bot';
import { createGame, type GameState } from '../src/core/state';
import { restorationSummary } from '../src/core/systems/restorable';
import { arbAction, arbDifficulty, arbScript, arbSeed, type Step } from './arbitraries';
import { deepFreeze } from './helpers';

let unique = 0;

/** Resolves a script step against the current state. */
function stepAction(s: GameState, step: Step): Action {
  if (step.t === 'action') return step.action;
  if (step.t === 'botTurn') return { kind: 'endTurn', txId: `turn${unique++}` };
  const intent = greedyIntent(s);
  return intent ? ({ ...intent, txId: step.txId } as Action) : { kind: 'endTurn', txId: step.txId };
}

/** Invariants 1–4, 8, 11, 12 of design §6, checked after every step. */
function checkInvariants(s: GameState): void {
  // 1. Energy conservation: consumed + current = produced.
  expect(s.energy.consumed + s.energy.current).toBe(s.energy.produced);
  // 2. Gold conservation: spent + balance = earned.
  expect(s.gold.spent + s.gold.balance).toBe(s.gold.earned);
  // 3. Non-negativity.
  expect(s.gold.balance).toBeGreaterThanOrEqual(0);
  expect(s.energy.current).toBeGreaterThanOrEqual(0);
  // 4. Capacity.
  expect(s.energy.current).toBeLessThanOrEqual(s.energy.max);
  // 8. Bounds.
  for (const e of s.tiles) {
    const v = must(s.world, e, 'PollutionLevel').value;
    expect(Number.isInteger(v) && v >= 0 && v <= 100).toBe(true);
  }
  for (const e of query(s.world, 'Building')) {
    const b = must(s.world, e, 'Building');
    const max = b.type === 'sanctuary' ? 1 : BUILDINGS[b.type].maxLevel;
    expect(b.level >= 1 && b.level <= max).toBe(true);
  }
  const r = restorationSummary(s);
  expect(r.ratio >= 0 && r.ratio <= 1).toBe(true);
  // 11. Bounties at most once per tile, milestones at most once each.
  expect(s.stats.bountyPaid).toBeLessThanOrEqual(G_RESTORE * s.tiles.length);
  expect(s.stats.milestoneGold).toBeLessThanOrEqual(G_MILESTONE_STEP * ((MILESTONES.length * (MILESTONES.length + 1)) / 2));
  // 12. Between player inputs the machine rests in action or a terminal state.
  expect(['action', 'victory', 'defeat']).toContain(s.phase);
  expect(s.outcome !== null).toBe(isTerminal(s.phase));
}

function run(seed: number, difficulty: Parameters<typeof createGame>[1], script: Step[], onStep?: (prev: GameState, a: Action, next: GameState, ev: GameEvent[]) => void): GameState {
  let s = createGame(seed, difficulty);
  checkInvariants(s);
  for (const step of script) {
    const a = stepAction(s, step);
    const r = applyAction(s, a);
    onStep?.(s, a, r.state, r.events);
    s = r.state;
    checkInvariants(s);
  }
  return s;
}

describe('economy invariants over random scripts (T4.1)', () => {
  it('Invariants 1–4, 8, 11, 12 hold after every step of any script', () => {
    fc.assert(fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => void run(seed, d, script)), { numRuns: 120 });
  });

  it('Invariant 5: applying an action twice equals applying it once (idempotency)', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, arbAction, (seed, d, script, a) => {
        const s = run(seed, d, script.slice(0, 40));
        const once = applyAction(s, a);
        const twice = applyAction(once.state, a);
        expect(twice.state).toEqual(once.state);
        if (once.state !== s) {
          // Accepted: the repeat is a silent no-op.
          expect(twice.events).toEqual([]);
          expect(twice.state).toBe(once.state);
        }
      }),
      { numRuns: 80 },
    );
  });

  it('Invariant 6: the reducer never mutates its input', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        let s = createGame(seed, d);
        for (const step of script.slice(0, 60)) {
          const a = stepAction(s, step);
          const snapshot = JSON.stringify(s);
          const frozen = deepFreeze(structuredClone(s));
          const r = applyAction(frozen, a); // throws in strict mode if it writes to the input
          expect(JSON.stringify(frozen)).toBe(snapshot);
          s = r.state;
        }
      }),
      { numRuns: 40 },
    );
  });

  it('Invariant 7: a rejected action is a no-op with exactly one rejection event', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        run(seed, d, script, (prev, _a, next, events) => {
          const rejected = events.filter((e) => e.type === 'action:rejected');
          if (rejected.length > 0) {
            expect(events).toHaveLength(1);
            expect(next).toBe(prev);
          }
        });
      }),
      { numRuns: 60 },
    );
  });

  it('Invariant 9: same seed and script give the same world (determinism)', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        unique = 0;
        const a = run(seed, d, script);
        unique = 0;
        const b = run(seed, d, script);
        expect(a).toEqual(b);
      }),
      { numRuns: 40 },
    );
  });

  it('Invariant 10: save then load is lossless for any reachable state', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        const s = run(seed, d, script);
        expect(deserialize(serialize(s))).toEqual(s);
      }),
      { numRuns: 40 },
    );
  });

  it('Invariant 12: terminal states reject every action', () => {
    fc.assert(
      fc.property(arbSeed, arbAction, (seed, a) => {
        let s = createGame(seed, 'hard');
        let i = 0;
        while (!isTerminal(s.phase) && i < 200) s = applyAction(s, { kind: 'endTurn', txId: `e${i++}` }).state;
        expect(isTerminal(s.phase)).toBe(true);
        const r = applyAction(s, { ...a, txId: `${a.txId}-after` } as Action);
        expect(r.state).toBe(s);
        expect(r.events).toEqual([{ type: 'action:rejected', action: a.kind, reason: 'game_over' }]);
      }),
      { numRuns: 20 },
    );
  });
});
