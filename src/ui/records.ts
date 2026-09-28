import type { Difficulty } from '../core/config';
import type { Outcome } from '../core/state';

/** Local best results per difficulty (R-10.7), kept in localStorage. */
export interface DifficultyRecord {
  played: number;
  wins: number;
  /** Best Harmony score of a won game. */
  bestScore: number | null;
  /** Fewest turns needed to win. */
  fewestTurns: number | null;
}

export type Records = Record<Difficulty, DifficultyRecord>;

const DIFFICULTY_LIST: readonly Difficulty[] = ['gentle', 'balanced', 'hard'];

const blank = (): DifficultyRecord => ({ played: 0, wins: 0, bestScore: null, fewestTurns: null });

export function emptyRecords(): Records {
  return { gentle: blank(), balanced: blank(), hard: blank() };
}

export interface RecordUpdate {
  records: Records;
  /** This game set a new best Harmony score. */
  bestScore: boolean;
  /** This game was the fastest win. */
  fewestTurns: boolean;
}

/** Folds a finished game into the records without mutating them. */
export function recordGame(records: Records, difficulty: Difficulty, outcome: Pick<Outcome, 'result' | 'turn' | 'score'>): RecordUpdate {
  const old = records[difficulty];
  const next: DifficultyRecord = { ...old, played: old.played + 1 };
  let bestScore = false;
  let fewestTurns = false;
  if (outcome.result === 'victory') {
    next.wins++;
    if (old.bestScore === null || outcome.score > old.bestScore) {
      next.bestScore = outcome.score;
      bestScore = true;
    }
    if (old.fewestTurns === null || outcome.turn < old.fewestTurns) {
      next.fewestTurns = outcome.turn;
      fewestTurns = true;
    }
  }
  return { records: { ...records, [difficulty]: next }, bestScore, fewestTurns };
}

const count = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 0;
const optional = (v: unknown): v is number | null => v === null || count(v);

function parseRecord(v: unknown): DifficultyRecord | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  const r = v as Record<string, unknown>;
  if (!count(r.played) || !count(r.wins) || !optional(r.bestScore) || !optional(r.fewestTurns)) return null;
  return { played: r.played, wins: r.wins, bestScore: r.bestScore, fewestTurns: r.fewestTurns };
}

/** Reads stored records, falling back to empty ones for anything malformed. */
export function parseRecords(json: string | null): Records {
  const out = emptyRecords();
  if (!json) return out;
  try {
    const raw = JSON.parse(json) as unknown;
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return out;
    for (const d of DIFFICULTY_LIST) out[d] = parseRecord((raw as Record<string, unknown>)[d]) ?? out[d];
  } catch {
    /* corrupt: keep the empty records */
  }
  return out;
}
