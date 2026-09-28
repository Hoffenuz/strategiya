import { describe, expect, it } from 'vitest';
import { add, createEntity, createWorld, destroyEntity, get, has, isAlive, query, remove } from '../src/core/ecs/world';

describe('ECS world (T1.1)', () => {
  it('creates entities with increasing ids', () => {
    const w = createWorld();
    const a = createEntity(w);
    const b = createEntity(w);
    expect(b).toBeGreaterThan(a);
    expect(isAlive(w, a)).toBe(true);
  });

  it('adds, reads and removes components', () => {
    const w = createWorld();
    const e = createEntity(w);
    add(w, e, 'GridPosition', { x: 1, y: 2 });
    expect(get(w, e, 'GridPosition')).toEqual({ x: 1, y: 2 });
    expect(has(w, e, 'Terrain')).toBe(false);
    remove(w, e, 'GridPosition');
    expect(has(w, e, 'GridPosition')).toBe(false);
  });

  it('refuses components on dead entities', () => {
    const w = createWorld();
    const e = createEntity(w);
    destroyEntity(w, e);
    expect(() => add(w, e, 'Terrain', { kind: 'soil' })).toThrow();
  });

  it('query returns only entities holding every component, ascending', () => {
    const w = createWorld();
    const ids = [createEntity(w), createEntity(w), createEntity(w), createEntity(w)];
    for (const e of ids.slice().reverse()) add(w, e, 'GridPosition', { x: e, y: 0 });
    add(w, ids[1]!, 'Flora', { species: 'grass', growth: 0, mature: false });
    add(w, ids[3]!, 'Flora', { species: 'tree', growth: 0, mature: false });
    expect(query(w, 'GridPosition')).toEqual(ids);
    expect(query(w, 'GridPosition', 'Flora')).toEqual([ids[1], ids[3]]);
    expect(query(w, 'Building')).toEqual([]);
  });

  it('destroy removes the entity from every store', () => {
    const w = createWorld();
    const e = createEntity(w);
    add(w, e, 'GridPosition', { x: 0, y: 0 });
    add(w, e, 'Terrain', { kind: 'rock' });
    destroyEntity(w, e);
    expect(query(w, 'GridPosition')).toEqual([]);
    expect(query(w, 'Terrain')).toEqual([]);
    expect(isAlive(w, e)).toBe(false);
  });

  it('survives structuredClone and JSON round trips', () => {
    const w = createWorld();
    const e = createEntity(w);
    add(w, e, 'Building', { type: 'solar', level: 2, goldInvested: 39 });
    expect(structuredClone(w)).toEqual(w);
    const j = JSON.parse(JSON.stringify(w));
    expect(query(j, 'Building')).toEqual([e]);
  });
});
