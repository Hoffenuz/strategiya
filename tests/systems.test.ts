import { describe, expect, it } from 'vitest';
import { must, query } from '../src/core/ecs/world';
import type { GameEvent } from '../src/core/events';
import { seedRng } from '../src/core/rng';
import { createGame, spawnBuilding, type GameState } from '../src/core/state';
import type { SystemContext } from '../src/core/systems/context';
import { economySystem } from '../src/core/systems/economy';
import { energySystem } from '../src/core/systems/energy';
import { cleansingSystem } from '../src/core/systems/cleansing';
import { pollutionSystem } from '../src/core/systems/pollution';
import { growthSystem, spawnFlora } from '../src/core/systems/growth';
import { restorationSystem } from '../src/core/systems/restoration';
import { victorySystem } from '../src/core/systems/victory';
import { restorationSummary } from '../src/core/systems/restorable';
import { randomEventSystem, rollEventKind } from '../src/core/systems/randomEvents';
import { isRestorable } from '../src/core/systems/restorable';
import { ACID_RAIN_AMOUNT, ACID_RAIN_TILES } from '../src/core/config';
import { blankGame, pollutionAt, setTile } from './helpers';

function ctx(s: GameState, seed = 1): SystemContext & { events: GameEvent[] } {
  const events: GameEvent[] = [];
  return { s, emit: (e) => events.push(e), rng: seedRng(seed), events };
}

describe('Economy, Energy and Upkeep systems (T3.1)', () => {
  it('credits linear income from recycler levels', () => {
    const s = blankGame();
    const r = spawnBuilding(s.world, 'recycler', 10, 1, 28);
    must(s.world, r, 'Building').level = 3;
    spawnBuilding(s.world, 'recycler', 11, 1, 28);
    const before = s.gold.balance;
    expect(economySystem(ctx(s))).toBe(2 + 4 * 4);
    expect(s.gold.balance).toBe(before + 18);
  });

  it('caps production and records curtailment', () => {
    const s = blankGame();
    spawnBuilding(s.world, 'wind', 12, 2, 24); // +3
    s.energy.current = s.energy.max - 2;
    s.energy.produced = s.energy.current + s.energy.consumed;
    const r = energySystem(ctx(s));
    expect(r.produced).toBe(2);
    expect(r.curtailed).toBe(4); // gross 6 = base 3 + wind 3
    expect(s.energy.current).toBe(s.energy.max);
  });

  it('pays upkeep from production first, in ascending id order, and sleeps what it cannot pay', () => {
    const s = blankGame();
    const ids = [1, 2, 3, 4, 5].map((i) => spawnBuilding(s.world, 'scrubber', i + 5, 8, 18));
    s.energy.consumed += s.energy.current;
    s.energy.current = 0; // pool = 0 + base 3
    const c = ctx(s);
    const r = energySystem(c);
    expect(r.upkeep).toBe(3);
    const powered = ids.map((e) => must(s.world, e, 'ActiveState').powered);
    expect(powered).toEqual([true, true, true, false, false]);
    expect(s.energy.current).toBe(0);
    expect(c.events.filter((e) => e.type === 'building:unpowered')).toHaveLength(2);
  });

  it('disabled buildings pay nothing and do not work', () => {
    const s = blankGame();
    const e = spawnBuilding(s.world, 'scrubber', 8, 8, 18);
    must(s.world, e, 'ActiveState').enabled = false;
    const r = energySystem(ctx(s));
    expect(r.upkeep).toBe(0);
    expect(must(s.world, e, 'ActiveState').powered).toBe(false);
  });
});

