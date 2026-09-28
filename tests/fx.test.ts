import { describe, expect, it } from 'vitest';
import {
  ACID_SPLASH,
  BUTTERFLY_MAX,
  EMIT_DELAY,
  FX_MAX,
  FxSim,
  GLINT_MAX,
  POLLEN_MAX,
  PULSE_MAX,
  RAIN_DROPS,
  SUN_MOTES,
  SWARM,
  fxAlpha,
  pulseAlpha,
  pulseRadius,
  sourcesFromState,
  tintAlpha,
  type AmbientSources,
} from '../src/render/fx';
import { createGame } from '../src/core/state';
import { DIFFICULTIES } from '../src/core/config';
import { must } from '../src/core/ecs/world';
import { spawnFlora } from '../src/core/systems/growth';
import { restorationSummary } from '../src/core/systems/restorable';
import { blankGame, setTile } from './helpers';

/** Deterministic LCG so the simulation tests are reproducible. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const lush: AmbientSources = {
  restored: Array.from({ length: 150 }, (_, i) => ({ x: i % 16, y: Math.floor(i / 16) })),
  stacks: [
    { x: 3, y: 3 },
    { x: 9, y: 2 },
  ],
};

describe('ambient FX simulation (R-11.7)', () => {
  it('pollen grows with the restored area but stays bounded', () => {
    expect(FxSim.pollenTarget(0)).toBe(0);
    expect(FxSim.pollenTarget(2)).toBe(0);
    expect(FxSim.pollenTarget(30)).toBe(10);
    expect(FxSim.pollenTarget(10_000)).toBe(POLLEN_MAX);
  });

  it('never exceeds the particle budget, and every particle expires', () => {
    const sim = new FxSim(lcg(1));
    sim.setSources(lush);
    for (let i = 0; i < 60; i++) sim.burst('leaf', 5, 5);
    sim.shower(16, 12, 1000);
    for (let i = 0; i < 900; i++) {
      sim.step(1 / 30);
      expect(sim.particles.length).toBeLessThanOrEqual(FX_MAX);
    }
    expect(sim.particles.some((p) => p.kind === 'pollen')).toBe(true);
    expect(sim.particles.some((p) => p.kind === 'smog')).toBe(true);
    sim.setSources({ restored: [], stacks: [] });
    for (let i = 0; i < 900; i++) sim.step(1 / 30);
    expect(sim.particles).toHaveLength(0);
    expect(sim.active()).toBe(false);
  });

  it('spawns nothing without sources or events', () => {
    const sim = new FxSim(lcg(2));
    for (let i = 0; i < 300; i++) sim.step(1 / 30);
    expect(sim.particles).toHaveLength(0);
  });

  it('bursts spawn the requested kind at the tile and fall under gravity', () => {
    const sim = new FxSim(lcg(3));
    sim.burst('spark', 4, 6, 8);
    expect(sim.particles).toHaveLength(8);
    for (const p of sim.particles) {
      expect(p.kind).toBe('spark');
      expect(p.x).toBeGreaterThanOrEqual(4);
      expect(p.x).toBeLessThanOrEqual(5);
    }
    const vy0 = sim.particles.map((p) => p.vy);
    sim.step(0.1);
    sim.particles.forEach((p, i) => expect(p.vy).toBeGreaterThan(vy0[i]!));
  });

  it('keeps every particle alpha within [0, 1] over its whole life', () => {
    const sim = new FxSim(lcg(4));
    sim.setSources(lush);
    sim.burst('drop', 2, 2);
    sim.shower(16, 12, 40);
    for (let i = 0; i < 400; i++) {
      sim.step(1 / 30);
      for (const p of sim.particles) {
        const a = fxAlpha(p);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
      }
    }
  });

  it('reads restored tiles and unsealed stacks from the game state', () => {
    const s = createGame(7, 'balanced');
    const src = sourcesFromState(s);
    expect(src.stacks).toHaveLength(DIFFICULTIES.balanced.stacks);
    expect(src.restored).toHaveLength(restorationSummary(s).restored);
    for (const p of [...src.stacks, ...src.restored]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThan(s.width);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThan(s.height);
    }
  });
});


describe('living world, weather and resolution waves (T11.1)', () => {
  const W = 16;
  const H = 12;
  const tiles = (n: number, from = 0) => Array.from({ length: n }, (_, i) => ({ x: (from + i) % W, y: Math.floor((from + i) / W) }));
  const count = (sim: FxSim, kind: string) => sim.particles.filter((p) => p.kind === kind).length;
  const none: AmbientSources = { restored: [], stacks: [] };

  it('butterflies need blossoms, keep to their target and flutter near home', () => {
    expect(FxSim.butterflyTarget(0)).toBe(0);
    expect(FxSim.butterflyTarget(1)).toBe(0);
    expect(FxSim.butterflyTarget(7)).toBe(3);
    expect(FxSim.butterflyTarget(999)).toBe(BUTTERFLY_MAX);
    const sim = new FxSim(lcg(5));
    sim.setSources({ ...none, blossoms: tiles(8), width: W, height: H });
    let peak = 0;
    for (let i = 0; i < 600; i++) {
      sim.step(1 / 30);
      peak = Math.max(peak, count(sim, 'butterfly'));
      expect(count(sim, 'butterfly')).toBeLessThanOrEqual(4);
      for (const p of sim.particles) {
        if (p.kind !== 'butterfly' || p.age < 0) continue;
        expect(Math.abs(p.x - p.hx!)).toBeLessThanOrEqual(0.95);
        expect(Math.abs(p.y - p.hy!)).toBeLessThanOrEqual(0.75);
      }
    }
    expect(peak).toBe(4);
    sim.setSources(none);
    for (let i = 0; i < 600; i++) sim.step(1 / 30);
    expect(count(sim, 'butterfly')).toBe(0);
  });

  it('birds cross the valley only once the land has healed enough', () => {
    const sim = new FxSim(lcg(6));
    sim.setSources({ ...none, birds: false, width: W, height: H });
    for (let i = 0; i < 900; i++) sim.step(1 / 30);
    expect(count(sim, 'bird')).toBe(0);
    sim.setSources({ ...none, birds: true, width: W, height: H });
    let seen = 0;
    for (let i = 0; i < 900; i++) {
      sim.step(1 / 30);
      for (const p of sim.particles) {
        if (p.kind !== 'bird') continue;
        seen++;
        expect(Math.abs(p.vx) * p.life).toBeGreaterThanOrEqual(W + 2);
        expect(p.y).toBeGreaterThanOrEqual(0);
        expect(p.y).toBeLessThanOrEqual(H * 0.6 + 0.5);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });

  it('glints twinkle only on clean water, up to their target', () => {
    expect(FxSim.glintTarget(3)).toBe(0);
    expect(FxSim.glintTarget(12)).toBe(3);
    expect(FxSim.glintTarget(999)).toBe(GLINT_MAX);
    const water = tiles(12, 40);
    const sim = new FxSim(lcg(9));
    sim.setSources({ ...none, cleanWater: water, width: W, height: H });
    let peak = 0;
    for (let i = 0; i < 300; i++) {
      sim.step(1 / 30);
      peak = Math.max(peak, count(sim, 'glint'));
      for (const p of sim.particles) {
        if (p.kind !== 'glint') continue;
        expect(water.some((t) => p.x >= t.x && p.x <= t.x + 1 && p.y >= t.y && p.y <= t.y + 1)).toBe(true);
      }
    }
    expect(peak).toBe(3);
  });

  it('acid rain falls across the map with a violet dimming and splashes, then clears', () => {
    const sim = new FxSim(lcg(7));
    sim.weather('acidRain', { width: W, height: H, tiles: [{ x: 3, y: 3 }, { x: 8, y: 5 }] });
    expect(count(sim, 'rain')).toBe(RAIN_DROPS);
    expect(count(sim, 'acid')).toBe(2 * ACID_SPLASH);
    expect(sim.tint).toMatchObject({ alpha: 0.25 });
    for (let i = 0; i < 120; i++) sim.step(1 / 30);
    expect(count(sim, 'rain')).toBe(0);
    expect(sim.tint).toBeNull();
    expect(sim.active()).toBe(false);
  });

  it('a sunny day glows warm with rising motes', () => {
    const sim = new FxSim(lcg(10));
    sim.weather('sunny', { width: W, height: H });
    expect(count(sim, 'mote')).toBe(SUN_MOTES);
    expect(sim.tint).toMatchObject({ alpha: 0.16 });
    for (const p of sim.particles) expect(p.vy).toBeLessThan(0);
    for (let i = 0; i < 150; i++) sim.step(1 / 30);
    expect(sim.active()).toBe(false);
  });

  it('pollinators send a swarm of butterflies across the map', () => {
    const sim = new FxSim(lcg(11));
    sim.weather('pollinators', { width: W, height: H });
    const swarm = sim.particles.filter((p) => p.kind === 'butterfly');
    expect(swarm).toHaveLength(SWARM);
    for (const p of swarm) {
      expect(p.vx).toBeGreaterThan(0);
      expect(p.x).toBeLessThan(0);
      expect(p.x + p.vx * p.life).toBeGreaterThan(W);
    }
    for (let i = 0; i < 600; i++) sim.step(1 / 30);
    expect(count(sim, 'butterfly')).toBe(0);
  });

  it('a scrap caravan sparks gold at the Sanctuary', () => {
    const sim = new FxSim(lcg(12));
    sim.weather('caravan', { width: W, height: H, at: { x: 2, y: 5 } });
    const sparks = sim.particles.filter((p) => p.kind === 'spark');
    expect(sparks.length).toBeGreaterThan(0);
    for (const p of sparks) {
      expect(p.x).toBeGreaterThanOrEqual(2);
      expect(p.x).toBeLessThanOrEqual(3);
    }
  });

  it('resolution waves grow from the tile to their radius, fade out, and cleansing comes first', () => {
    const sim = new FxSim(lcg(8));
    sim.pulse('clean', 4, 4, 2);
    sim.pulse('emit', 9, 3, 3, EMIT_DELAY);
    const emit = sim.pulses.find((p) => p.kind === 'emit')!;
    expect(pulseAlpha(emit)).toBe(0);
    let prev = -1;
    let maxR = 0;
    for (let i = 0; i < 60; i++) {
      sim.step(1 / 60);
      const clean = sim.pulses.find((p) => p.kind === 'clean');
      if (!clean) break;
      const r = pulseRadius(clean);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
      maxR = r;
      const a = pulseAlpha(clean);
      expect(a >= 0 && a <= 1).toBe(true);
    }
    expect(maxR).toBeGreaterThan(2.3);
    expect(maxR).toBeLessThanOrEqual(2.5);
    for (let i = 0; i < 120; i++) sim.step(1 / 30);
    expect(sim.pulses).toHaveLength(0);
    expect(sim.active()).toBe(false);
    for (let i = 0; i < 100; i++) sim.pulse('clean', 1, 1, 1);
    expect(sim.pulses.length).toBe(PULSE_MAX);
  });

  it('stays within the particle budget with every source and effect at once', () => {
    const sim = new FxSim(lcg(13));
    sim.setSources({ ...lush, blossoms: tiles(60), cleanWater: tiles(40, 100), birds: true, width: W, height: H });
    sim.weather('acidRain', { width: W, height: H, tiles: tiles(5) });
    sim.weather('sunny', { width: W, height: H });
    sim.weather('pollinators', { width: W, height: H });
    for (let i = 0; i < 60; i++) sim.burst('leaf', 5, 5);
    sim.shower(W, H, 500);
    for (let i = 0; i < 900; i++) {
      sim.step(1 / 30);
      expect(sim.particles.length).toBeLessThanOrEqual(FX_MAX);
      for (const p of sim.particles) {
        const a = fxAlpha(p);
        expect(a >= 0 && a <= 1).toBe(true);
      }
      if (sim.tint) expect(tintAlpha(sim.tint) >= 0 && tintAlpha(sim.tint) <= sim.tint.alpha).toBe(true);
    }
  });

  it('reads blossoms, clean water and the bird threshold from the game state', () => {
    const s = blankGame('balanced', 7);
    const e = spawnFlora(s, 'tree', 9, 9);
    must(s.world, e, 'Flora').mature = true;
    spawnFlora(s, 'grass', 10, 9);
    setTile(s, 5, 5, 'water', 0);
    setTile(s, 6, 5, 'water', 30);
    const src = sourcesFromState(s);
    expect(src.blossoms).toEqual([{ x: 9, y: 9 }]);
    expect(src.cleanWater).toEqual([{ x: 5, y: 5 }]);
    expect(src.birds).toBe(false);
    expect(src.width).toBe(s.width);
    expect(src.height).toBe(s.height);
    for (const t of s.tiles) must(s.world, t, 'EcoValue').restored = true;
    expect(sourcesFromState(s).birds).toBe(true);
  });
});
