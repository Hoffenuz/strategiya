import { must, query } from '../ecs/world';
import { scrubberRadius, soilCleansePower, waterCleansePower } from '../economy/formulas';
import { area, tileAt } from '../grid';
import type { SystemContext } from './context';

/** CleansingSystem: logarithmic cleansing by powered scrubbers and purifiers (design §4.6). */
export function cleansingSystem({ s }: SystemContext): void {
  for (const e of query(s.world, 'Cleanser', 'Building', 'ActiveState', 'GridPosition')) {
    const active = must(s.world, e, 'ActiveState');
    if (!active.enabled || !active.powered) continue;
    const { level } = must(s.world, e, 'Building');
    const { medium } = must(s.world, e, 'Cleanser');
    const pos = must(s.world, e, 'GridPosition');
    const power = medium === 'soil' ? soilCleansePower(level) : waterCleansePower(level);
    const radius = medium === 'soil' ? scrubberRadius(level) : 1;
    for (const [x, y] of area(s, pos.x, pos.y, radius)) {
      const tile = tileAt(s, x, y);
      const kind = must(s.world, tile, 'Terrain').kind;
      if (kind === 'rock' || kind === 'stack') continue;
      const own = x === pos.x && y === pos.y;
      let amount: number;
      if (medium === 'soil') amount = own ? power : Math.floor(power / 2);
      else amount = kind === 'water' ? power : Math.floor(power / 2);
      const p = must(s.world, tile, 'PollutionLevel');
      p.value = Math.max(0, p.value - amount);
    }
  }
}
