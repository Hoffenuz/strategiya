import { BUILDINGS, DIFFICULTIES, E_BUILD, E_CLEANUP, E_SALVAGE, PLACEABLE, SPECIES, SPECIES_LIST, type PlaceableBuilding } from './config';
import type { BuildingType, Species, TerrainKind } from './ecs/components';
import { get, must, query } from './ecs/world';
import { buildingCost, goldIncome, scrubberRadius, soilCleansePower, waterCleansePower } from './economy/formulas';
import { inBounds, occupants, tileAt } from './grid';
import { quote, type Intent, type Quote } from './actions';
import type { GameState } from './state';
import { grossProduction } from './systems/energy';
import { nearCleanWater } from './systems/growth';
import { restorationSummary, type RestorationSummary } from './systems/restorable';
import { harmonyScore } from './systems/victory';

/** World-stage thresholds on progress toward the goal (R-11.2, R-11.12). */
export const STAGE_AT = { transition: 0.45, revival: 0.9 } as const;

export type WorldStage = 'collapse' | 'transition' | 'revival';

/** Restoration ratio over the difficulty's win ratio, clamped to [0, 1]. */
export function worldProgress(s: GameState): number {
  const { ratio } = restorationSummary(s);
  return Math.max(0, Math.min(1, ratio / DIFFICULTIES[s.difficulty].winRatio));
}

export function worldStage(progress: number): WorldStage {
  if (progress >= STAGE_AT.revival) return 'revival';
  if (progress >= STAGE_AT.transition) return 'transition';
  return 'collapse';
}

export type FloraStage = 'seedling' | 'young' | 'mature';

/** Seedling below a third of its growth time, then young until mature (R-11.13). */
export function floraStage(f: { growth: number; maturation: number; mature: boolean }): FloraStage {
  if (f.mature) return 'mature';
  return f.growth * 3 < f.maturation ? 'seedling' : 'young';
}

export function floraSprite(species: Species, stage: FloraStage): string {
  if (stage === 'mature') return species;
  return `${species}${stage === 'seedling' ? 0 : 1}`;
}

export type PollutionBand = 'clean' | 'recovering' | 'polluted' | 'toxic';

export function pollutionBand(value: number): PollutionBand {
  if (value === 0) return 'clean';
  if (value <= 20) return 'recovering';
  if (value <= 60) return 'polluted';
  return 'toxic';
}

export interface TileInfo {
  x: number;
  y: number;
  terrain: TerrainKind;
  pollution: number;
  band: PollutionBand;
  restored: boolean;
  salvage: { remaining: number; density: number } | null;
  sealed: boolean | null;
  building: { type: BuildingType; level: number; maxLevel: number; enabled: boolean; powered: boolean; hasUpkeep: boolean } | null;
  flora: { species: Species; growth: number; maturation: number; mature: boolean; stage: FloraStage; turnsLeft: number } | null;
}

export function tileInfo(s: GameState, x: number, y: number): TileInfo | null {
  if (!inBounds(s, x, y)) return null;
  return tileInfoWith(s, occupants(s), x, y);
}

/** Every tile's info in row-major order, sharing one occupant index (used by the renderer). */
export function allTileInfo(s: GameState): TileInfo[] {
  const occ = occupants(s);
  const out: TileInfo[] = [];
  for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) out.push(tileInfoWith(s, occ, x, y));
  return out;
}

function tileInfoWith(s: GameState, occ: ReturnType<typeof occupants>, x: number, y: number): TileInfo {
  const t = tileAt(s, x, y);
  const key = y * s.width + x;
  const pollution = must(s.world, t, 'PollutionLevel').value;
  const be = occ.building.get(key);
  const fe = occ.flora.get(key);
  let building: TileInfo['building'] = null;
  if (be !== undefined) {
    const b = must(s.world, be, 'Building');
    const active = get(s.world, be, 'ActiveState');
    building = {
      type: b.type,
      level: b.level,
      maxLevel: b.type === 'sanctuary' ? 1 : BUILDINGS[b.type].maxLevel,
      enabled: active?.enabled ?? true,
      powered: active?.powered ?? true,
      hasUpkeep: get(s.world, be, 'EnergyCost') !== undefined,
    };
  }
  let flora: TileInfo['flora'] = null;
  if (fe !== undefined) {
    const f = must(s.world, fe, 'Flora');
    const maturation = SPECIES[f.species].maturation;
    const rate = nearCleanWater(s, x, y) ? 2 : 1;
    flora = {
      species: f.species,
      growth: f.growth,
      maturation,
      mature: f.mature,
      stage: floraStage({ growth: f.growth, maturation, mature: f.mature }),
      turnsLeft: f.mature ? 0 : Math.ceil((maturation - f.growth) / rate),
    };
  }
  const salvage = get(s.world, t, 'Salvage');
  const source = get(s.world, t, 'ToxicSource');
  return {
    x,
    y,
    terrain: must(s.world, t, 'Terrain').kind,
    pollution,
    band: pollutionBand(pollution),
    restored: must(s.world, t, 'EcoValue').restored,
    salvage: salvage ? { ...salvage } : null,
    sealed: source ? source.sealed : null,
    building,
    flora,
  };
}

