import type { Emit } from '../events';
import type { Rng } from '../rng';
import type { GameState } from '../state';

/** What every system receives: the (already cloned) state, an event sink and the PRNG. */
export interface SystemContext {
  s: GameState;
  emit: Emit;
  rng: Rng;
}
