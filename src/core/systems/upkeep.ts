import { must, query } from '../ecs/world';
import type { SystemContext } from './context';

/**
 * UpkeepSystem: decides which enabled buildings are powered this turn, in ascending id
 * order, drawing from `pool` (stored energy plus this turn's production). Buildings that
 * cannot be paid sleep instead of driving Energy negative (R-5.9). Returns the upkeep to charge.
 */
export function upkeepSystem({ s, emit }: SystemContext, pool: number): number {
  let paid = 0;
  for (const e of query(s.world, 'EnergyCost', 'ActiveState', 'Building', 'GridPosition')) {
    const active = must(s.world, e, 'ActiveState');
    if (!active.enabled) {
      active.powered = false;
      continue;
    }
    const upkeep = must(s.world, e, 'EnergyCost').upkeep;
    if (paid + upkeep <= pool) {
      active.powered = true;
      paid += upkeep;
    } else {
      active.powered = false;
      const p = must(s.world, e, 'GridPosition');
      emit({ type: 'building:unpowered', building: must(s.world, e, 'Building').type, x: p.x, y: p.y });
    }
  }
  return paid;
}
