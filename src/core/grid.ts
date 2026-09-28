import type { Entity } from './ecs/world';
import { query, must } from './ecs/world';
import type { GameState } from './state';

export function inBounds(s: { width: number; height: number }, x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < s.width && y < s.height;
}

export function tileAt(s: GameState, x: number, y: number): Entity {
  return s.tiles[y * s.width + x]!;
}

export function chebyshev(ax: number, ay: number, bx: number, by: number): number {
  return Math.max(Math.abs(ax - bx), Math.abs(ay - by));
}

/** Coordinates within Chebyshev radius r (including the centre), clipped to the grid, row-major. */
export function area(s: { width: number; height: number }, cx: number, cy: number, r: number): [number, number][] {
  const out: [number, number][] = [];
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++) if (inBounds(s, x, y)) out.push([x, y]);
  return out;
}

export const ORTHOGONAL: readonly [number, number][] = [
  [0, -1],
  [1, 0],
  [0, 1],
  [-1, 0],
];

export function orthogonalNeighbours(s: { width: number; height: number }, x: number, y: number): [number, number][] {
  return ORTHOGONAL.map(([dx, dy]) => [x + dx, y + dy] as [number, number]).filter(([nx, ny]) => inBounds(s, nx, ny));
}

export interface Occupants {
  building: Map<number, Entity>;
  flora: Map<number, Entity>;
}

/** Index of building and flora entities by tile index (y * width + x). */
export function occupants(s: GameState): Occupants {
  const building = new Map<number, Entity>();
  const flora = new Map<number, Entity>();
  for (const e of query(s.world, 'Building', 'GridPosition')) {
    const p = must(s.world, e, 'GridPosition');
    building.set(p.y * s.width + p.x, e);
  }
  for (const e of query(s.world, 'Flora', 'GridPosition')) {
    const p = must(s.world, e, 'GridPosition');
    flora.set(p.y * s.width + p.x, e);
  }
  return { building, flora };
}
