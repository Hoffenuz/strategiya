import type { GameEvent } from '../core/events';
import type { GameState } from '../core/state';
import { must, query } from '../core/ecs/world';

export type AchievementId = 'firstSprout' | 'sunCatcher' | 'stackSealed' | 'cleanWaters' | 'forestGuardian' | 'halfway' | 'revived' | 'hardWin';

export const ACHIEVEMENTS: readonly AchievementId[] = ['firstSprout', 'sunCatcher', 'stackSealed', 'cleanWaters', 'forestGuardian', 'halfway', 'revived', 'hardWin'];

/** Pure rule: which achievements does this event (in this resulting state) unlock? (R-11.5) */
export function unlockedBy(e: GameEvent, s: GameState, have: ReadonlySet<AchievementId>): AchievementId[] {
  const out: AchievementId[] = [];
  const add = (id: AchievementId) => {
    if (!have.has(id) && !out.includes(id)) out.push(id);
  };
  switch (e.type) {
    case 'flora:planted':
      add('firstSprout');
      break;
    case 'building:placed':
      if (e.building === 'solar') add('sunCatcher');
      break;
    case 'stack:sealed':
      add('stackSealed');
      break;
    case 'tile:restored': {
      const t = s.tiles[e.y * s.width + e.x];
      if (t !== undefined && must(s.world, t, 'Terrain').kind === 'water') add('cleanWaters');
      break;
    }
    case 'flora:matured': {
      const trees = query(s.world, 'Flora').filter((f) => {
        const fl = must(s.world, f, 'Flora');
        return fl.species === 'tree' && fl.mature;
      }).length;
      if (trees >= 10) add('forestGuardian');
      break;
    }
    case 'ecosystem:milestone':
      if (e.index >= 3) add('halfway');
      break;
    case 'game:won':
      add('revived');
      if (s.difficulty === 'hard') add('hardWin');
      break;
  }
  return out;
}

export function parseAchievements(json: string | null): Set<AchievementId> {
  try {
    const arr = JSON.parse(json ?? '[]') as unknown;
    if (!Array.isArray(arr)) return new Set();
    return new Set(arr.filter((x): x is AchievementId => (ACHIEVEMENTS as readonly string[]).includes(x as string)));
  } catch {
    return new Set();
  }
}
