import fc from 'fast-check';
import { GRID_HEIGHT, GRID_WIDTH, PLACEABLE, SPECIES_LIST, type Difficulty } from '../src/core/config';
import type { Action, Intent } from '../src/core/actions';

/** fast-check generators for the invariant suite (design §6). */

export const arbSeed = fc.integer({ min: 0, max: 0xffffffff });
export const arbDifficulty = fc.constantFrom<Difficulty>('gentle', 'balanced', 'hard');

/** Small pool so duplicate transaction ids (idempotency) are common. */
export const arbTxId = fc.nat(40).map((n) => `tx${n}`);

// Slightly outside the grid so out_of_bounds is exercised too.
const arbX = fc.integer({ min: -1, max: GRID_WIDTH });
const arbY = fc.integer({ min: -1, max: GRID_HEIGHT });

export const arbIntent: fc.Arbitrary<Intent> = fc.oneof(
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('salvage' as const), x: arbX, y: arbY }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('build' as const), building: fc.constantFrom(...PLACEABLE), x: arbX, y: arbY }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('upgrade' as const), x: arbX, y: arbY }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('demolish' as const), x: arbX, y: arbY }) },
  { weight: 1, arbitrary: fc.record({ kind: fc.constant('toggle' as const), x: arbX, y: arbY }) },
  { weight: 3, arbitrary: fc.record({ kind: fc.constant('plant' as const), species: fc.constantFrom(...SPECIES_LIST), x: arbX, y: arbY }) },
  { weight: 2, arbitrary: fc.record({ kind: fc.constant('cleanup' as const), x: arbX, y: arbY }) },
  { weight: 3, arbitrary: fc.constant({ kind: 'endTurn' as const }) },
);

export const arbAction: fc.Arbitrary<Action> = fc.tuple(arbIntent, arbTxId).map(([i, txId]) => ({ ...i, txId }) as Action);

/**
 * A script step is either a concrete random action or "bot": at run time the greedy bot
 * picks a sensible action, which drives the game into rich states (buildings, flora,
 * milestones, victories) that uniform random coordinates rarely reach.
 */
export type Step = { t: 'action'; action: Action } | { t: 'bot'; txId: string } | { t: 'botTurn' };

export const arbStep: fc.Arbitrary<Step> = fc.oneof(
  { weight: 4, arbitrary: arbAction.map((action) => ({ t: 'action' as const, action })) },
  { weight: 4, arbitrary: fc.nat(1_000_000).map((n) => ({ t: 'bot' as const, txId: `bot${n}` })) },
  { weight: 1, arbitrary: fc.constant({ t: 'botTurn' as const }) },
);

export const arbScript = fc.array(arbStep, { minLength: 1, maxLength: 200 });
