import { BUILDINGS, DIFFICULTIES, E_BUILD, E_CLEANUP, E_SALVAGE, PLACEABLE, SPECIES, SPECIES_LIST, type PlaceableBuilding } from './config';
import type { BuildingType, Species, TerrainKind } from './ecs/components';
import { get, must, query } from './ecs/world';
import { buildingCost, goldIncome, scrubberRadius, soilCleansePower, waterCleansePower } from './economy/formulas';
import { inBounds, occupants, tileAt } from './grid';
import { quote, type Intent, type Quote } from './actions';
import type { GameState } from './state';
import { grossProduction } from './systems/energy';
import { restorationSummary, type RestorationSummary } from './systems/restorable';
import { harmonyScore } from './systems/victory';

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
  flora: { species: Species; growth: number; maturation: number; mature: boolean } | null;
}

export function tileInfo(s: GameState, x: number, y: number): TileInfo | null {
  if (!inBounds(s, x, y)) return null;
  const t = tileAt(s, x, y);
  const occ = occupants(s);
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
    flora = { species: f.species, growth: f.growth, maturation: SPECIES[f.species].maturation, mature: f.mature };
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
