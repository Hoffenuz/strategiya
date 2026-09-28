import { runResolution } from './actions';
import type { Species } from './ecs/components';
import { must } from './ecs/world';
import type { GameEvent } from './events';
import { cloneState, type GameState, type Outcome } from './state';
import { restorationSummary } from './systems/restorable';

export interface PlacedFlora {
  x: number;
  y: number;
  species: Species;
}

/** The exact result of the coming resolution (design §3.8, R-13.14). */
export interface ResolutionForecast {
  /** Plants that will wither. */
  withered: PlacedFlora[];
  /** Plants that will mature. */
  matured: PlacedFlora[];
  /** Pollution of every tile after the resolution, row-major. */
  pollution: number[];
  /** Restoration ratio after the resolution. */
  ratio: number;
  averagePollution: number;
  /** Victory or defeat if ending the turn now ends the game. */
  outcome: Outcome | null;
}

/**
 * Runs the real resolution (`runResolution`, shared with End turn) on a copy of the state,
 * with its own event sink and PRNG copy, so the answer is exact and the game is untouched
 * (R-14.8). The following preparation — and so the next random event — is not forecast.
 */
export function forecastResolution(s: GameState): ResolutionForecast | null {
  if (s.phase !== 'action') return null;
  const copy = cloneState(s);
  const events: GameEvent[] = [];
  const outcome = runResolution({ s: copy, emit: (e) => events.push(e), rng: { state: copy.rng } });
  const withered: PlacedFlora[] = [];
  const matured: PlacedFlora[] = [];
  for (const e of events) {
    if (e.type === 'flora:withered') withered.push({ x: e.x, y: e.y, species: e.species });
    else if (e.type === 'flora:matured') matured.push({ x: e.x, y: e.y, species: e.species });
  }
  const after = restorationSummary(copy);
  return {
    withered,
    matured,
    pollution: copy.tiles.map((t) => must(copy.world, t, 'PollutionLevel').value),
    ratio: after.ratio,
    averagePollution: after.averagePollution,
    outcome,
  };
}
