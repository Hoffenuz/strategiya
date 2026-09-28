import { EMISSION } from '../config';
import { must, query } from '../ecs/world';
import { area, chebyshev, tileAt } from '../grid';
import type { SystemContext } from './context';
import { isRestorable } from './restorable';

/** PollutionSystem: unsealed stacks emit with distance falloff (design §4.7). */
export function pollutionSystem({ s, emit }: SystemContext): void {
  for (const e of query(s.world, 'ToxicSource', 'GridPosition')) {
    if (must(s.world, e, 'ToxicSource').sealed) continue;
    const pos = must(s.world, e, 'GridPosition');
    emit({ type: 'stack:emitted', x: pos.x, y: pos.y, radius: EMISSION.length });
    for (const [x, y] of area(s, pos.x, pos.y, EMISSION.length)) {
      const d = chebyshev(x, y, pos.x, pos.y);
      if (d === 0) continue;
      const tile = tileAt(s, x, y);
      if (!isRestorable(must(s.world, tile, 'Terrain').kind)) continue;
      const p = must(s.world, tile, 'PollutionLevel');
      p.value = Math.min(100, p.value + EMISSION[d - 1]!);
    }
  }
}
