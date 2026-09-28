import {
  ACID_RAIN_AMOUNT,
  ACID_RAIN_TILES,
  CARAVAN_GOLD,
  EVENT_CHANCE,
  EVENT_START_TURN,
  RANDOM_EVENTS,
  SUNNY_ENERGY,
  type RandomEventKind,
} from '../config';
import { must, query } from '../ecs/world';
import { creditGold, produceEnergy } from '../economy/ledger';
import { next, shuffled, type Rng } from '../rng';
import type { SystemContext } from './context';
import { advanceGrowth } from './growth';
import { isRestorable } from './restorable';

export function rollEventKind(rng: Rng): RandomEventKind | null {
  if (next(rng) >= EVENT_CHANCE) return null;
  let r = next(rng);
  for (const ev of RANDOM_EVENTS) {
    if (r < ev.weight) return ev.kind;
    r -= ev.weight;
  }
  return RANDOM_EVENTS[RANDOM_EVENTS.length - 1]!.kind;
}

/** RandomEventSystem (design §4.9). Every effect goes through the ledger (R-8.3). */
export function randomEventSystem(ctx: SystemContext): RandomEventKind | null {
  const { s, emit, rng } = ctx;
  if (s.turn < EVENT_START_TURN) return null;
  const kind = rollEventKind(rng);
  if (!kind) return null;
  let amount = 0;
  const tiles: { x: number; y: number }[] = [];
  switch (kind) {
    case 'acidRain': {
      const candidates = query(s.world, 'Terrain', 'PollutionLevel').filter((e) => isRestorable(must(s.world, e, 'Terrain').kind));
      for (const e of shuffled(rng, candidates).slice(0, ACID_RAIN_TILES)) {
        const p = must(s.world, e, 'PollutionLevel');
        p.value = Math.min(100, p.value + ACID_RAIN_AMOUNT);
        const { x, y } = must(s.world, e, 'GridPosition');
        tiles.push({ x, y });
      }
      amount = ACID_RAIN_AMOUNT;
      break;
    }
    case 'caravan':
      creditGold(s.gold, CARAVAN_GOLD);
      emit({ type: 'gold:changed', delta: CARAVAN_GOLD, balance: s.gold.balance });
      amount = CARAVAN_GOLD;
      break;
    case 'pollinators':
      for (const e of query(s.world, 'Flora', 'GridPosition')) {
        if (!must(s.world, e, 'Flora').mature) advanceGrowth(ctx, e, 1);
      }
      amount = 1;
      break;
    case 'sunny':
      amount = produceEnergy(s.energy, SUNNY_ENERGY);
      emit({ type: 'energy:changed', delta: amount, current: s.energy.current });
      break;
  }
  emit({ type: 'event:random', kind, amount, tiles });
  return kind;
}
