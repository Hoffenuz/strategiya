import { describe, expect, it } from 'vitest';
import { allTileInfo, previewSprite, tileInfo, toolGroup, TOOLS } from '../src/core/selectors';
import { createGame } from '../src/core/state';
import { SPRITES, SPRITE_COLORS } from '../src/render/sprites';
import { runBot } from '../src/core/sim/bot';

describe('tool palette groups (R-2.7)', () => {
  it('orders tools as contiguous groups: restore, plant, build, manage', () => {
    const groups = TOOLS.map(toolGroup);
    const order = groups.filter((g, i) => g !== groups[i - 1]);
    expect(order).toEqual(['restore', 'plant', 'build', 'manage']);
  });
});

describe('placement preview (R-11.8)', () => {
  it('previews the building or seedling a tool would place, and nothing for other tools', () => {
    for (const tool of TOOLS) {
      const sprite = previewSprite(tool);
      if (tool.kind === 'build') expect(sprite).toBe(tool.building);
      else if (tool.kind === 'plant') expect(sprite).toBe(`${tool.species}0`);
      else expect(sprite).toBeNull();
      if (sprite) expect(SPRITES[sprite], sprite).toBeDefined();
    }
  });
});

describe('allTileInfo', () => {
  it('matches tileInfo for every tile, early and late in a game', () => {
    const early = createGame(11, 'balanced');
    const late = runBot(11, 'balanced', 'greedy', 25).state;
    for (const s of [early, late]) {
      const all = allTileInfo(s);
      expect(all).toHaveLength(s.width * s.height);
      for (let y = 0; y < s.height; y++) for (let x = 0; x < s.width; x++) expect(all[y * s.width + x]).toEqual(tileInfo(s, x, y));
    }
  });
});

describe('pixel sprites (R-11.1)', () => {
  it('every sprite is rectangular and uses only palette roles', () => {
    for (const [name, rows] of Object.entries(SPRITES)) {
      const width = rows[0]!.length;
      for (const row of rows) {
        expect(row.length, name).toBe(width);
        for (const ch of row) if (ch !== '.') expect(SPRITE_COLORS[ch], `${name} uses '${ch}'`).toBeDefined();
      }
    }
  });

  it('ships the HUD and preview sprites', () => {
    for (const name of ['hourglass', 'sprout', 'smog', 'okBadge', 'noBadge']) expect(SPRITES[name], name).toBeDefined();
  });
});
