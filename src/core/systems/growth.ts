import { SPECIES, SPREAD_MAX_POLLUTION } from '../config';
import { add, createEntity, destroyEntity, must, query, type Entity } from '../ecs/world';
import { spreadChance } from '../economy/formulas';
import { orthogonalNeighbours, occupants, tileAt } from '../grid';
import { next, pick } from '../rng';
import type { GameState } from '../state';
import type { SystemContext } from './context';
import { restorationSummary } from './restorable';

export function nearCleanWater(s: GameState, x: number, y: number): boolean {
  return orthogonalNeighbours(s, x, y).some(([nx, ny]) => {
    const t = tileAt(s, nx, ny);
    return must(s.world, t, 'Terrain').kind === 'water' && must(s.world, t, 'PollutionLevel').value === 0;
  });
}

export function advanceGrowth({ s, emit }: SystemContext, e: Entity, amount: number): void {
  const flora = must(s.world, e, 'Flora');
  if (flora.mature) return;
  const def = SPECIES[flora.species];
  flora.growth = Math.min(def.maturation, flora.growth + amount);
  if (flora.growth >= def.maturation) {
    flora.mature = true;
    const p = must(s.world, e, 'GridPosition');
    emit({ type: 'flora:matured', species: flora.species, x: p.x, y: p.y });
  }
}

export function spawnFlora(s: GameState, species: 'grass' | 'shrub' | 'tree', x: number, y: number): Entity {
  const e = createEntity(s.world);
  add(s.world, e, 'GridPosition', { x, y });
  add(s.world, e, 'Flora', { species, growth: 0, mature: false });
  return e;
}

/** GrowthSystem: bioremediation, withering, growth, S-curve spread (design §4.8). */
export function growthSystem(ctx: SystemContext): void {
  const { s, emit, rng } = ctx;
  const ratio = restorationSummary(s).ratio;
  const plants = query(s.world, 'Flora', 'GridPosition');

  // 1. Mature plants clean their own tile.
  for (const e of plants) {
    const flora = must(s.world, e, 'Flora');
    if (!flora.mature) continue;
    const p = must(s.world, e, 'GridPosition');
    const pol = must(s.world, tileAt(s, p.x, p.y), 'PollutionLevel');
    pol.value = Math.max(0, pol.value - SPECIES[flora.species].bio);
  }

  // 2. Withering, then growth for survivors.
  const survivors: Entity[] = [];
  for (const e of plants) {
    const flora = must(s.world, e, 'Flora');
    const p = must(s.world, e, 'GridPosition');
    const pollution = must(s.world, tileAt(s, p.x, p.y), 'PollutionLevel').value;
    if (pollution > SPECIES[flora.species].withers) {
      destroyEntity(s.world, e);
      s.stats.withered++;
      emit({ type: 'flora:withered', species: flora.species, x: p.x, y: p.y });
      continue;
    }
    survivors.push(e);
    advanceGrowth(ctx, e, nearCleanWater(s, p.x, p.y) ? 2 : 1);
  }

  // 3. Spread from plants that were already mature (new seedlings do not spread this turn).
  const chance = spreadChance(ratio);
  const occ = occupants(s);
  for (const e of survivors) {
    const flora = must(s.world, e, 'Flora');
    if (!flora.mature || flora.species === 'tree') continue;
    const p = must(s.world, e, 'GridPosition');
    const [nx, ny] = pick(rng, orthogonalNeighbours(s, p.x, p.y));
    const roll = next(rng);
    const key = ny * s.width + nx;
    if (occ.building.has(key) || occ.flora.has(key)) continue;
    const t = tileAt(s, nx, ny);
    if (must(s.world, t, 'Terrain').kind !== 'soil') continue;
    if (must(s.world, t, 'PollutionLevel').value > SPREAD_MAX_POLLUTION) continue;
    if (roll >= chance) continue;
    const seedling = spawnFlora(s, 'grass', nx, ny);
    occ.flora.set(key, seedling);
    s.stats.spread++;
    emit({ type: 'flora:spread', species: 'grass', x: nx, y: ny });
  }
}
