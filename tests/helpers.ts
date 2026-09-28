import type { TerrainKind } from '../src/core/ecs/components';
import { destroyEntity, must, query } from '../src/core/ecs/world';
import { tileAt } from '../src/core/grid';
import { createGame, type GameState } from '../src/core/state';
import type { Action, Intent } from '../src/core/actions';
import { applyAction } from '../src/core/actions';
import type { Difficulty } from '../src/core/config';

/** A game whose map is flattened to clean soil (sanctuary kept) for focused system tests. */
export function blankGame(difficulty: Difficulty = 'balanced', seed = 7): GameState {
  const s = createGame(seed, difficulty);
  for (const e of s.tiles) {
    must(s.world, e, 'Terrain').kind = 'soil';
    must(s.world, e, 'PollutionLevel').value = 0;
    delete s.world.c.Salvage[e];
    delete s.world.c.ToxicSource[e];
  }
  for (const e of query(s.world, 'Flora')) destroyEntity(s.world, e);
  return s;
}

export function setTile(s: GameState, x: number, y: number, kind: TerrainKind, pollution = 0): void {
  const e = tileAt(s, x, y);
  must(s.world, e, 'Terrain').kind = kind;
  must(s.world, e, 'PollutionLevel').value = pollution;
  if (kind === 'stack') s.world.c.ToxicSource[e] = { sealed: false };
  if (kind === 'ruin') s.world.c.Salvage[e] = { remaining: 2, density: 2 };
}

export function pollutionAt(s: GameState, x: number, y: number): number {
  return must(s.world, tileAt(s, x, y), 'PollutionLevel').value;
}

export function sanctuary(s: GameState): { x: number; y: number } {
  for (const e of query(s.world, 'Building', 'GridPosition')) {
    if (must(s.world, e, 'Building').type === 'sanctuary') return must(s.world, e, 'GridPosition');
  }
  throw new Error('no sanctuary');
}

let tx = 0;
export function act(s: GameState, intent: Intent): ReturnType<typeof applyAction> {
  return applyAction(s, { ...intent, txId: `h${tx++}` } as Action);
}

export function endTurn(s: GameState): GameState {
  return act(s, { kind: 'endTurn' }).state;
}

export function deepFreeze<T>(o: T): T {
  if (o && typeof o === 'object' && !Object.isFrozen(o)) {
    Object.freeze(o);
    for (const v of Object.values(o as object)) deepFreeze(v);
  }
  return o;
}
