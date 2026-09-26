import type { TerrainKind } from '../ecs/components';
import { must, query } from '../ecs/world';
import type { GameState } from '../state';

export function isRestorable(kind: TerrainKind): boolean {
  return kind === 'soil' || kind === 'water' || kind === 'ruin';
}

export interface RestorationSummary {
  restorable: number;
  restored: number;
  ratio: number;
  averagePollution: number;
}

/** Reads the `restored` flags maintained by RestorationSystem. */
export function restorationSummary(s: GameState): RestorationSummary {
  let restorable = 0;
  let restored = 0;
  let pollution = 0;
  for (const e of query(s.world, 'Terrain', 'EcoValue', 'PollutionLevel')) {
    if (!isRestorable(must(s.world, e, 'Terrain').kind)) continue;
    restorable++;
    pollution += must(s.world, e, 'PollutionLevel').value;
    if (must(s.world, e, 'EcoValue').restored) restored++;
  }
  return {
    restorable,
    restored,
    ratio: restorable === 0 ? 0 : restored / restorable,
    averagePollution: restorable === 0 ? 0 : pollution / restorable,
  };
}
