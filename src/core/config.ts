import type { BuildingType, Species } from './ecs/components';

/** Every balance constant lives here and mirrors design.md §4. */

export const GRID_WIDTH = 16;
export const GRID_HEIGHT = 12;

// §4.1 linear income
export const G_BASE = 2;
export const K_REC = 4;

// §4.2 linear salvage
export const K_SALV = 5;
export const E_SALVAGE = 1;

// §4.3 exponential costs
export const COST_GROWTH = 1.75;
export const E_BUILD = 2;
export const E_UPGRADE = 1;

// §4.4 energy production
export const R_BASE = 3;

// §4.5 logarithmic energy cap
export const EMAX_ALPHA = 6;
export const EMAX_BETA = 8;

// §4.6 cleansing
export const E_CLEANUP = 2;
export const K_MANUAL = 10;

// §4.7 emission by Chebyshev distance 1..3
export const EMISSION = [6, 3, 1] as const;

// §4.8 spread S-curve
export const SPREAD_L = 0.35;
export const SPREAD_K = 10;
export const SPREAD_R0 = 0.35;
export const SPREAD_MAX_POLLUTION = 20;

// §4.9 rewards and events
export const G_RESTORE = 2;
export const MILESTONES = [0.1, 0.25, 0.5, 0.75] as const;
export const G_MILESTONE_STEP = 20;
export const EVENT_START_TURN = 3;
export const EVENT_CHANCE = 0.3;
export const ACID_RAIN_TILES = 5;
export const ACID_RAIN_AMOUNT = 10;
export const CARAVAN_GOLD = 12;
export const SUNNY_ENERGY = 3;
export const RANDOM_EVENTS = [
  { kind: 'acidRain', weight: 0.3 },
  { kind: 'caravan', weight: 0.25 },
  { kind: 'pollinators', weight: 0.25 },
  { kind: 'sunny', weight: 0.2 },
] as const;
export type RandomEventKind = (typeof RANDOM_EVENTS)[number]['kind'];

export const COLLAPSE_TURNS = 3;

export type PlaceableBuilding = Exclude<BuildingType, 'sanctuary'>;

export interface BuildingDef {
  a: number;
  maxLevel: number;
  terrain: 'soil' | 'rock' | 'water' | 'stack';
  upkeep: number;
}

export const BUILDINGS: Record<PlaceableBuilding, BuildingDef> = {
  solar: { a: 14, maxLevel: 3, terrain: 'soil', upkeep: 0 },
  wind: { a: 24, maxLevel: 3, terrain: 'rock', upkeep: 0 },
  scrubber: { a: 18, maxLevel: 3, terrain: 'soil', upkeep: 1 },
  purifier: { a: 22, maxLevel: 3, terrain: 'water', upkeep: 1 },
  recycler: { a: 28, maxLevel: 3, terrain: 'soil', upkeep: 0 },
  battery: { a: 20, maxLevel: 3, terrain: 'soil', upkeep: 0 },
  sealer: { a: 45, maxLevel: 1, terrain: 'stack', upkeep: 0 },
};

export const PLACEABLE: readonly PlaceableBuilding[] = [
  'solar',
  'wind',
  'scrubber',
  'purifier',
  'recycler',
  'battery',
  'sealer',
];

export interface SpeciesDef {
  gold: number;
  energy: number;
  tolerance: number;
  withers: number;
  maturation: number;
  bio: number;
  eco: number;
}

export const SPECIES: Record<Species, SpeciesDef> = {
  grass: { gold: 3, energy: 1, tolerance: 40, withers: 60, maturation: 2, bio: 1, eco: 1 },
  shrub: { gold: 6, energy: 1, tolerance: 25, withers: 45, maturation: 3, bio: 2, eco: 2 },
  tree: { gold: 12, energy: 1, tolerance: 10, withers: 30, maturation: 5, bio: 3, eco: 4 },
};

export const SPECIES_LIST: readonly Species[] = ['grass', 'shrub', 'tree'];

export type Difficulty = 'gentle' | 'balanced' | 'hard';

export interface DifficultyDef {
  startGold: number;
  stacks: number;
  winRatio: number;
  turnLimit: number | null;
  /**
   * Collapse margin: average pollution at or above (starting average + margin) for
   * COLLAPSE_TURNS consecutive resolutions ends the game; null = never.
   */
  collapse: number | null;
}

export const DIFFICULTIES: Record<Difficulty, DifficultyDef> = {
  gentle: { startGold: 60, stacks: 2, winRatio: 0.55, turnLimit: null, collapse: null },
  balanced: { startGold: 40, stacks: 3, winRatio: 0.65, turnLimit: 60, collapse: 12 },
  hard: { startGold: 30, stacks: 4, winRatio: 0.7, turnLimit: 55, collapse: 10 },
};