describe('Cleansing and Pollution systems (T3.3)', () => {
  it('scrubber cleans K on its tile and ⌊K/2⌋ within radius', () => {
    const s = blankGame();
    for (let y = 3; y <= 9; y++) for (let x = 7; x <= 13; x++) setTile(s, x, y, 'soil', 50);
    spawnBuilding(s.world, 'scrubber', 10, 6, 18);
    cleansingSystem(ctx(s));
    expect(pollutionAt(s, 10, 6)).toBe(50 - 12);
    expect(pollutionAt(s, 11, 7)).toBe(50 - 6);
    expect(pollutionAt(s, 12, 6)).toBe(50);
  });

  it('level 3 scrubber reaches radius 2', () => {
    const s = blankGame();
    for (let y = 3; y <= 9; y++) for (let x = 7; x <= 13; x++) setTile(s, x, y, 'soil', 50);
    const e = spawnBuilding(s.world, 'scrubber', 10, 6, 18);
    must(s.world, e, 'Building').level = 3;
    cleansingSystem(ctx(s));
    expect(pollutionAt(s, 10, 6)).toBe(50 - 17);
    expect(pollutionAt(s, 12, 8)).toBe(50 - 8);
    expect(pollutionAt(s, 13, 6)).toBe(50);
  });

  it('purifier cleans water fully and land by half', () => {
    const s = blankGame();
    setTile(s, 10, 6, 'water', 60);
    setTile(s, 10, 7, 'water', 60);
    setTile(s, 11, 6, 'soil', 60);
    spawnBuilding(s.world, 'purifier', 10, 6, 22);
    cleansingSystem(ctx(s));
    expect(pollutionAt(s, 10, 6)).toBe(42);
    expect(pollutionAt(s, 10, 7)).toBe(42);
    expect(pollutionAt(s, 11, 6)).toBe(51);
  });

  it('never cleans below zero', () => {
    const s = blankGame();
    setTile(s, 10, 6, 'soil', 3);
    spawnBuilding(s.world, 'scrubber', 10, 6, 18);
    cleansingSystem(ctx(s));
    expect(pollutionAt(s, 10, 6)).toBe(0);
  });

  it('stacks emit with falloff 6/3/1, clamp at 100, and stop when sealed', () => {
    const s = blankGame();
    setTile(s, 10, 6, 'stack', 100);
    setTile(s, 14, 6, 'soil', 98);
    pollutionSystem(ctx(s));
    expect([pollutionAt(s, 11, 6), pollutionAt(s, 12, 6), pollutionAt(s, 13, 6), pollutionAt(s, 14, 6)]).toEqual([6, 3, 1, 98]);
    setTile(s, 12, 3, 'soil', 99);
    pollutionSystem(ctx(s));
    expect(pollutionAt(s, 12, 3)).toBe(100);
    s.world.c.ToxicSource[query(s.world, 'ToxicSource')[0]!]!.sealed = true;
    pollutionSystem(ctx(s));
    expect(pollutionAt(s, 11, 6)).toBe(12);
  });
});

describe('Growth system (T3.5)', () => {
  it('grows +1, or +2 beside clean water, and matures', () => {
    const s = blankGame();
    const a = spawnFlora(s, 'grass', 10, 2);
    const b = spawnFlora(s, 'tree', 10, 8);
    setTile(s, 11, 8, 'water', 0);
    const c = ctx(s);
    growthSystem(c);
    expect(must(s.world, a, 'Flora').growth).toBe(1);
    expect(must(s.world, b, 'Flora').growth).toBe(2);
    growthSystem(c);
    expect(must(s.world, a, 'Flora').mature).toBe(true);
    expect(c.events.some((e) => e.type === 'flora:matured')).toBe(true);
  });

  it('mature plants clean their own tile', () => {
    const s = blankGame();
    setTile(s, 10, 2, 'soil', 20);
    const a = spawnFlora(s, 'shrub', 10, 2);
    must(s.world, a, 'Flora').mature = true;
    growthSystem(ctx(s));
    expect(pollutionAt(s, 10, 2)).toBe(18);
  });

  it('plants wither above their threshold', () => {
    const s = blankGame();
    setTile(s, 10, 2, 'soil', 31);
    spawnFlora(s, 'tree', 10, 2);
    setTile(s, 12, 2, 'soil', 30);
    spawnFlora(s, 'tree', 12, 2);
    const c = ctx(s);
    growthSystem(c);
    expect(query(s.world, 'Flora')).toHaveLength(1);
    expect(c.events.filter((e) => e.type === 'flora:withered')).toHaveLength(1);
  });

  it('spreads only onto empty clean-enough soil', () => {
    for (let seed = 1; seed < 200; seed++) {
      const s = blankGame();
      setTile(s, 10, 5, 'soil', 0);
      const g = spawnFlora(s, 'grass', 10, 5);
      must(s.world, g, 'Flora').mature = true;
      setTile(s, 10, 4, 'soil', 21);
      setTile(s, 11, 5, 'water', 0);
      setTile(s, 9, 5, 'rock', 0);
      spawnBuilding(s.world, 'solar', 10, 6, 14);
      growthSystem(ctx(s, seed));
      expect(query(s.world, 'Flora')).toHaveLength(1);
    }
  });
});

describe('Restoration and Victory systems (T3.7)', () => {
  it('pays the bounty once per tile and each milestone once', () => {
    const s = blankGame();
    const c = ctx(s);
    restorationSystem(c);
    // Blank map: only water would count, and there is none; sanctuary tile holds a building.
    const first = s.stats.bountyPaid;
    expect(first).toBe(2);
    restorationSystem(c);
    expect(s.stats.bountyPaid).toBe(first);
    for (const e of query(s.world, 'Terrain')) must(s.world, e, 'Terrain').kind = 'water';
    restorationSystem(c);
    expect(s.milestonesReached).toBe(4);
    expect(s.stats.milestoneGold).toBe(20 + 40 + 60 + 80);
    const gold = s.gold.balance;
    restorationSystem(c);
    expect(s.gold.balance).toBe(gold);
  });

  it('wins at the threshold, loses on time, and never on gentle', () => {
    const s = blankGame('balanced');
    for (const e of query(s.world, 'Terrain')) must(s.world, e, 'Terrain').kind = 'water';
    restorationSystem(ctx(s));
    expect(victorySystem(ctx(s))?.result).toBe('victory');

    const t = blankGame('balanced');
    t.turn = 60;
    expect(victorySystem(ctx(t))).toMatchObject({ result: 'defeat', reason: 'time' });

    const g = blankGame('gentle');
    g.turn = 10_000;
    for (const e of g.tiles) must(g.world, e, 'PollutionLevel').value = 100;
    for (let i = 0; i < 10; i++) expect(victorySystem(ctx(g))).toBeNull();
  });

  it('collapses after 3 consecutive heavy turns above the start baseline', () => {
    const s = blankGame('balanced');
    s.startPollution = 40;
    for (const e of s.tiles) must(s.world, e, 'PollutionLevel').value = 60;
    expect(victorySystem(ctx(s))).toBeNull();
    expect(victorySystem(ctx(s))).toBeNull();
    expect(victorySystem(ctx(s))).toMatchObject({ result: 'defeat', reason: 'collapse' });
    const r = blankGame('balanced');
    r.startPollution = 40;
    r.collapseStreak = 2;
    expect(victorySystem(ctx(r))).toBeNull();
    expect(r.collapseStreak).toBe(0);
  });

  it('restoration ratio stays within [0, 1]', () => {
    const s = blankGame();
    const r = restorationSummary(s);
    expect(r.ratio).toBeGreaterThanOrEqual(0);
    expect(r.ratio).toBeLessThanOrEqual(1);
  });
});

