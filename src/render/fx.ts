/**
 * Ambient and event particles drawn on a transparent canvas above the map (R-11.7).
 *
 * `FxSim` is a pure, DOM-free particle simulation in tile units (unit-tested); `FxLayer`
 * paints it snapped to the art-pixel grid so particles look like part of the pixel art.
 * The layer is fed only through event-bus subscriptions and state snapshots (R-11.3),
 * and is switched off completely when reduced motion is on (R-13.4).
 */
import { get, must } from '../core/ecs/world';
import type { GameState } from '../core/state';

export type FxKind = 'pollen' | 'smog' | 'leaf' | 'spark' | 'drop' | 'petal';
export type BurstKind = 'leaf' | 'spark' | 'drop';

export interface Particle {
  kind: FxKind;
  /** Position and velocity in tile units (per second). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Edge length in art pixels (1 art pixel = 1/16 tile). */
  size: number;
  color: string;
  phase: number;
}

export interface AmbientSources {
  restored: { x: number; y: number }[];
  stacks: { x: number; y: number }[];
}

export const FX_MAX = 240;
export const POLLEN_MAX = 36;
const SMOG_PER_STACK = 8;
const SMOG_INTERVAL = 0.26;

/** Spring Blossom motes: warm cream, soft pink, fresh green, sun yellow. */
const POLLEN_COLORS = ['#fff3c4', '#f9c8d8', '#d8f5a2', '#ffe27a'];
/** Light, cool greys so the plume reads against dark toxic ground. */
const SMOG_COLORS = ['#8f8ca3', '#a9a6ba', '#c4c1d3'];
const PETAL_COLORS = ['#f29bb6', '#f9c8d8', '#fff3c4', '#a5d65a', '#ffe27a'];
const BURSTS: Record<BurstKind, { colors: string[]; count: number; speed: number; lift: number; gravity: number; life: number }> = {
  leaf: { colors: ['#58a84b', '#a5d65a', '#f29bb6', '#fff3c4'], count: 12, speed: 1.3, lift: 1.1, gravity: 2.2, life: 1.1 },
  spark: { colors: ['#f2c14e', '#ffe27a', '#f4f1de'], count: 9, speed: 1.1, lift: 1.4, gravity: 2.6, life: 0.8 },
  drop: { colors: ['#6ec3e8', '#38c7b8', '#c9f1ff'], count: 9, speed: 0.9, lift: 0.9, gravity: 3, life: 0.8 },
};

/** Fade in quickly, hold, and fade out over the last 35 % of life. */
export function fxAlpha(p: Particle): number {
  const fadeIn = Math.min(1, p.age / 0.25);
  const fadeOut = Math.min(1, (p.life - p.age) / (p.life * 0.35));
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
}

/** Restored tiles and unsealed stacks, read from the ECS world. */
export function sourcesFromState(s: GameState): AmbientSources {
  const restored: AmbientSources['restored'] = [];
  const stacks: AmbientSources['stacks'] = [];
  s.tiles.forEach((e, i) => {
    const x = i % s.width;
    const y = Math.floor(i / s.width);
    if (must(s.world, e, 'EcoValue').restored) restored.push({ x, y });
    if (get(s.world, e, 'ToxicSource')?.sealed === false) stacks.push({ x, y });
  });
  return { restored, stacks };
}

export class FxSim {
  particles: Particle[] = [];
  private sources: AmbientSources = { restored: [], stacks: [] };
  private smogClock = 0;

  constructor(
    private readonly rand: () => number = Math.random,
    readonly max: number = FX_MAX,
  ) {}

  /** How many pollen motes should drift over the current restored area. */
  static pollenTarget(restoredTiles: number): number {
    return Math.min(POLLEN_MAX, Math.floor(restoredTiles / 3));
  }

  setSources(src: AmbientSources): void {
    this.sources = src;
  }

  /** True while anything is (or will keep) moving. */
  active(): boolean {
    return this.particles.length > 0 || this.sources.stacks.length > 0 || FxSim.pollenTarget(this.sources.restored.length) > 0;
  }

  burst(kind: BurstKind, tx: number, ty: number, count = BURSTS[kind].count): void {
    const b = BURSTS[kind];
    for (let i = 0; i < count; i++) {
      const angle = this.rand() * Math.PI * 2;
      const speed = b.speed * (0.45 + this.rand() * 0.55);
      this.push({
        kind,
        x: tx + 0.3 + this.rand() * 0.4,
        y: ty + 0.3 + this.rand() * 0.4,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed * 0.6 - b.lift,
        age: 0,
        life: b.life * (0.7 + this.rand() * 0.5),
        size: 1,
        color: this.pick(b.colors),
        phase: 0,
      });
    }
  }

  /** Petals drifting down across the whole map (milestones, victory). */
  shower(width: number, height: number, count: number): void {
    for (let i = 0; i < count; i++) {
      this.push({
        kind: 'petal',
        x: this.rand() * width,
        y: -0.5 - this.rand() * height * 0.6,
        vx: 0.15 + this.rand() * 0.25,
        vy: 0.9 + this.rand() * 0.8,
        age: 0,
        life: 4 + this.rand() * 3,
        size: this.rand() < 0.3 ? 2 : 1,
        color: this.pick(PETAL_COLORS),
        phase: this.rand() * Math.PI * 2,
      });
    }
  }

