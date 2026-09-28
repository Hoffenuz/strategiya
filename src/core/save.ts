import { DIFFICULTIES } from './config';
import { historyPoint, SAVE_VERSION, type GameState } from './state';

/** Versioned JSON save (R-10.2). */
export function serialize(s: GameState): string {
  return JSON.stringify(s);
}

/**
 * Returns null for corrupt, foreign or incompatible saves instead of throwing (R-10.3).
 * Saves of the previous version are migrated rather than discarded (R-10.6).
 */
export function deserialize(json: string): GameState | null {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return null;
  }
  const current = migrate(raw);
  return isGameState(current) ? current : null;
}

/** Version 1 → 2: adds the history, starting from the last resolved turn. */
function migrate(v: unknown): unknown {
  if (!isObj(v) || v.version !== 1) return v;
  const next: Record<string, unknown> = { ...v, version: SAVE_VERSION, history: [] };
  if (!isGameState(next)) return null;
  try {
    const resolved = next.outcome ? next.turn : next.turn - 1;
    next.history = [historyPoint(next, Math.max(0, resolved))];
  } catch {
    return null; // a world too broken to summarise
  }
  return next;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isHistoryPoint(p: unknown): boolean {
  return isObj(p) && typeof p.turn === 'number' && typeof p.ratio === 'number' && typeof p.pollution === 'number';
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
  if (!Array.isArray(v.history) || !v.history.every(isHistoryPoint)) return false;
  return typeof v.phase === 'string';
}
