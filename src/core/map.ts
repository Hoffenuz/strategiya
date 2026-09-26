import type { TerrainKind } from './ecs/components';
import { add, createEntity, type Entity, type World } from './ecs/world';
import { next, nextInt, type Rng } from './rng';

export interface GeneratedMap {
  tiles: Entity[];
  sanctuary: { x: number; y: number };
}

const cheb = (ax: number, ay: number, bx: number, by: number) => Math.max(Math.abs(ax - bx), Math.abs(ay - by));

/**
 * Procedural wasteland (R-1.1): deterministic for a given RNG state.
 * Sanctuary on the left, a winding river, rock ridges, ruins, and toxic stacks
 * placed away from the sanctuary. Pollution falls off with distance to stacks.
 */
export function generateMap(world: World, rng: Rng, width: number, height: number, stackCount: number): GeneratedMap {
  const kinds: TerrainKind[] = new Array(width * height).fill('soil');
  const idx = (x: number, y: number) => y * width + x;
  const sanctuary = { x: 2, y: nextInt(rng, 3, height - 4) };
  const nearSanctuary = (x: number, y: number, r: number) => cheb(x, y, sanctuary.x, sanctuary.y) <= r;

  // River: a vertical random walk through the middle third.
  let rx = nextInt(rng, Math.floor(width * 0.35), Math.floor(width * 0.55));
  for (let y = 0; y < height; y++) {
    kinds[idx(rx, y)] = 'water';
    const r = next(rng);
    if (r < 0.3 && rx > 4) rx--;
    else if (r > 0.7 && rx < width - 3) rx++;
    if (r < 0.3 || r > 0.7) kinds[idx(rx, y)] = 'water';
  }
  // A small pond near the sanctuary so trees can benefit from water early.
  const px = sanctuary.x + 2;
  const py = sanctuary.y + (sanctuary.y < height / 2 ? 3 : -3);
  for (const [x, y] of [[px, py], [px + 1, py]] as const) if (y >= 0 && y < height) kinds[idx(x, y)] = 'water';

  // Rock ridges.
  const free = (x: number, y: number) => kinds[idx(x, y)] === 'soil' && !nearSanctuary(x, y, 1);
  let rocks = 0;
  for (let attempts = 0; rocks < 3 && attempts < 50; attempts++) {
    const x = nextInt(rng, 4, width - 1);
    const y = nextInt(rng, 0, height - 1);
    if (!free(x, y)) continue;
    rocks++;
    const len = nextInt(rng, 2, 4);
    const horizontal = next(rng) < 0.5;
    for (let i = 0; i < len; i++) {
      const tx = horizontal ? x + i : x;
      const ty = horizontal ? y : y + i;
      if (tx < width && ty < height && free(tx, ty)) kinds[idx(tx, ty)] = 'rock';
    }
  }

  // Toxic stacks: far from the sanctuary and from each other.
  const stacks: { x: number; y: number }[] = [];
  // Spacing relaxes if the map is crowded, so the stack count per difficulty is always met.
  for (let spacing = 4; spacing >= 1 && stacks.length < stackCount; spacing--) {
    for (let attempts = 0; stacks.length < stackCount && attempts < 300; attempts++) {
      const x = nextInt(rng, 6, width - 2);
      const y = nextInt(rng, 1, height - 2);
      if (!free(x, y) || cheb(x, y, sanctuary.x, sanctuary.y) < 5) continue;
      if (stacks.some((s) => cheb(s.x, s.y, x, y) < spacing)) continue;
      stacks.push({ x, y });
      kinds[idx(x, y)] = 'stack';
    }
  }

  // Ruins: scattered scrap.
  const ruins: { x: number; y: number }[] = [];
  const ruinTarget = nextInt(rng, 11, 14);
  for (let attempts = 0; ruins.length < ruinTarget && attempts < 500; attempts++) {
    const x = nextInt(rng, 1, width - 1);
    const y = nextInt(rng, 0, height - 1);
    if (!free(x, y) || nearSanctuary(x, y, 2)) continue;
    ruins.push({ x, y });
    kinds[idx(x, y)] = 'ruin';
  }
  // Guarantee two ruins close to the sanctuary for a gentle start.
  for (const [dx, dy] of [[3, -1], [3, 1], [-2, 3], [4, 0]] as const) {
    const x = sanctuary.x + dx;
    const y = sanctuary.y + dy;
    if (x >= 0 && x < width && y >= 0 && y < height && kinds[idx(x, y)] === 'soil' && ruins.filter((r) => nearSanctuary(r.x, r.y, 4)).length < 2) {
      ruins.push({ x, y });
      kinds[idx(x, y)] = 'ruin';
    }
  }

  const tiles: Entity[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const kind = kinds[idx(x, y)]!;
      const e = createEntity(world);
      tiles.push(e);
      add(world, e, 'GridPosition', { x, y });
      add(world, e, 'Terrain', { kind });
      add(world, e, 'EcoValue', { restored: false, everRestored: false });
      let p = 0;
      if (kind !== 'rock' && kind !== 'stack') {
        const d = stacks.length ? Math.min(...stacks.map((s) => cheb(s.x, s.y, x, y))) : 99;
        p = Math.max(18, 96 - 11 * d) + nextInt(rng, -8, 8);
        if (kind === 'ruin') p += 12;
        if (kind === 'water') p += 6;
        const ds = cheb(x, y, sanctuary.x, sanctuary.y);
        if (ds <= 1) p = 0;
        else if (ds <= 3) p = Math.round((p * (ds - 1)) / 4);
      } else if (kind === 'stack') {
        p = 100;
      }
      add(world, e, 'PollutionLevel', { value: Math.max(0, Math.min(100, p)) });
      if (kind === 'ruin') add(world, e, 'Salvage', { remaining: nextInt(rng, 2, 4), density: nextInt(rng, 1, 3) });
      if (kind === 'stack') add(world, e, 'ToxicSource', { sealed: false });
    }
  }
  return { tiles, sanctuary };
}