describe('Random events (T3.9)', () => {
  it('follows the documented probability and weights', () => {
    const rng = seedRng(123);
    const counts: Record<string, number> = { none: 0, acidRain: 0, caravan: 0, pollinators: 0, sunny: 0 };
    const n = 40000;
    for (let i = 0; i < n; i++) counts[rollEventKind(rng) ?? 'none']!++;
    expect(counts.none! / n).toBeCloseTo(0.7, 1);
    expect(counts.acidRain! / n).toBeCloseTo(0.3 * 0.3, 1);
    expect(counts.caravan! / n).toBeCloseTo(0.3 * 0.25, 1);
    expect(counts.sunny! / n).toBeCloseTo(0.3 * 0.2, 1);
  });
});


describe('Resolution waves and weather data (T10.7)', () => {
  it('every working cleanser reports a pulse with its radius; sleeping ones stay quiet', () => {
    const s = blankGame();
    setTile(s, 12, 8, 'water', 30);
    spawnBuilding(s.world, 'scrubber', 5, 4, 18);
    const big = spawnBuilding(s.world, 'scrubber', 9, 4, 18);
    must(s.world, big, 'Building').level = 3;
    spawnBuilding(s.world, 'purifier', 12, 8, 22);
    const asleep = spawnBuilding(s.world, 'scrubber', 6, 9, 18);
    must(s.world, asleep, 'ActiveState').powered = false;
    const c = ctx(s);
    cleansingSystem(c);
    expect(c.events.filter((e) => e.type === 'building:pulsed')).toEqual([
      { type: 'building:pulsed', building: 'scrubber', x: 5, y: 4, radius: 1 },
      { type: 'building:pulsed', building: 'scrubber', x: 9, y: 4, radius: 2 },
      { type: 'building:pulsed', building: 'purifier', x: 12, y: 8, radius: 1 },
    ]);
  });

  it('every unsealed stack reports its emission reach', () => {
    const s = blankGame();
    setTile(s, 4, 3, 'stack');
    setTile(s, 10, 6, 'stack');
    s.world.c.ToxicSource[s.tiles[6 * s.width + 10]!] = { sealed: true };
    const c = ctx(s);
    pollutionSystem(c);
    expect(c.events.filter((e) => e.type === 'stack:emitted')).toEqual([{ type: 'stack:emitted', x: 4, y: 3, radius: 3 }]);
  });

  it('acid rain names exactly the tiles it hit; other events name none', () => {
    const seen = new Set<string>();
    for (let seed = 1; seed < 400 && seen.size < 4; seed++) {
      const s = createGame(seed % 7, 'balanced');
      s.turn = 5;
      const before = s.tiles.map((e) => must(s.world, e, 'PollutionLevel').value);
      const c = ctx(s, seed);
      const kind = randomEventSystem(c);
      if (!kind) continue;
      seen.add(kind);
      const ev = c.events.find((e) => e.type === 'event:random');
      expect(ev?.type === 'event:random' && ev.kind).toBe(kind);
      if (ev?.type !== 'event:random') continue;
      if (kind !== 'acidRain') {
        expect(ev.tiles).toEqual([]);
        continue;
      }
      expect(ev.tiles).toHaveLength(ACID_RAIN_TILES);
      expect(new Set(ev.tiles.map((t) => `${t.x},${t.y}`)).size).toBe(ACID_RAIN_TILES);
      for (const t of ev.tiles) {
        const i = t.y * s.width + t.x;
        const e = s.tiles[i]!;
        expect(isRestorable(must(s.world, e, 'Terrain').kind)).toBe(true);
        expect(must(s.world, e, 'PollutionLevel').value).toBe(Math.min(100, before[i]! + ACID_RAIN_AMOUNT));
      }
    }
    expect(seen.has('acidRain')).toBe(true);
  });
});
