import { STAGE_AT } from '../core/selectors';
import { hex, mix, shade, toHex, type RGB } from './color';

/** World palette roles; each keyframe gives every role a color (R-11.2). */
export interface WorldPalette {
  soilClean: string;
  soilToxic: string;
  waterClean: string;
  waterToxic: string;
  rock: string;
  ruin: string;
  stack: string;
  grass: string;
  backdrop: string;
}

/** Cyberpunk Chrome: cold steel, anxious red, neon cyan, poison green. */
const CHROME: WorldPalette = {
  soilClean: '#5f6b73',
  soilToxic: '#3d2f4a',
  waterClean: '#3fb7c9',
  waterToxic: '#5e7d3a',
  rock: '#6f7a86',
  ruin: '#8b3b3b',
  stack: '#4a4458',
  grass: '#63a35c',
  backdrop: '#12131c',
};

/** Autumn Harvest: burnt orange, amber, crimson, mist. */
const AUTUMN: WorldPalette = {
  soilClean: '#9b7443',
  soilToxic: '#4f3a4c',
  waterClean: '#4a9fb0',
  waterToxic: '#66703f',
  rock: '#857566',
  ruin: '#9a4a2e',
  stack: '#554552',
  grass: '#8fae4a',
  backdrop: '#1b1512',
};

/** Spring Blossom: pure green, soft pink, warm cream, clear turquoise. */
const SPRING: WorldPalette = {
  soilClean: '#6d9a4a',
  soilToxic: '#57455a',
  waterClean: '#37c1b4',
  waterToxic: '#6a7a48',
  rock: '#8e8c80',
  ruin: '#8f5a3a',
  stack: '#5d5160',
  grass: '#7fcf5a',
  backdrop: '#101a14',
};

/**
 * Keyframes sit on the world-stage thresholds of *progress toward the goal* (R-11.2), so
 * the valley reaches full Spring Blossom before every victory, on every difficulty.
 */
export const KEYFRAMES = [
  { at: 0, palette: CHROME },
  { at: STAGE_AT.transition, palette: AUTUMN },
  { at: STAGE_AT.revival, palette: SPRING },
] as const;

function blend(a: WorldPalette, b: WorldPalette, t: number): WorldPalette {
  const out = {} as WorldPalette;
  for (const k of Object.keys(a) as (keyof WorldPalette)[]) out[k] = toHex(mix(hex(a[k]), hex(b[k]), t));
  return out;
}

/** Palette for a restoration ratio, interpolated between the three keyframes. */
export function paletteFor(ratio: number): WorldPalette {
  const r = Math.max(0, Math.min(1, ratio));
  for (let i = KEYFRAMES.length - 1; i >= 0; i--) {
    const k = KEYFRAMES[i]!;
    if (r >= k.at) {
      const n = KEYFRAMES[i + 1];
      if (!n) return k.palette;
      return blend(k.palette, n.palette, (r - k.at) / (n.at - k.at));
    }
  }
  return CHROME;
}

export function shadeHex(c: string, amount: number): string {
  return toHex(shade(hex(c), amount));
}

export function mixHex(a: string, b: string, t: number): string {
  return toHex(mix(hex(a), hex(b), t));
}

export type { RGB };
