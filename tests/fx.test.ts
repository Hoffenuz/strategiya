import { describe, expect, it } from 'vitest';
import { FX_MAX, FxSim, POLLEN_MAX, fxAlpha, sourcesFromState, type AmbientSources } from '../src/render/fx';
import { createGame } from '../src/core/state';
import { DIFFICULTIES } from '../src/core/config';
import { restorationSummary } from '../src/core/systems/restorable';

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
