import { describe, expect, it } from 'vitest';
import { applyAction } from '../src/core/actions';
import { must, query } from '../src/core/ecs/world';
import { tileAt } from '../src/core/grid';
import { tileInfo, previewTool } from '../src/core/selectors';
import type { RejectReason } from '../src/core/events';
import { act, blankGame, endTurn, pollutionAt, sanctuary, setTile } from './helpers';

function rejected(r: ReturnType<typeof act>): RejectReason | undefined {
  const e = r.events.find((x) => x.type === 'action:rejected');
  return e && e.type === 'action:rejected' ? e.reason : undefined;
}

describe('actions: happy paths (T4.2)', () => {
  it('salvage pays the linear yield and converts an exhausted ruin to soil', () => {
    const s = blankGame();
    setTile(s, 10, 3, 'ruin', 70);
    const r1 = act(s, { kind: 'salvage', x: 10, y: 3 });
    expect(r1.state.gold.balance).toBe(s.gold.balance + 10);
    expect(r1.state.energy.current).toBe(s.energy.current - 1);
    const r2 = act(r1.state, { kind: 'salvage', x: 10, y: 3 });
    expect(tileInfo(r2.state, 10, 3)!.terrain).toBe('soil');
    expect(tileInfo(r2.state, 10, 3)!.pollution).toBe(70);
    expect(rejected(act(r2.state, { kind: 'salvage', x: 10, y: 3 }))).toBe('invalid_target');
  });

  it('build debits the exponential cost and energy, then upgrade follows the curve', () => {
    const s = blankGame();
    s.gold = { balance: 500, earned: 500, spent: 0 };
    const b = act(s, { kind: 'build', building: 'solar', x: 10, y: 3 }).state;
    expect(b.gold.balance).toBe(500 - 14);
    expect(b.energy.current).toBe(s.energy.current - 2);
    const u = act(b, { kind: 'upgrade', x: 10, y: 3 }).state;
    expect(u.gold.balance).toBe(500 - 14 - 25);
    expect(tileInfo(u, 10, 3)!.building!.level).toBe(2);
    const u3 = act(u, { kind: 'upgrade', x: 10, y: 3 }).state;
    expect(rejected(act(u3, { kind: 'upgrade', x: 10, y: 3 }))).toBe('max_level');
  });

  it('demolish refunds half of all Gold invested', () => {
    const s = blankGame();
    s.gold = { balance: 500, earned: 500, spent: 0 };
    let t = act(s, { kind: 'build', building: 'recycler', x: 10, y: 3 }).state;
    t = act(t, { kind: 'upgrade', x: 10, y: 3 }).state;
    const before = t.gold.balance;
    t = act(t, { kind: 'demolish', x: 10, y: 3 }).state;
    expect(t.gold.balance).toBe(before + Math.floor((28 + 49) / 2));
    expect(tileInfo(t, 10, 3)!.building).toBeNull();
  });

  it('sealer seals the stack and it stops emitting', () => {
    const s = blankGame();
    s.gold = { balance: 100, earned: 100, spent: 0 };
    setTile(s, 12, 6, 'stack', 100);
    const t = act(s, { kind: 'build', building: 'sealer', x: 12, y: 6 }).state;
    expect(tileInfo(t, 12, 6)!.sealed).toBe(true);
    expect(pollutionAt(endTurn(t), 13, 6)).toBe(0);
    expect(rejected(act(t, { kind: 'demolish', x: 12, y: 6 }))).toBe('immovable');
  });

  it('battery raises capacity immediately; demolishing it discharges the excess', () => {
    const s = blankGame();
    s.gold = { balance: 100, earned: 100, spent: 0 };
    const t = act(s, { kind: 'build', building: 'battery', x: 10, y: 3 }).state;
    expect(t.energy.max).toBe(12);
    const full = endTurn(t);
    expect(full.energy.current).toBeGreaterThan(8);
    const d = act(full, { kind: 'demolish', x: 10, y: 3 }).state;
    expect(d.energy.max).toBe(8);
    expect(d.energy.current).toBeLessThanOrEqual(8);
  });

  it('toggle switches upkeep buildings only', () => {
    const s = blankGame();
    s.gold = { balance: 100, earned: 100, spent: 0 };
    let t = act(s, { kind: 'build', building: 'scrubber', x: 10, y: 3 }).state;
    t = act(t, { kind: 'toggle', x: 10, y: 3 }).state;
    expect(tileInfo(t, 10, 3)!.building!.enabled).toBe(false);
    t = act(t, { kind: 'build', building: 'solar', x: 11, y: 3 }).state;
    expect(rejected(act(t, { kind: 'toggle', x: 11, y: 3 }))).toBe('not_toggleable');
  });

  it('plant respects tolerance; cleanup costs no Gold', () => {
    const s = blankGame();
    setTile(s, 10, 3, 'soil', 11);
    expect(rejected(act(s, { kind: 'plant', species: 'tree', x: 10, y: 3 }))).toBe('too_polluted');
    const p = act(s, { kind: 'plant', species: 'shrub', x: 10, y: 3 }).state;
    expect(tileInfo(p, 10, 3)!.flora!.species).toBe('shrub');
    const c = act(s, { kind: 'cleanup', x: 10, y: 3 }).state;
    expect(pollutionAt(c, 10, 3)).toBe(1);
    expect(c.gold.balance).toBe(s.gold.balance);
    expect(c.energy.current).toBe(s.energy.current - 2);
  });

  it('end turn runs resolution then preparation and returns to action', () => {
    const s = blankGame();
    const t = act(s, { kind: 'endTurn' });
    expect(t.state.turn).toBe(2);
    expect(t.state.phase).toBe('action');
    const phases = t.events.filter((e) => e.type === 'phase:changed').map((e) => (e.type === 'phase:changed' ? e.phase : ''));
    expect(phases).toEqual(['resolution', 'preparation', 'action']);
    expect(t.events.some((e) => e.type === 'turn:started')).toBe(true);
  });
});

