import type { BuildingType } from './ecs/components';
import { add, createEntity, createWorld, type Entity, type World } from './ecs/world';
import { DIFFICULTIES, GRID_HEIGHT, GRID_WIDTH, type Difficulty } from './config';
import type { EnergyLedger, GoldLedger } from './economy/ledger';
import { energyCapacity } from './economy/formulas';
import type { Phase } from './phases';
import { seedRng } from './rng';
import { generateMap } from './map';
import { restorationSummary } from './systems/restorable';

export const SAVE_VERSION = 1;

export interface GameStats {
  salvaged: number;
  planted: number;
  built: number;
  withered: number;
  spread: number;
  restoredEver: number;
  bountyPaid: number;
  milestoneGold: number;
  sealed: number;
}

export interface Outcome {
  result: 'victory' | 'defeat';
  reason: 'restored' | 'time' | 'collapse';
  turn: number;
  score: number;
}

export interface GameState {
  version: typeof SAVE_VERSION;
  seed: number;
  difficulty: Difficulty;
  width: number;
  height: number;
  turn: number;
  phase: Phase;
  world: World;
  tiles: Entity[];
  gold: GoldLedger;
  energy: EnergyLedger;
  rng: number;
  processedTx: string[];
  milestonesReached: number;
  collapseStreak: number;
  /** Average pollution of restorable tiles at genesis (baseline for collapse). */
  startPollution: number;
  outcome: Outcome | null;
  stats: GameStats;
  /** Milestone indices (1..4) reached, in order, for the Guardian's journal. */
  journal: number[];
}

export function emptyStats(): GameStats {
  return { salvaged: 0, planted: 0, built: 0, withered: 0, spread: 0, restoredEver: 0, bountyPaid: 0, milestoneGold: 0, sealed: 0 };
}

/** Adds a building entity with the components its type implies. */
export function spawnBuilding(world: World, type: BuildingType, x: number, y: number, goldInvested: number): Entity {
  const e = createEntity(world);
  add(world, e, 'GridPosition', { x, y });
  add(world, e, 'Building', { type, level: 1, goldInvested });
  switch (type) {
    case 'sanctuary':
      add(world, e, 'EnergyProducer', { kind: 'sanctuary' });
      add(world, e, 'Immovable', { marker: true });
      break;
    case 'solar':
    case 'wind':
      add(world, e, 'EnergyProducer', { kind: type });
      add(world, e, 'ActiveState', { enabled: true, powered: true });
      break;
    case 'scrubber':
      add(world, e, 'Cleanser', { medium: 'soil' });
      add(world, e, 'EnergyCost', { upkeep: 1 });
      add(world, e, 'ActiveState', { enabled: true, powered: true });
      break;
    case 'purifier':
      add(world, e, 'Cleanser', { medium: 'water' });
      add(world, e, 'EnergyCost', { upkeep: 1 });
      add(world, e, 'ActiveState', { enabled: true, powered: true });
      break;
    case 'recycler':
      add(world, e, 'GoldProducer', { marker: true });
      break;
    case 'battery':
      add(world, e, 'EnergyStorage', { marker: true });
      break;
    case 'sealer':
      break;
  }
  return e;
}

export function createGame(seed: number, difficulty: Difficulty): GameState {
  const seed32 = seed >>> 0;
  const def = DIFFICULTIES[difficulty];
  const rng = seedRng(seed32);
  const world = createWorld();
  const { tiles, sanctuary } = generateMap(world, rng, GRID_WIDTH, GRID_HEIGHT, def.stacks);
  spawnBuilding(world, 'sanctuary', sanctuary.x, sanctuary.y, 0);
  const max = energyCapacity(0);
  const state: GameState = {
    version: SAVE_VERSION,
    seed: seed32,
    difficulty,
    width: GRID_WIDTH,
    height: GRID_HEIGHT,
    turn: 1,
    phase: 'action',
    world,
    tiles,
    // Genesis: starting resources count as earned / produced so conservation holds from turn 1.
    gold: { balance: def.startGold, earned: def.startGold, spent: 0 },
    energy: { current: max, produced: max, consumed: 0, curtailed: 0, max },
    rng: rng.state,
    processedTx: [],
    milestonesReached: 0,
    collapseStreak: 0,
    outcome: null,
    stats: emptyStats(),
    journal: [],
    startPollution: 0,
  };
  state.startPollution = Math.round(restorationSummary(state).averagePollution);
  return state;
}

export function cloneState(s: GameState): GameState {
  return structuredClone(s);
}