export type Tool =
  | { kind: 'salvage' }
  | { kind: 'cleanup' }
  | { kind: 'build'; building: PlaceableBuilding }
  | { kind: 'plant'; species: Species }
  | { kind: 'upgrade' }
  | { kind: 'toggle' }
  | { kind: 'demolish' };

export const TOOLS: readonly Tool[] = [
  { kind: 'salvage' },
  { kind: 'cleanup' },
  ...SPECIES_LIST.map((species) => ({ kind: 'plant' as const, species })),
  ...PLACEABLE.map((building) => ({ kind: 'build' as const, building })),
  { kind: 'upgrade' },
  { kind: 'toggle' },
  { kind: 'demolish' },
];

export type ToolGroup = 'restore' | 'plant' | 'build' | 'manage';

/** Palette section of a tool, so the HUD can group actions by purpose (R-2.7). */
export function toolGroup(t: Tool): ToolGroup {
  switch (t.kind) {
    case 'salvage':
    case 'cleanup':
      return 'restore';
    case 'plant':
      return 'plant';
    case 'build':
      return 'build';
    default:
      return 'manage';
  }
}

/** Sprite a placement tool would add to the tile (building or seedling), for the ghost preview (R-11.8). */
export function previewSprite(t: Tool): string | null {
  if (t.kind === 'build') return t.building;
  if (t.kind === 'plant') return `${t.species}0`;
  return null;
}

export function toolId(t: Tool): string {
  if (t.kind === 'build') return `build:${t.building}`;
  if (t.kind === 'plant') return `plant:${t.species}`;
  return t.kind;
}

export function toolIntent(t: Tool, x: number, y: number): Intent {
  return { ...t, x, y } as Intent;
}

export function previewTool(s: GameState, t: Tool, x: number, y: number): Quote {
  return quote(s, toolIntent(t, x, y));
}

/** Tools listed in the palette with their base price (used when no tile is selected). */
export function toolBasePrice(t: Tool): { gold: number; energy: number } | null {
  switch (t.kind) {
    case 'build':
      return { gold: buildingCost(t.building, 1), energy: E_BUILD };
    case 'plant':
      return { gold: SPECIES[t.species].gold, energy: SPECIES[t.species].energy };
    case 'salvage':
      return { gold: 0, energy: E_SALVAGE };
    case 'cleanup':
      return { gold: 0, energy: E_CLEANUP };
    default:
      return null;
  }
}

export interface Forecast {
  income: number;
  production: number;
  upkeep: number;
  capacity: number;
}

/** Next preparation's expected Gold and Energy flows (excluding random events). */
export function forecast(s: GameState): Forecast {
  let levels = 0;
  for (const e of query(s.world, 'Building', 'GoldProducer')) levels += must(s.world, e, 'Building').level;
  let upkeep = 0;
  for (const e of query(s.world, 'EnergyCost', 'ActiveState')) {
    if (must(s.world, e, 'ActiveState').enabled) upkeep += must(s.world, e, 'EnergyCost').upkeep;
  }
  return { income: goldIncome(levels), production: grossProduction(s), upkeep, capacity: s.energy.max };
}

export function summary(s: GameState): RestorationSummary & { winRatio: number; turnLimit: number | null; score: number } {
  const def = DIFFICULTIES[s.difficulty];
  return { ...restorationSummary(s), winRatio: def.winRatio, turnLimit: def.turnLimit, score: harmonyScore(s) };
}

export function cleansePreview(type: 'scrubber' | 'purifier', level: number): { power: number; radius: number } {
  return type === 'scrubber'
    ? { power: soilCleansePower(level), radius: scrubberRadius(level) }
    : { power: waterCleansePower(level), radius: 1 };
}
