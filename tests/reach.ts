import { applyAction, type Action } from '../src/core/actions';
import type { Difficulty } from '../src/core/config';
import { must } from '../src/core/ecs/world';
import { tileAt } from '../src/core/grid';
import { greedyIntent } from '../src/core/sim/bot';
import { createGame, type GameState } from '../src/core/state';
import { spawnFlora } from '../src/core/systems/growth';
import type { Step } from './arbitraries';
import { blankGame, setTile } from './helpers';

let unique = 0;

/** Resolves a script step against the current state (same rules as the invariant suite). */
export function stepAction(s: GameState, step: Step): Action {
  if (step.t === 'action') return step.action;
  if (step.t === 'botTurn') return { kind: 'endTurn', txId: `reach-turn${unique++}` };
  const intent = greedyIntent(s);
  return intent ? ({ ...intent, txId: step.txId } as Action) : { kind: 'endTurn', txId: step.txId };
}

/** Replays a script from a new game and stops at the first terminal state. */
export function reach(seed: number, difficulty: Difficulty, script: Step[]): GameState {
  let s = createGame(seed, difficulty);
  for (const step of script) {
    if (s.phase !== 'action') break;
    s = applyAction(s, stepAction(s, step)).state;
  }
  return s;
}

/** A fresh transaction id for checks that must never collide with script ids. */
export function freshTx(prefix = 'check'): string {
  return `${prefix}-${unique++}`;
}

export const DOOMED = { stack: { x: 13, y: 9 }, plant: { x: 14, y: 9 } } as const;

/**
 * A seedling of grass at pollution 58 right next to an unsealed stack: the stack adds 6
 * in the coming resolution, 64 > 60 (grass withers above 60), so the plant is doomed
 * unless the player cleans its tile.
 */
export function doomedGrass(): GameState {
  const s = blankGame('balanced', 7);
  setTile(s, DOOMED.stack.x, DOOMED.stack.y, 'stack');
  spawnFlora(s, 'grass', DOOMED.plant.x, DOOMED.plant.y);
  must(s.world, tileAt(s, DOOMED.plant.x, DOOMED.plant.y), 'PollutionLevel').value = 58;
  return s;
}
