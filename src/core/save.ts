import { DIFFICULTIES } from './config';
import { SAVE_VERSION, type GameState } from './state';

/** Versioned JSON save (R-10.2). */
export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

/** Returns null for corrupt, foreign or incompatible saves instead of throwing (R-10.3). */
export function deserialize(json: string): GameState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isGameState(raw)) return null;
  return raw;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isGameState(v: unknown): v is GameState {
  if (!isObj(v)) return false;
  if (v.version !== SAVE_VERSION) return false;
  if (typeof v.difficulty !== 'string' || !(v.difficulty in DIFFICULTIES)) return false;
  for (const k of ['seed', 'width', 'height', 'turn', 'rng', 'milestonesReached', 'collapseStreak', 'startPollution']) {
    if (typeof v[k] !== 'number') return false;
  }
  if (!Array.isArray(v.tiles) || v.tiles.length !== (v.width as number) * (v.height as number)) return false;
  if (!isObj(v.world) || !isObj(v.world.c) || !isObj(v.world.alive)) return false;
  if (!isObj(v.gold) || !isObj(v.energy) || !isObj(v.stats)) return false;
  if (!Array.isArray(v.processedTx) || !Array.isArray(v.journal)) return false;
  return typeof v.phase === 'string';
}
