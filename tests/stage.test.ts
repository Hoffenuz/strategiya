import { describe, expect, it } from 'vitest';
import { DIFFICULTIES, SPECIES_LIST } from '../src/core/config';
import { must } from '../src/core/ecs/world';
import { floraSprite, floraStage, STAGE_AT, tileInfo, worldProgress, worldStage, type FloraStage } from '../src/core/selectors';
import { createGame } from '../src/core/state';
import { spawnFlora } from '../src/core/systems/growth';
import { restorationSummary } from '../src/core/systems/restorable';
import { KEYFRAMES, paletteFor } from '../src/render/palette';
import { SPRITES } from '../src/render/sprites';
import { emptyRecords, parseRecords, recordGame } from '../src/ui/records';
import { blankGame, setTile } from './helpers';

describe('world stage (T10.9, R-11.2, R-11.12)', () => {
  it('progress is the restoration ratio over the win ratio, clamped to [0, 1]', () => {
    const s = createGame(1, 'balanced');
    expect(worldProgress(s)).toBe(0);
    let flagged = 0;
    for (const e of s.tiles) {
      if (flagged >= 40) break;
      const kind = must(s.world, e, 'Terrain').kind;
      if (kind === 'rock' || kind === 'stack') continue;
      must(s.world, e, 'EcoValue').restored = true;
      flagged++;
    }
    const { ratio } = restorationSummary(s);
    expect(worldProgress(s)).toBeCloseTo(Math.min(1, ratio / DIFFICULTIES.balanced.winRatio), 12);
    for (const e of s.tiles) must(s.world, e, 'EcoValue').restored = true;
    expect(worldProgress(s)).toBe(1);
  });

  it('switches stage at 0.45 and at 0.9', () => {
    expect(STAGE_AT).toEqual({ transition: 0.45, revival: 0.9 });
    const cases: [number, string][] = [
      [0, 'collapse'],
      [0.449, 'collapse'],
      [0.45, 'transition'],
      [0.899, 'transition'],
      [0.9, 'revival'],
      [1, 'revival'],
    ];
    for (const [p, stage] of cases) expect(worldStage(p), String(p)).toBe(stage);
  });

  it('puts the palette keyframes on the stage thresholds, so a won game is fully in Spring', () => {
    expect(KEYFRAMES.map((k) => k.at)).toEqual([0, STAGE_AT.transition, STAGE_AT.revival]);
    expect(paletteFor(1)).toEqual(KEYFRAMES[2].palette);
    expect(paletteFor(STAGE_AT.revival)).toEqual(KEYFRAMES[2].palette);
  });
});

describe('growth stages (T10.9, R-11.13)', () => {
  it('is a seedling below a third of its growth time, then young until mature', () => {
    const cases: [number, number, boolean, FloraStage][] = [
      [0, 2, false, 'seedling'],
      [1, 2, false, 'young'],
      [0, 3, false, 'seedling'],
      [1, 3, false, 'young'],
      [1, 5, false, 'seedling'],
      [2, 5, false, 'young'],
      [4, 5, false, 'young'],
      [5, 5, true, 'mature'],
    ];
    for (const [growth, maturation, mature, stage] of cases) expect(floraStage({ growth, maturation, mature }), `${growth}/${maturation}`).toBe(stage);
  });

  it('has a sprite for every species in every stage', () => {
    for (const species of SPECIES_LIST)
      for (const stage of ['seedling', 'young', 'mature'] as const) {
        const name = floraSprite(species, stage);
        expect(SPRITES[name], name).toBeDefined();
      }
    expect(floraSprite('tree', 'seedling')).toBe('tree0');
    expect(floraSprite('tree', 'young')).toBe('tree1');
    expect(floraSprite('tree', 'mature')).toBe('tree');
  });

  it('tells the stage and the turns left, counting double growth beside clean water', () => {
    const s = blankGame('balanced', 7);
    const e = spawnFlora(s, 'tree', 8, 8);
    expect(tileInfo(s, 8, 8)!.flora).toMatchObject({ stage: 'seedling', turnsLeft: 5 });
    setTile(s, 8, 9, 'water', 0);
    expect(tileInfo(s, 8, 8)!.flora!.turnsLeft).toBe(3);
    must(s.world, e, 'Flora').growth = 4;
    expect(tileInfo(s, 8, 8)!.flora).toMatchObject({ stage: 'young', turnsLeft: 1 });
    setTile(s, 8, 9, 'water', 5); // polluted water does not help
    expect(tileInfo(s, 8, 8)!.flora!.turnsLeft).toBe(1);
    must(s.world, e, 'Flora').growth = 5;
    must(s.world, e, 'Flora').mature = true;
    expect(tileInfo(s, 8, 8)!.flora).toMatchObject({ stage: 'mature', turnsLeft: 0 });
  });
});

describe('local records (T10.9, R-10.7)', () => {
  const win = (turn: number, score: number) => ({ result: 'victory' as const, reason: 'restored' as const, turn, score });
  const loss = { result: 'defeat' as const, reason: 'time' as const, turn: 60, score: 300 };

  it('counts games and wins and keeps the best win', () => {
    let r = emptyRecords();
    expect(r.balanced).toEqual({ played: 0, wins: 0, bestScore: null, fewestTurns: null });
    let u = recordGame(r, 'balanced', loss);
    expect(u).toMatchObject({ bestScore: false, fewestTurns: false });
    expect(u.records.balanced).toEqual({ played: 1, wins: 0, bestScore: null, fewestTurns: null });
    u = recordGame(u.records, 'balanced', win(44, 1200));
    expect(u).toMatchObject({ bestScore: true, fewestTurns: true });
    u = recordGame(u.records, 'balanced', win(40, 1100));
    expect(u).toMatchObject({ bestScore: false, fewestTurns: true });
    u = recordGame(u.records, 'balanced', win(50, 1300));
    expect(u).toMatchObject({ bestScore: true, fewestTurns: false });
    r = u.records;
    expect(r.balanced).toEqual({ played: 4, wins: 3, bestScore: 1300, fewestTurns: 40 });
    expect(r.gentle).toEqual(emptyRecords().gentle);
  });

  it('never mutates its input', () => {
    const r = emptyRecords();
    const before = JSON.stringify(r);
    recordGame(r, 'hard', win(30, 900));
    expect(JSON.stringify(r)).toBe(before);
  });

  it('parses stored records defensively', () => {
    expect(parseRecords(null)).toEqual(emptyRecords());
    expect(parseRecords('{{nope')).toEqual(emptyRecords());
    expect(parseRecords('[]')).toEqual(emptyRecords());
    const stored = JSON.stringify({ hard: { played: 3, wins: 1, bestScore: 999, fewestTurns: 33 }, gentle: { played: 'x' }, weird: {} });
    const r = parseRecords(stored);
    expect(r.hard).toEqual({ played: 3, wins: 1, bestScore: 999, fewestTurns: 33 });
    expect(r.gentle).toEqual(emptyRecords().gentle);
    expect(Object.keys(r).sort()).toEqual(['balanced', 'gentle', 'hard']);
  });
});
