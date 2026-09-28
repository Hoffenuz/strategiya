import { describe, expect, it } from 'vitest';
import { ICONS, iconPath, type IconName } from '../src/ui/icons';

/** Pixel icon set (R-13.9): icons never depend on emoji or symbol fonts. */
describe('pixel icon set', () => {
  const names = Object.keys(ICONS) as IconName[];

  it('covers every HUD glyph the interface needs', () => {
    const needed = ['undo', 'play', 'menu', 'warn', 'check', 'leaf', 'ring', 'lock', 'star', 'pause', 'dot', 'zz', 'diamond', 'arrowUp', 'arrowDown', 'arrowLeft', 'arrowRight'] as const;
    for (const name of needed) {
      expect(names).toContain(name);
    }
  });

  it('every icon is a non-empty rectangular pixel map', () => {
    for (const name of names) {
      const rows = ICONS[name];
      expect(rows.length, name).toBeGreaterThan(0);
      const width = rows[0]!.length;
      for (const row of rows) {
        expect(row.length, name).toBe(width);
        expect(/^[.#]+$/.test(row), name).toBe(true);
      }
      expect(rows.join('').includes('#'), name).toBe(true);
    }
  });

  it('the SVG path paints exactly the filled pixels, one run at a time', () => {
    for (const name of names) {
      const filled = ICONS[name].join('').split('').filter((c) => c === '#').length;
      const runs = [...iconPath(name).matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)];
      expect(runs.reduce((sum, m) => sum + Number(m[3]), 0), name).toBe(filled);
      for (const m of runs) {
        const [x, y, n] = [Number(m[1]), Number(m[2]), Number(m[3])];
        expect(ICONS[name][y]!.slice(x, x + n), name).toBe('#'.repeat(n));
      }
    }
  });
});
