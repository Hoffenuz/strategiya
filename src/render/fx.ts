/**
 * Ambient life, weather and event particles drawn on a transparent canvas above the map
 * (R-11.7, R-11.15 – R-11.17).
 *
 * `FxSim` is a pure, DOM-free simulation in tile units (unit-tested); `FxLayer` paints it
 * snapped to the art-pixel grid so particles look like part of the pixel art. The layer is
 * fed only through event-bus subscriptions and state snapshots (R-11.3), and is switched
 * off completely when reduced motion is on (R-13.4).
 */
import { get, must, query } from '../core/ecs/world';
import { worldProgress } from '../core/selectors';
import type { GameState } from '../core/state';

export type FxKind = 'pollen' | 'smog' | 'leaf' | 'spark' | 'drop' | 'acid' | 'petal' | 'butterfly' | 'bird' | 'glint' | 'rain' | 'mote';
export type BurstKind = 'leaf' | 'spark' | 'drop' | 'acid';
export type WeatherKind = 'acidRain' | 'sunny' | 'pollinators' | 'caravan';

export interface Particle {
  kind: FxKind;
  /** Position and velocity in tile units (per second). */
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since the particle appeared; negative while it waits to start. */
  age: number;
  life: number;
  /** Edge length in art pixels (1 art pixel = 1/16 tile). */
  size: number;
  color: string;
  phase: number;
  /** Home of a fluttering butterfly (tile units); unset for travellers. */
  hx?: number;
  /** Home height of a butterfly, or the flight line of a bird or travelling butterfly. */
  hy?: number;
}

/** A resolution wave (R-11.17): a square outline over the Chebyshev area it affects. */
export interface Pulse {
  kind: 'clean' | 'emit';
  x: number;
  y: number;
  radius: number;
  age: number;
  life: number;
}

/** A full-map color wash for weather. */
export interface Tint {
  color: string;
  alpha: number;
  age: number;
  life: number;
}

export interface AmbientSources {
  restored: { x: number; y: number }[];
  stacks: { x: number; y: number }[];
  /** Mature shrubs and trees: homes for butterflies. */
  blossoms?: { x: number; y: number }[];
  /** Clean water tiles: glints. */
  cleanWater?: { x: number; y: number }[];
  /** Progress has reached BIRD_PROGRESS: birds cross the valley. */
  birds?: boolean;
  width?: number;
  height?: number;
}

export interface WeatherOptions {
  width: number;
  height: number;
  /** Tiles hit by acid rain. */
  tiles?: { x: number; y: number }[];
  /** The Sanctuary, where caravan gold arrives. */
  at?: { x: number; y: number };
}

export const FX_MAX = 300;
export const POLLEN_MAX = 36;
export const BUTTERFLY_MAX = 10;
export const GLINT_MAX = 6;
export const PULSE_MAX = 40;
export const PULSE_LIFE = 0.7;
/** Emission waves start after the cleansing waves: cleansing comes first (R-6.6). */
export const EMIT_DELAY = 0.35;
export const RAIN_DROPS = 90;
export const ACID_SPLASH = 5;
export const SUN_MOTES = 40;
export const SWARM = 14;
export const BIRD_PROGRESS = 0.25;
const SMOG_PER_STACK = 8;
const SMOG_INTERVAL = 0.26;

/** Spring Blossom motes: warm cream, soft pink, fresh green, sun yellow. */
const POLLEN_COLORS = ['#fff3c4', '#f9c8d8', '#d8f5a2', '#ffe27a'];
/** Light, cool greys so the plume reads against dark toxic ground. */
const SMOG_COLORS = ['#8f8ca3', '#a9a6ba', '#c4c1d3'];
const PETAL_COLORS = ['#f29bb6', '#f9c8d8', '#fff3c4', '#a5d65a', '#ffe27a'];
const BUTTERFLY_COLORS = ['#f29bb6', '#fff3c4', '#ffe27a', '#f4f1de', '#c9f1ff'];
const BIRD_COLORS = ['#2b2a3e', '#3b3657'];
const RAIN_COLORS = ['#b8d65a', '#9be34a', '#d6e27a'];
const SUN_COLORS = ['#ffe27a', '#fff3c4', '#f2c14e'];
const BURSTS: Record<BurstKind, { colors: string[]; count: number; speed: number; lift: number; gravity: number; life: number }> = {
  leaf: { colors: ['#58a84b', '#a5d65a', '#f29bb6', '#fff3c4'], count: 12, speed: 1.3, lift: 1.1, gravity: 2.2, life: 1.1 },
  spark: { colors: ['#f2c14e', '#ffe27a', '#f4f1de'], count: 9, speed: 1.1, lift: 1.4, gravity: 2.6, life: 0.8 },
  drop: { colors: ['#6ec3e8', '#38c7b8', '#c9f1ff'], count: 9, speed: 0.9, lift: 0.9, gravity: 3, life: 0.8 },
  acid: { colors: ['#b8d65a', '#9be34a', '#7a3e8e'], count: ACID_SPLASH, speed: 0.8, lift: 0.8, gravity: 3, life: 0.7 },
};