  step(dt: number): void {
    const h = Math.max(0, Math.min(dt, 0.1));
    for (const p of this.particles) {
      p.age += h;
      switch (p.kind) {
        case 'pollen':
          p.x += (p.vx + Math.sin(p.age * 1.3 + p.phase) * 0.12) * h;
          p.y += (p.vy + Math.cos(p.age * 1.7 + p.phase) * 0.08) * h;
          break;
        case 'smog':
          p.x += p.vx * h;
          p.y += p.vy * h;
          p.vy *= 1 - 0.35 * h;
          p.size = 1 + Math.min(2, (p.age / p.life) * 3);
          break;
        case 'petal':
          p.x += (p.vx + Math.sin(p.age * 2.2 + p.phase) * 0.35) * h;
          p.y += p.vy * h;
          break;
        default: {
          const g = BURSTS[p.kind as BurstKind].gravity;
          p.vx *= 1 - 1.2 * h;
          p.vy += g * h;
          p.x += p.vx * h;
          p.y += p.vy * h;
        }
      }
    }
    this.particles = this.particles.filter((p) => p.age < p.life);
    this.spawnAmbient(h);
  }

  private spawnAmbient(h: number): void {
    const { restored, stacks } = this.sources;
    const target = FxSim.pollenTarget(restored.length);
    let pollen = 0;
    let smog = 0;
    for (const p of this.particles) {
      if (p.kind === 'pollen') pollen++;
      else if (p.kind === 'smog') smog++;
    }
    // Trickle motes in so a freshly loaded map does not "pop".
    for (let budget = Math.ceil(h * 8); budget > 0 && pollen < target; budget--, pollen++) {
      const t = restored[Math.floor(this.rand() * restored.length)]!;
      this.push({
        kind: 'pollen',
        x: t.x + 0.15 + this.rand() * 0.7,
        y: t.y + 0.15 + this.rand() * 0.7,
        vx: (this.rand() - 0.5) * 0.12,
        vy: -0.03 - this.rand() * 0.05,
        age: 0,
        life: 4 + this.rand() * 4,
        size: this.rand() < 0.2 ? 2 : 1,
        color: this.pick(POLLEN_COLORS),
        phase: this.rand() * Math.PI * 2,
      });
    }
    if (stacks.length === 0) {
      this.smogClock = 0;
      return;
    }
    this.smogClock += h;
    while (this.smogClock >= SMOG_INTERVAL) {
      this.smogClock -= SMOG_INTERVAL;
      for (const st of stacks) {
        if (smog >= stacks.length * SMOG_PER_STACK) break;
        smog++;
        // The stack sprite's plume sits in the upper-left of its tile.
        this.push({
          kind: 'smog',
          x: st.x + 0.2 + this.rand() * 0.25,
          y: st.y + 0.05,
          vx: 0.05 + this.rand() * 0.08,
          vy: -0.22 - this.rand() * 0.1,
          age: 0,
          life: 1.8 + this.rand() * 1,
          size: 1,
          color: this.pick(SMOG_COLORS),
          phase: 0,
        });
      }
    }
  }

  private push(p: Particle): void {
    if (this.particles.length < this.max) this.particles.push(p);
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)]!;
  }
}

/** Paints an `FxSim` on its own canvas at ~30 fps, only while something moves. */
export class FxLayer {
  readonly sim: FxSim;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly unit: number;
  private raf = 0;
  private last = 0;
  private enabled = true;

  constructor(
    readonly canvas: HTMLCanvasElement,
    private readonly tilePx: number,
    sim: FxSim = new FxSim(),
  ) {
    this.sim = sim;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.unit = tilePx / 16;
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    if (on) {
      this.wake();
      return;
    }
    this.sim.particles = [];
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }

  setSources(src: AmbientSources): void {
    this.sim.setSources(src);
    this.wake();
  }

  burst(kind: BurstKind, tx: number, ty: number, count?: number): void {
    if (!this.enabled) return;
    this.sim.burst(kind, tx, ty, count);
    this.wake();
  }

  shower(width: number, height: number, count: number): void {
    if (!this.enabled) return;
    this.sim.shower(width, height, count);
    this.wake();
  }

  private wake(): void {
    if (!this.enabled || this.raf || !this.sim.active()) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  private readonly frame = (now: number): void => {
    this.raf = 0;
    // Stop for good once the screen that owns this canvas is gone.
    if (!this.enabled || !this.canvas.isConnected) return;
    if (now - this.last >= 1000 / 30) {
      this.sim.step((now - this.last) / 1000);
      this.last = now;
      this.paint();
    }
    if (this.sim.active()) this.raf = requestAnimationFrame(this.frame);
    else this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  };

  private paint(): void {
    const { ctx, unit, tilePx } = this;
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    for (const p of this.sim.particles) {
      const a = fxAlpha(p);
      if (a <= 0) continue;
      const size = Math.max(1, Math.round(p.size)) * unit;
      // Snap to the art-pixel grid so particles read as pixel art, not blur.
      const x = Math.round((p.x * tilePx) / unit) * unit - Math.floor(size / 2);
      const y = Math.round((p.y * tilePx) / unit) * unit - Math.floor(size / 2);
      ctx.globalAlpha = p.kind === 'smog' ? a * 0.75 : a;
      ctx.fillStyle = p.color;
      ctx.fillRect(x, y, size, size);
    }
    ctx.globalAlpha = 1;
  }
}