describe('actions: every rejection reason (T4.2)', () => {
  it('maps invalid input to reason codes without changing state', () => {
    const s = blankGame();
    s.gold = { balance: 10, earned: 10, spent: 0 };
    const home = sanctuary(s);
    setTile(s, 12, 2, 'rock');
    setTile(s, 12, 4, 'water', 40);
    const cases: [Parameters<typeof act>[1], RejectReason][] = [
      [{ kind: 'salvage', x: -1, y: 0 }, 'out_of_bounds'],
      [{ kind: 'salvage', x: 16, y: 0 }, 'out_of_bounds'],
      [{ kind: 'salvage', x: 10, y: 3 }, 'invalid_target'],
      [{ kind: 'build', building: 'wind', x: 10, y: 3 }, 'invalid_terrain'],
      [{ kind: 'build', building: 'solar', x: home.x, y: home.y }, 'occupied'],
      [{ kind: 'build', building: 'sealer', x: 10, y: 3 }, 'invalid_terrain'],
      [{ kind: 'upgrade', x: 10, y: 3 }, 'no_building'],
      [{ kind: 'upgrade', x: home.x, y: home.y }, 'immovable'],
      [{ kind: 'demolish', x: home.x, y: home.y }, 'immovable'],
      [{ kind: 'toggle', x: 10, y: 3 }, 'no_building'],
      [{ kind: 'plant', species: 'grass', x: 12, y: 2 }, 'invalid_terrain'],
      [{ kind: 'cleanup', x: 10, y: 3 }, 'already_clean'],
      [{ kind: 'cleanup', x: 12, y: 2 }, 'invalid_terrain'],
      [{ kind: 'build', building: 'recycler', x: 10, y: 3 }, 'insufficient_gold'],
    ];
    for (const [intent, reason] of cases) {
      const r = act(s, intent);
      expect(rejected(r), JSON.stringify(intent)).toBe(reason);
      expect(r.state).toBe(s);
    }
    const poor = { ...s, energy: { ...s.energy, consumed: s.energy.consumed + s.energy.current, current: 0 } };
    expect(rejected(act(poor, { kind: 'cleanup', x: 12, y: 4 }))).toBe('insufficient_energy');
  });

  it('actions outside the action phase are rejected as wrong_phase', () => {
    const s = { ...blankGame(), phase: 'resolution' as const };
    expect(rejected(act(s, { kind: 'endTurn' }))).toBe('wrong_phase');
  });

  it('a duplicate transaction id is ignored', () => {
    const s = blankGame();
    setTile(s, 10, 3, 'ruin', 70);
    const a = { kind: 'salvage' as const, x: 10, y: 3, txId: 'same' };
    const once = applyAction(s, a);
    const twice = applyAction(once.state, a);
    expect(twice.state).toBe(once.state);
    expect(twice.events).toEqual([]);
  });

  it('previews report the same price and reason as the reducer', () => {
    const s = blankGame();
    expect(previewTool(s, { kind: 'build', building: 'scrubber' }, 10, 3)).toEqual({ ok: true, gold: 18, energy: 2 });
    expect(previewTool(s, { kind: 'build', building: 'sealer' }, 10, 3)).toMatchObject({ ok: false, reason: 'invalid_terrain', gold: 45 });
  });

  it('a newly restored tile is flagged immediately but its bounty is paid at resolution', () => {
    const s = blankGame();
    s.gold = { balance: 100, earned: 100, spent: 0 };
    const t = act(s, { kind: 'build', building: 'solar', x: 10, y: 3 }).state;
    expect(tileInfo(t, 10, 3)!.restored).toBe(true);
    const e = must(t.world, tileAt(t, 10, 3), 'EcoValue');
    expect(e.everRestored).toBe(false);
    const n = endTurn(t);
    expect(n.stats.bountyPaid).toBeGreaterThanOrEqual(2);
    expect(query(n.world, 'Building').length).toBe(2);
  });
});