/** Fade in quickly, hold, and fade out over the last 35 % of life. */
export function fxAlpha(p: Particle): number {
  const fadeIn = Math.min(1, p.age / 0.25);
  const fadeOut = Math.min(1, (p.life - p.age) / (p.life * 0.35));
  return Math.max(0, Math.min(1, fadeIn, fadeOut));
}

export function pulseProgress(p: Pulse): number {
  return Math.max(0, Math.min(1, p.age / p.life));
}

/** Half-size of the wave in tiles: from the tile (½) out to its full radius (radius + ½). */
export function pulseRadius(p: Pulse): number {
  const t = pulseProgress(p);
  return 0.5 + p.radius * (1 - (1 - t) ** 2);
}

export function pulseAlpha(p: Pulse): number {
  if (p.age < 0) return 0;
  return Math.max(0, Math.min(1, 1 - p.age / p.life));
}

/** Fades in over 0.2 s and out over the second half of its life; never above `alpha`. */
export function tintAlpha(t: Tint): number {
  const fadeIn = Math.min(1, t.age / 0.2);
  const fadeOut = Math.min(1, (t.life - t.age) / (t.life * 0.5));
  return t.alpha * Math.max(0, Math.min(fadeIn, fadeOut));
}

/** Everything the ambient layer needs, read from the ECS world. */
export function sourcesFromState(s: GameState): AmbientSources {
  const restored: AmbientSources['restored'] = [];
  const stacks: AmbientSources['stacks'] = [];
  const cleanWater: { x: number; y: number }[] = [];
  s.tiles.forEach((e, i) => {
    const x = i % s.width;
    const y = Math.floor(i / s.width);
    if (must(s.world, e, 'EcoValue').restored) restored.push({ x, y });
    if (get(s.world, e, 'ToxicSource')?.sealed === false) stacks.push({ x, y });
    if (must(s.world, e, 'Terrain').kind === 'water' && must(s.world, e, 'PollutionLevel').value === 0) cleanWater.push({ x, y });
  });
  const blossoms: { x: number; y: number }[] = [];
  for (const e of query(s.world, 'Flora', 'GridPosition')) {
    const f = must(s.world, e, 'Flora');
    if (!f.mature || f.species === 'grass') continue;
    const { x, y } = must(s.world, e, 'GridPosition');
    blossoms.push({ x, y });
  }
  return { restored, stacks, blossoms, cleanWater, birds: worldProgress(s) >= BIRD_PROGRESS, width: s.width, height: s.height };
}

export class FxSim {
  particles: Particle[] = [];
  pulses: Pulse[] = [];
  tint: Tint | null = null;
  private sources: AmbientSources = { restored: [], stacks: [] };
  private smogClock = 0;
  /** Seconds until the next flock; negative while birds are off. */
  private birdClock = -1;

  constructor(
    private readonly rand: () => number = Math.random,
    readonly max: number = FX_MAX,
  ) {}

  /** How many pollen motes should drift over the current restored area. */
  static pollenTarget(restoredTiles: number): number {
    return Math.min(POLLEN_MAX, Math.floor(restoredTiles / 3));
  }

  static butterflyTarget(blossoms: number): number {
    return Math.min(BUTTERFLY_MAX, Math.floor(blossoms / 2));
  }

  static glintTarget(cleanWaterTiles: number): number {
    return Math.min(GLINT_MAX, Math.floor(cleanWaterTiles / 4));
  }

