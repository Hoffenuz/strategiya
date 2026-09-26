import { describe, expect, it } from 'vitest';
import { SPRITES, SPRITE_COLORS } from '../src/render/sprites';
import { paletteFor, KEYFRAMES } from '../src/render/palette';
import { hex, shade, rgbToHsl } from '../src/render/color';
import { DEFAULT_KEYS, defaultSettings, parseSettings, rebind, actionForCode, keyLabel } from '../src/ui/settings';
import { parseAchievements, unlockedBy } from '../src/ui/achievements';
import { createGame } from '../src/core/state';
import { TOOLS } from '../src/core/selectors';

describe('sprites and palette (T6.1, T6.2)', () => {
  it('every sprite is rectangular and uses only known colors', () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      const w = rows[0]!.length;
      for (const r of rows) {
        expect(r.length, name).toBe(w);
        for (const ch of r) if (ch !== '.') expect(SPRITE_COLORS[ch], `${name}:${ch}`).toBeDefined();
      }
    }
  });

  it('every tool and building has an icon sprite', () => {
    for (const n of ['sanctuary', 'solar', 'wind', 'scrubber', 'purifier', 'recycler', 'battery', 'sealer', 'grass', 'shrub', 'tree', 'grass0', 'shrub0', 'tree0', 'salvage', 'hand', 'up', 'toggle', 'remove', 'coin', 'bolt', 'leaf', 'zz', 'pause'])
      expect(SPRITES[n], n).toBeDefined();
    expect(TOOLS.length).toBe(15);
  });

  it('palette hits the keyframes exactly and blends between them', () => {
    for (const k of KEYFRAMES) expect(paletteFor(k.at)).toEqual(k.palette);
    const mid = paletteFor(0.175);
    expect(mid.soilClean).not.toBe(KEYFRAMES[0].palette.soilClean);
    expect(paletteFor(-1)).toEqual(KEYFRAMES[0].palette);
    expect(paletteFor(2)).toEqual(KEYFRAMES[2].palette);
  });

  it('hue shifting moves shadows toward blue and highlights toward yellow', () => {
    const base = hex('#58a84b'); // green, hue ≈ 113
    const [hBase] = rgbToHsl(base);
    const [hDark] = rgbToHsl(shade(base, -0.4));
    const [hLight] = rgbToHsl(shade(base, 0.4));
    expect(hDark).toBeGreaterThan(hBase);
    expect(hLight).toBeLessThan(hBase);
  });
});

describe('settings (T6.4)', () => {
  it('rejects conflicting and reserved bindings, accepts free ones', () => {
    expect(rebind(DEFAULT_KEYS, 'endTurn', 'KeyZ')).toEqual({ ok: false, conflict: 'undo' });
    expect(rebind(DEFAULT_KEYS, 'endTurn', 'Digit3')).toEqual({ ok: false, conflict: 'reserved' });
    const r = rebind(DEFAULT_KEYS, 'endTurn', 'KeyN');
    expect(r.ok && r.keys.endTurn).toBe('KeyN');
    expect(rebind(DEFAULT_KEYS, 'endTurn', 'KeyE').ok).toBe(true);
    expect(actionForCode(DEFAULT_KEYS, 'ArrowUp')).toBe('up');
    expect(keyLabel('KeyE')).toBe('E');
    expect(keyLabel('ArrowLeft')).toBe('←');
  });

  it('parses stored settings defensively', () => {
    const d = defaultSettings(true, 'uz');
    expect(parseSettings(null, d)).toEqual(d);
    expect(parseSettings('{{broken', d)).toEqual(d);
    const p = parseSettings(JSON.stringify({ lang: 'en', scale: 1.5, sound: false, scaleX: 9, keys: { up: 'KeyW' } }), d);
    expect(p).toMatchObject({ lang: 'en', scale: 1.5, sound: false, reducedMotion: true });
    expect(p.keys.up).toBe('KeyW');
    expect(parseSettings(JSON.stringify({ scale: 7, lang: 'fr' }), d)).toMatchObject({ scale: 1, lang: 'uz' });
    expect(parseSettings(JSON.stringify({ keys: { up: 'KeyE' } }), d).keys).toEqual(DEFAULT_KEYS);
  });
});

describe('achievements (T6.6)', () => {
  it('unlocks from events once', () => {
    const s = createGame(1, 'hard');
    expect(unlockedBy({ type: 'flora:planted', species: 'grass', x: 0, y: 0 }, s, new Set())).toEqual(['firstSprout']);
    expect(unlockedBy({ type: 'flora:planted', species: 'grass', x: 0, y: 0 }, s, new Set(['firstSprout']))).toEqual([]);
    expect(unlockedBy({ type: 'game:won', turn: 30, score: 1 }, s, new Set())).toEqual(['revived', 'hardWin']);
    expect(unlockedBy({ type: 'building:placed', building: 'wind', x: 0, y: 0 }, s, new Set())).toEqual([]);
  });

  it('parses stored ids defensively', () => {
    expect([...parseAchievements('["firstSprout","bogus"]')]).toEqual(['firstSprout']);
    expect(parseAchievements('nope').size).toBe(0);
    expect(parseAchievements(null).size).toBe(0);
  });
});
