/** Component types: plain data, no behaviour (design §3.2). */

export type TerrainKind = 'soil' | 'water' | 'rock' | 'ruin' | 'stack';
export type BuildingType =
  | 'sanctuary'
  | 'solar'
  | 'wind'
  | 'scrubber'
  | 'purifier'
  | 'recycler'
  | 'battery'
  | 'sealer';
export type Species = 'grass' | 'shrub' | 'tree';

export interface GridPosition { x: number; y: number }
export interface Terrain { kind: TerrainKind }
export interface PollutionLevel { value: number }
export interface EcoValue { restored: boolean; everRestored: boolean }
export interface Salvage { remaining: number; density: number }
export interface ToxicSource { sealed: boolean }
export interface Building { type: BuildingType; level: number; goldInvested: number }
export interface EnergyProducer { kind: 'sanctuary' | 'solar' | 'wind' }
export interface EnergyStorage { marker: true }
export interface GoldProducer { marker: true }
export interface Cleanser { medium: 'soil' | 'water' }
export interface EnergyCost { upkeep: number }
export interface ActiveState { enabled: boolean; powered: boolean }
export interface Flora { species: Species; growth: number; mature: boolean }
export interface Immovable { marker: true }

export interface ComponentMap {
  GridPosition: GridPosition;
  Terrain: Terrain;
  PollutionLevel: PollutionLevel;
  EcoValue: EcoValue;
  Salvage: Salvage;
  ToxicSource: ToxicSource;
  Building: Building;
  EnergyProducer: EnergyProducer;
  EnergyStorage: EnergyStorage;
  GoldProducer: GoldProducer;
  Cleanser: Cleanser;
  EnergyCost: EnergyCost;
  ActiveState: ActiveState;
  Flora: Flora;
  Immovable: Immovable;
}

export type ComponentName = keyof ComponentMap;

export const COMPONENT_NAMES: readonly ComponentName[] = [
  'GridPosition',
  'Terrain',
  'PollutionLevel',
  'EcoValue',
  'Salvage',
  'ToxicSource',
  'Building',
  'EnergyProducer',
  'EnergyStorage',
  'GoldProducer',
  'Cleanser',
  'EnergyCost',
  'ActiveState',
  'Flora',
  'Immovable',
];