  setSources(src: AmbientSources): void {
    this.sources = src;
  }

  /** True while anything is (or will keep) moving. */
  active(): boolean {
    const s = this.sources;
    return (
      this.particles.length > 0 ||
      this.pulses.length > 0 ||
      this.tint !== null ||
      s.stacks.length > 0 ||
      FxSim.pollenTarget(s.restored.length) > 0 ||
      FxSim.butterflyTarget(s.blossoms?.length ?? 0) > 0 ||
      FxSim.glintTarget(s.cleanWater?.length ?? 0) > 0 ||
      s.birds === true
    );
  }

  burst(kind: BurstKind, tx: number, ty: number, count = BURSTS[kind].count, delay = 0): void {
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
        age: -delay,
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

  /** Random events made visible (R-11.16). */
  weather(kind: WeatherKind, o: WeatherOptions): void {
    const { width: w, height: h } = o;
    switch (kind) {
      case 'acidRain':
        for (let i = 0; i < RAIN_DROPS; i++) {
          this.push({
            kind: 'rain',
            x: this.rand() * (w + 3) - 3,
            y: -0.5 - this.rand(),
            vx: 2,
            vy: 10,
            age: -this.rand() * 1.2,
            life: (h + 2) / 10 + 0.2,
            size: 1,
            color: this.pick(RAIN_COLORS),
            phase: 0,
          });
        }
        for (const t of o.tiles ?? []) this.burst('acid', t.x, t.y, ACID_SPLASH, 0.5 + this.rand() * 0.5);
        this.tint = { color: '#3b2a4a', alpha: 0.25, age: 0, life: 2.4 };
        break;
      case 'sunny':
        for (let i = 0; i < SUN_MOTES; i++) {
          this.push({
            kind: 'mote',
            x: this.rand() * w,
            y: 0.5 + this.rand() * (h - 1),
            vx: (this.rand() - 0.5) * 0.1,
            vy: -0.25 - this.rand() * 0.3,
            age: -this.rand() * 0.8,
            life: 2 + this.rand() * 1.2,
            size: this.rand() < 0.25 ? 2 : 1,
            color: this.pick(SUN_COLORS),
            phase: this.rand() * Math.PI * 2,
          });
        }
        this.tint = { color: '#ffd98a', alpha: 0.16, age: 0, life: 2.4 };
        break;
      case 'pollinators':
        for (let i = 0; i < SWARM; i++) {
          const x = -1 - this.rand() * 3;
          const vx = 1.2 + this.rand() * 0.6;
          this.push({
            kind: 'butterfly',
            x,
            y: 0,
            vx,
            vy: 0,
            age: 0,
            life: (w + 1 - x) / vx,
            size: 1,
            color: this.pick(BUTTERFLY_COLORS),
            phase: this.rand() * Math.PI * 2,
            hy: 0.5 + this.rand() * (h - 1),
          });
        }
        break;
      case 'caravan':
        if (o.at) for (let k = 0; k < 3; k++) this.burst('spark', o.at.x, o.at.y, 6, k * 0.25);
        break;
    }
  }

  /** A resolution wave from a tile out to `radius` (R-11.17). */
  pulse(kind: Pulse['kind'], x: number, y: number, radius: number, delay = 0): void {
    if (this.pulses.length >= PULSE_MAX) return;
    this.pulses.push({ kind, x, y, radius, age: -delay, life: PULSE_LIFE });
  }

  step(dt: number): void {
    const h = Math.max(0, Math.min(dt, 0.1));
    for (const p of this.particles) {
      p.age += h;
      if (p.age < 0) continue; // still waiting to appear
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
        case 'butterfly':
          if (p.hx === undefined) {
            p.x += p.vx * h;
            p.y = p.hy! + Math.sin(p.age * 2.6 + p.phase) * 0.45;
          } else {
            p.x = p.hx + Math.sin(p.age * 1.9 + p.phase) * 0.85;
            p.y = p.hy! + Math.sin(p.age * 2.9 + p.phase * 1.7) * 0.45;
          }
          break;
        case 'bird':
          p.x += p.vx * h;
          p.y = p.hy! + Math.sin(p.age * 3 + p.phase) * 0.12;
          break;
        case 'rain':
          p.x += p.vx * h;
          p.y += p.vy * h;
          break;
        case 'mote':
          p.x += (p.vx + Math.sin(p.age * 2 + p.phase) * 0.05) * h;
          p.y += p.vy * h;
          break;
        case 'glint':
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
    for (const p of this.pulses) p.age += h;
    this.pulses = this.pulses.filter((p) => p.age < p.life);
    if (this.tint) {
      this.tint.age += h;
      if (this.tint.age >= this.tint.life) this.tint = null;
    }
    this.spawnAmbient(h);
  }

  private spawnAmbient(h: number): void {
    const { restored, stacks } = this.sources;
    const blossoms = this.sources.blossoms ?? [];
    const water = this.sources.cleanWater ?? [];
    let pollen = 0;
    let smog = 0;
    let butterflies = 0;
    let glints = 0;
    for (const p of this.particles) {
      if (p.kind === 'pollen') pollen++;
      else if (p.kind === 'smog') smog++;
      else if (p.kind === 'butterfly' && p.hx !== undefined) butterflies++;
      else if (p.kind === 'glint') glints++;
    }
    // Trickle ambient particles in so a freshly loaded map does not "pop".
    const trickle = Math.ceil(h * 8);
    const pollenTarget = FxSim.pollenTarget(restored.length);
    for (let budget = trickle; budget > 0 && pollen < pollenTarget; budget--, pollen++) {
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
    const butterflyTarget = FxSim.butterflyTarget(blossoms.length);
    for (let budget = trickle; budget > 0 && butterflies < butterflyTarget; budget--, butterflies++) {
      const t = blossoms[Math.floor(this.rand() * blossoms.length)]!;
      const hx = t.x + 0.5;
      const hy = t.y + 0.35;
      this.push({ kind: 'butterfly', x: hx, y: hy, vx: 0, vy: 0, age: 0, life: 6 + this.rand() * 4, size: 1, color: this.pick(BUTTERFLY_COLORS), phase: this.rand() * Math.PI * 2, hx, hy });
    }
    const glintTarget = FxSim.glintTarget(water.length);
    for (let budget = trickle; budget > 0 && glints < glintTarget; budget--, glints++) {
      const t = water[Math.floor(this.rand() * water.length)]!;
      this.push({ kind: 'glint', x: t.x + 0.2 + this.rand() * 0.6, y: t.y + 0.2 + this.rand() * 0.6, vx: 0, vy: 0, age: 0, life: 0.5 + this.rand() * 0.6, size: 1, color: '#e8fbff', phase: 0 });
    }
    this.spawnBirds(h);
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

  /** A flock of 1–3 birds every 8–16 s once the land has healed enough (R-11.15). */
  private spawnBirds(h: number): void {
    const { birds, width, height } = this.sources;
    if (!birds || !width || !height) {
      this.birdClock = -1;
      return;
    }
    if (this.birdClock < 0) this.birdClock = 2 + this.rand() * 4;
    this.birdClock -= h;
    if (this.birdClock > 0) return;
    this.birdClock = 8 + this.rand() * 8;
    const n = 1 + Math.floor(this.rand() * 3);
    const dir = this.rand() < 0.5 ? 1 : -1;
    const speed = 1.4 + this.rand() * 0.6;
    const line = 0.5 + this.rand() * (height * 0.6 - 1);
    const color = this.pick(BIRD_COLORS);
    for (let i = 0; i < n; i++) {
      const lag = i * 0.6;
      this.push({
        kind: 'bird',
        x: dir > 0 ? -1 - lag : width + 1 + lag,
        y: line,
        vx: dir * speed,
        vy: 0,
        age: 0,
        life: (width + 3 + lag) / speed,
        size: 1,
        color,
        phase: this.rand() * Math.PI * 2,
        hy: line + (i % 2) * 0.35,
      });
    }
  }

  private push(p: Particle): void {
    if (this.particles.length < this.max) this.particles.push(p);
  }

  private pick<T>(list: readonly T[]): T {
    return list[Math.floor(this.rand() * list.length)]!;
  }
}

/** Small sprites in art pixels around the particle: [dx, dy, part] with part 0 = color, 1 = body. */
type Pixels = readonly (readonly [number, number, 0 | 1])[];
const BUTTERFLY_OPEN: Pixels = [
  [-1, -1, 0],
  [1, -1, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [1, 0, 0],
];
const BUTTERFLY_SHUT: Pixels = [
  [0, -1, 0],
  [0, 0, 1],
];
const BIRD_UP: Pixels = [
  [-2, -1, 0],
  [2, -1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [0, 1, 0],
];
const BIRD_DOWN: Pixels = [
  [0, -1, 0],
  [-1, 0, 0],
  [1, 0, 0],
  [-2, 1, 0],
  [2, 1, 0],
];
const BODY = '#3b3657';

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
    this.sim.pulses = [];
    this.sim.tint = null;
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

  weather(kind: WeatherKind, opts: WeatherOptions): void {
    if (!this.enabled) return;
    this.sim.weather(kind, opts);
    this.wake();
  }

  pulse(kind: Pulse['kind'], x: number, y: number, radius: number, delay?: number): void {
    if (!this.enabled) return;
    this.sim.pulse(kind, x, y, radius, delay);
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
    const tint = this.sim.tint;
    if (tint) {
      ctx.globalAlpha = tintAlpha(tint);
      ctx.fillStyle = tint.color;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    }
    for (const p of this.sim.pulses) this.paintPulse(p);
    for (const p of this.sim.particles) {
      const a = fxAlpha(p);
      if (a <= 0) continue;
      // Snap to the art-pixel grid so particles read as pixel art, not blur.
      const cx = Math.round((p.x * tilePx) / unit) * unit;
      const cy = Math.round((p.y * tilePx) / unit) * unit;
      ctx.globalAlpha = p.kind === 'smog' ? a * 0.75 : p.kind === 'rain' ? a * 0.9 : a;
      ctx.fillStyle = p.color;
      switch (p.kind) {
        case 'butterfly':
          this.pixels(cx, cy, Math.floor(p.age / 0.12) % 2 === 0 ? BUTTERFLY_OPEN : BUTTERFLY_SHUT, p.color);
          break;
        case 'bird':
          this.pixels(cx, cy, Math.floor(p.age / 0.2) % 2 === 0 ? BIRD_UP : BIRD_DOWN, p.color);
          break;
        case 'rain':
          ctx.fillRect(cx, cy - 3 * unit, unit, 4 * unit);
          break;
        case 'glint':
          ctx.fillRect(cx, cy, unit, unit);
          if (a > 0.6) {
            ctx.globalAlpha = a * 0.55;
            ctx.fillRect(cx - unit, cy, unit, unit);
            ctx.fillRect(cx + unit, cy, unit, unit);
            ctx.fillRect(cx, cy - unit, unit, unit);
            ctx.fillRect(cx, cy + unit, unit, unit);
          }
          break;
        default: {
          const size = Math.max(1, Math.round(p.size)) * unit;
          ctx.fillRect(cx - Math.floor(size / 2), cy - Math.floor(size / 2), size, size);
        }
      }
    }
    ctx.globalAlpha = 1;
  }

  private pixels(cx: number, cy: number, pattern: Pixels, color: string): void {
    const { ctx, unit } = this;
    for (const [dx, dy, part] of pattern) {
      ctx.fillStyle = part === 1 ? BODY : color;
      ctx.fillRect(cx + dx * unit, cy + dy * unit, unit, unit);
    }
  }

  /** A square outline of the Chebyshev area the mechanic affects: solid = cleansing, dashed = emission. */
  private paintPulse(p: Pulse): void {
    const a = pulseAlpha(p);
    if (a <= 0) return;
    const { ctx, unit, tilePx } = this;
    const half = Math.round((pulseRadius(p) * tilePx) / unit) * unit;
    const cx = (p.x + 0.5) * tilePx;
    const cy = (p.y + 0.5) * tilePx;
    const color = p.kind === 'clean' ? '#7fd8ff' : '#ff9d8a';
    ctx.globalAlpha = a * 0.12;
    ctx.fillStyle = color;
    ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    ctx.globalAlpha = a;
    ctx.strokeStyle = color;
    ctx.lineWidth = unit;
    ctx.setLineDash(p.kind === 'emit' ? [unit * 2, unit * 2] : []);
    ctx.strokeRect(cx - half + unit / 2, cy - half + unit / 2, half * 2 - unit, half * 2 - unit);
    ctx.setLineDash([]);
  }
}
