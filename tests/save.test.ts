import { describe, expect, it } from 'vitest';
import { deserialize, serialize } from '../src/core/save';
import { createGame } from '../src/core/state';

describe('save / load (T4.5)', () => {
  it('round-trips a fresh game', () => {
    const s = createGame(99, 'balanced');
    expect(deserialize(serialize(s))).toEqual(s);
  });

  it('returns null for corrupt, foreign or incompatible data', () => {
    const good = JSON.parse(serialize(createGame(1, 'gentle')));
    const bad = [
      'not json',
      'null',
      '[]',
      '{}',
      JSON.stringify({ ...good, version: 999 }),
      JSON.stringify({ ...good, difficulty: 'nightmare' }),
      JSON.stringify({ ...good, tiles: [] }),
      JSON.stringify({ ...good, world: null }),
      JSON.stringify({ ...good, turn: '3' }),
    ];
    for (const b of bad) expect(deserialize(b)).toBeNull();
  });
});
