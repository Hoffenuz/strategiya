import type { GameState } from '../core/state';
import { allTileInfo, pollutionBand, tileInfo, type TileInfo } from '../core/selectors';
import { restorationSummary } from '../core/systems/restorable';
import { EMISSION } from '../core/config';
import { scrubberRadius } from '../core/economy/formulas';
import { paletteFor, shadeHex, mixHex, type WorldPalette } from './palette';
import { spriteCanvas } from './sprites';

export const TILE = 16;
export const ZOOM = 3;
const PX = TILE * ZOOM;

export interface RenderOptions {
  cursor: { x: number; y: number } | null;
  /** Tiles to outline as the effect area of the selected tool or hovered building. */
  range: { x: number; y: number; r: number; kind: 'clean' | 'emit' } | null;
  /**
   * Placement preview under the cursor (R-11.8): the sprite the selected tool would add
   * (if any), and whether the action is allowed there, shown by badge shape and color.
   */
  ghost: { sprite: string | null; ok: boolean } | null;
  patterns: boolean;
  reducedMotion: boolean;
  highContrast: boolean;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  color: string;
  born: number;
}

/** Deterministic per-tile hash for texture variation. */
function hash(x: number, y: number, salt = 0): number {
  let h = (x * 374761393 + y * 668265263 + salt * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Canvas renderer (design §7). Redraws only when asked; ambient animation ticks slowly. */
export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private textures = new Map<string, HTMLCanvasElement>();
  private floaters: Floater[] = [];
  private frame = 0;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.canvas = canvas;
    canvas.width = width * PX;
    canvas.height = height * PX;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    ctx.imageSmoothingEnabled = false;
  }

  /** Converts a pointer position (client coords) to a tile coordinate. */
  tileFromPoint(clientX: number, clientY: number): { x: number; y: number } | null {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width === 0) return null;
    const x = Math.floor(((clientX - rect.left) / rect.width) * (this.canvas.width / PX));
    const y = Math.floor(((clientY - rect.top) / rect.height) * (this.canvas.height / PX));
    if (x < 0 || y < 0 || x >= this.canvas.width / PX || y >= this.canvas.height / PX) return null;
    return { x, y };
  }

  addFloater(x: number, y: number, text: string, color: string): void {
    this.floaters.push({ x, y, text, color, born: performance.now() });
    if (this.floaters.length > 24) this.floaters.shift();
  }

  hasFloaters(): boolean {
    return this.floaters.length > 0;
  }

  tick(): void {
    this.frame++;
  }

  draw(s: GameState, opts: RenderOptions): void {
    const ctx = this.ctx;
    const ratio = restorationSummary(s).ratio;
    const pal = paletteFor(Math.round(ratio * 20) / 20);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = pal.backdrop;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const anim = opts.reducedMotion ? 0 : this.frame;

    for (const info of allTileInfo(s)) this.drawTile(info, pal, anim, opts);

    if (opts.range) this.drawRange(s, opts.range);
    if (opts.cursor && opts.ghost) this.drawGhost(opts.cursor.x, opts.cursor.y, opts.ghost);
    if (opts.cursor) this.drawCursor(opts.cursor.x, opts.cursor.y, anim, opts.highContrast);
    this.drawFloaters(opts.reducedMotion);
  }

  /** Translucent preview of what the tool would place, plus a check / cross badge. */
  private drawGhost(x: number, y: number, ghost: NonNullable<RenderOptions['ghost']>): void {
    const ctx = this.ctx;
    const dx = x * PX;
    const dy = y * PX;
    if (ghost.sprite && ghost.ok) {
      ctx.globalAlpha = 0.6;
      ctx.drawImage(spriteCanvas(ghost.sprite), dx, dy, PX, PX);
      ctx.globalAlpha = 1;
    }
    const badge = spriteCanvas(ghost.ok ? 'okBadge' : 'noBadge');
    ctx.drawImage(badge, dx + ZOOM, dy + PX - (badge.height + 1) * ZOOM, badge.width * ZOOM, badge.height * ZOOM);
  }

  private texture(key: string, build: (c: CanvasRenderingContext2D) => void): HTMLCanvasElement {
    let c = this.textures.get(key);
    if (!c) {
      c = document.createElement('canvas');
      c.width = TILE;
      c.height = TILE;
      build(c.getContext('2d')!);
      this.textures.set(key, c);
      if (this.textures.size > 4000) this.textures.clear();
    }
    return c;
  }

  private groundTexture(info: TileInfo, pal: WorldPalette, anim: number): HTMLCanvasElement {
    const variant = Math.floor(hash(info.x, info.y) * 4);
    const bucket = Math.round(info.pollution / 10);
    const kind = info.terrain === 'ruin' || info.terrain === 'stack' ? 'soil' : info.terrain;
    const wave = kind === 'water' ? Math.floor(anim / 2) % 4 : 0;
    const key = `${kind}|${bucket}|${variant}|${wave}|${pal.soilClean}|${pal.waterClean}`;
    return this.texture(key, (c) => {
      const t = bucket / 10;
      if (kind === 'rock') {
        const base = pal.rock;
        c.fillStyle = shadeHex(base, -0.25);
        c.fillRect(0, 0, TILE, TILE);
        const blocks = [
          [1, 2, 7, 6],
          [8, 1, 7, 7],
          [2, 9, 6, 6],
          [9, 9, 6, 6],
        ];
        for (const [bx, by, bw, bh] of blocks) {
          c.fillStyle = base;
          c.fillRect(bx!, by!, bw!, bh!);
          c.fillStyle = shadeHex(base, 0.25);
          c.fillRect(bx!, by!, bw!, 1);
          c.fillRect(bx!, by!, 1, bh!);
          c.fillStyle = shadeHex(base, -0.4);
          c.fillRect(bx!, by! + bh! - 1, bw!, 1);
        }
        return;
      }
      const clean = kind === 'water' ? pal.waterClean : pal.soilClean;
      const toxic = kind === 'water' ? pal.waterToxic : pal.soilToxic;
      const base = mixHex(clean, toxic, t);
      c.fillStyle = base;
      c.fillRect(0, 0, TILE, TILE);
      const dark = shadeHex(base, -0.18);
      const light = shadeHex(base, 0.14);
      for (let py = 0; py < TILE; py++)
        for (let px = 0; px < TILE; px++) {
          const h = hash(px + info.x * 16, py + info.y * 16, variant);
          if (kind === 'water') {
            if ((px + py * 3 + wave * 2) % 11 === 0 && py % 4 === (variant + wave) % 4) {
              c.fillStyle = light;
              c.fillRect(px, py, 2, 1);
            }
            continue;
          }
          if (h < 0.12) {
            c.fillStyle = dark;
            c.fillRect(px, py, 1, 1);
          } else if (h > 0.93) {
            c.fillStyle = light;
            c.fillRect(px, py, 1, 1);
          } else if (t >= 0.6 && h > 0.9 && h < 0.93) {
            c.fillStyle = '#9be34a';
            c.fillRect(px, py, 1, 1);
          } else if (t === 0 && h > 0.86 && h < 0.9) {
            c.fillStyle = shadeHex(pal.grass, 0.1);
            c.fillRect(px, py, 1, 2);
          }
        }
    });
  }

  private patternTexture(band: ReturnType<typeof pollutionBand>, hc: boolean): HTMLCanvasElement | null {
    if (band === 'clean') return null;
    return this.texture(`pattern|${band}|${hc}`, (c) => {
      // Light strokes read on the dark polluted ground; dark dots on the lighter recovering ground.
      const light = hc ? 'rgba(255,255,255,0.55)' : 'rgba(236,228,255,0.30)';
      const dark = hc ? 'rgba(0,0,0,0.75)' : 'rgba(18,10,28,0.45)';
      for (let i = 0; i < TILE; i++)
        for (let j = 0; j < TILE; j++) {
          const diagA = (i + j) % 5 === 0;
          const diagB = (i - j + TILE) % 5 === 0;
          if (band === 'toxic' && (diagA || diagB)) {
            c.fillStyle = light;
            c.fillRect(i, j, 1, 1);
          } else if (band === 'polluted' && diagA) {
            c.fillStyle = light;
            c.fillRect(i, j, 1, 1);
          } else if (band === 'recovering' && i % 5 === 2 && j % 5 === 2) {
            c.fillStyle = dark;
            c.fillRect(i, j, 2, 2);
          }
        }
    });
  }

  private drawTile(info: TileInfo, pal: WorldPalette, anim: number, opts: RenderOptions): void {
    const ctx = this.ctx;
    const dx = info.x * PX;
    const dy = info.y * PX;
    ctx.drawImage(this.groundTexture(info, pal, anim), dx, dy, PX, PX);

    if (opts.patterns && info.terrain !== 'rock' && info.terrain !== 'stack') {
      const pat = this.patternTexture(info.band, opts.highContrast);
      if (pat) ctx.drawImage(pat, dx, dy, PX, PX);
    }

    if (info.terrain === 'ruin') ctx.drawImage(spriteCanvas('ruin'), dx, dy, PX, PX);
    if (info.terrain === 'stack') {
      if (info.building?.type === 'sealer') ctx.drawImage(spriteCanvas('sealer'), dx, dy, PX, PX);
      else {
        ctx.drawImage(spriteCanvas('stack'), dx, dy + (anim % 8 < 4 ? 0 : ZOOM), PX, PX);
      }
    }
    if (info.flora) {
      const name = info.flora.mature ? info.flora.species : `${info.flora.species}0`;
      ctx.drawImage(spriteCanvas(name), dx, dy, PX, PX);
    }
    if (info.building && info.building.type !== 'sealer') {
      ctx.drawImage(spriteCanvas(info.building.type), dx, dy, PX, PX);
      // Level pips (shape, not only color) for upgraded buildings: one bar per level.
      if (info.building.level >= 2) {
        for (let i = 0; i < info.building.level; i++) {
          ctx.fillStyle = '#1b1a2e';
          ctx.fillRect(dx + ZOOM + i * 4 * ZOOM, dy + ZOOM, 4 * ZOOM, 3 * ZOOM);
          ctx.fillStyle = '#f2c14e';
          ctx.fillRect(dx + 2 * ZOOM + i * 4 * ZOOM, dy + 2 * ZOOM, 2 * ZOOM, ZOOM);
        }
      }
      if (info.building.hasUpkeep && !info.building.enabled) this.glyph('pause', dx + PX - 7 * ZOOM, dy + ZOOM, '#f4f1de');
      else if (info.building.hasUpkeep && !info.building.powered) this.glyph('zz', dx + PX - 9 * ZOOM, dy + ZOOM, '#f4f1de');
    }
    if (info.restored) ctx.drawImage(spriteCanvas('leaf'), dx + PX - 5 * ZOOM, dy + PX - 5 * ZOOM, 4 * ZOOM, 4 * ZOOM);

    ctx.strokeStyle = opts.highContrast ? 'rgba(255,255,255,0.18)' : 'rgba(0,0,0,0.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(dx + 0.5, dy + 0.5, PX - 1, PX - 1);
  }

  private glyph(name: string, x: number, y: number, fill: string): void {
    const src = spriteCanvas(name, { k: fill });
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(27,26,46,0.85)';
    ctx.fillRect(x - ZOOM, y - ZOOM, (src.width + 2) * ZOOM, (src.height + 2) * ZOOM);
    ctx.drawImage(src, x, y, src.width * ZOOM, src.height * ZOOM);
  }

  private drawRange(s: GameState, r: NonNullable<RenderOptions['range']>): void {
    const ctx = this.ctx;
    const color = r.kind === 'clean' ? 'rgba(127, 216, 255, 0.28)' : 'rgba(255, 110, 90, 0.22)';
    const edge = r.kind === 'clean' ? '#7fd8ff' : '#ff9d8a';
    for (let y = r.y - r.r; y <= r.y + r.r; y++)
      for (let x = r.x - r.r; x <= r.x + r.r; x++) {
        if (x < 0 || y < 0 || x >= s.width || y >= s.height) continue;
        ctx.fillStyle = color;
        ctx.fillRect(x * PX, y * PX, PX, PX);
      }
    const x0 = Math.max(0, r.x - r.r) * PX;
    const y0 = Math.max(0, r.y - r.r) * PX;
    const x1 = Math.min(s.width, r.x + r.r + 1) * PX;
    const y1 = Math.min(s.height, r.y + r.r + 1) * PX;
    ctx.setLineDash([ZOOM * 3, ZOOM * 2]);
    ctx.strokeStyle = edge;
    ctx.lineWidth = ZOOM;
    ctx.strokeRect(x0 + ZOOM / 2, y0 + ZOOM / 2, x1 - x0 - ZOOM, y1 - y0 - ZOOM);
    ctx.setLineDash([]);
  }

  private drawCursor(x: number, y: number, anim: number, hc: boolean): void {
    const ctx = this.ctx;
    const pulse = anim % 6 < 3 ? 0 : ZOOM;
    ctx.lineWidth = ZOOM * 2;
    ctx.strokeStyle = '#000000';
    ctx.strokeRect(x * PX + ZOOM - pulse / 2, y * PX + ZOOM - pulse / 2, PX - 2 * ZOOM + pulse, PX - 2 * ZOOM + pulse);
    ctx.lineWidth = ZOOM;
    ctx.strokeStyle = hc ? '#00e5ff' : '#ffd166';
    ctx.strokeRect(x * PX + ZOOM - pulse / 2, y * PX + ZOOM - pulse / 2, PX - 2 * ZOOM + pulse, PX - 2 * ZOOM + pulse);
  }

  private drawFloaters(reducedMotion: boolean): void {
    const ctx = this.ctx;
    const now = performance.now();
    this.floaters = this.floaters.filter((f) => now - f.born < 1400);
    ctx.font = `bold ${7 * ZOOM}px ui-monospace, "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const f of this.floaters) {
      const age = (now - f.born) / 1400;
      const rise = reducedMotion ? 0 : age * PX * 0.8;
      // Keep the whole label on the canvas, even on the top row and the edges.
      const px = Math.max(PX / 2, Math.min(this.canvas.width - PX / 2, f.x * PX + PX / 2));
      const py = Math.max(5 * ZOOM, f.y * PX + PX / 3 - rise);
      ctx.globalAlpha = 1 - age * age;
      ctx.lineWidth = ZOOM * 1.5;
      ctx.strokeStyle = '#11131a';
      ctx.strokeText(f.text, px, py);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, px, py);
    }
    ctx.globalAlpha = 1;
  }
}

/** Effect-area preview for a tool on a tile, or for the building/stack under it. */
export function rangeFor(
  s: GameState,
  x: number,
  y: number,
  tool: { kind: string; building?: string } | null,
): RenderOptions['range'] {
  const info = tileInfo(s, x, y);
  if (!info) return null;
  if (tool?.kind === 'build' && tool.building === 'scrubber') return { x, y, r: 1, kind: 'clean' };
  if (tool?.kind === 'build' && tool.building === 'purifier') return { x, y, r: 1, kind: 'clean' };
  if (info.building?.type === 'scrubber') return { x, y, r: scrubberRadius(info.building.level), kind: 'clean' };
  if (info.building?.type === 'purifier') return { x, y, r: 1, kind: 'clean' };
  if (info.terrain === 'stack' && info.sealed === false) return { x, y, r: EMISSION.length, kind: 'emit' };
  return null;
}
