import { COLLAPSE_TURNS, DIFFICULTIES, SPECIES } from '../config';
import { must, query } from '../ecs/world';
import type { GameState, Outcome } from '../state';
import type { SystemContext } from './context';
import { restorationSummary } from './restorable';

/** Harmony score (design §4.10). */
export function harmonyScore(s: GameState): number {
  const { restored } = restorationSummary(s);
  let eco = 0;
  for (const e of query(s.world, 'Flora')) {
    const f = must(s.world, e, 'Flora');
    if (f.mature) eco += SPECIES[f.species].eco;
  }
  return 10 * restored + eco + 2 * Math.max(0, 100 - s.turn);
}

/** VictorySystem: returns an outcome when the game ends this resolution (R-9). */
export function victorySystem({ s }: SystemContext): Outcome | null {
  const def = DIFFICULTIES[s.difficulty];
  const { ratio, averagePollution } = restorationSummary(s);
  if (ratio >= def.winRatio) return { result: 'victory', reason: 'restored', turn: s.turn, score: harmonyScore(s) };
  if (def.collapse !== null) {
    s.collapseStreak = averagePollution >= s.startPollution + def.collapse ? s.collapseStreak + 1 : 0;
    if (s.collapseStreak >= COLLAPSE_TURNS) return { result: 'defeat', reason: 'collapse', turn: s.turn, score: harmonyScore(s) };
  }
  if (def.turnLimit !== null && s.turn >= def.turnLimit) {
    return { result: 'defeat', reason: 'time', turn: s.turn, score: harmonyScore(s) };
  }
  return null;
}
