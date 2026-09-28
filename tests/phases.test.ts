import { describe, expect, it } from 'vitest';
import { PHASES, TRIGGERS, isTerminal, transition } from '../src/core/phases';

describe('turn state machine (T1.7)', () => {
  it('allows exactly the documented transitions', () => {
    const legal = new Set(['preparation>prepared>action', 'action>playerAction>action', 'action>endTurn>resolution', 'resolution>resolved>preparation', 'resolution>won>victory', 'resolution>lost>defeat']);
    for (const p of PHASES)
      for (const t of TRIGGERS) {
        const next = transition(p, t);
        const key = `${p}>${t}>${next}`;
        if (next === null) expect([...legal].some((l) => l.startsWith(`${p}>${t}>`))).toBe(false);
        else expect(legal.has(key)).toBe(true);
      }
  });

  it('terminal states accept nothing', () => {
    for (const p of PHASES.filter(isTerminal)) for (const t of TRIGGERS) expect(transition(p, t)).toBeNull();
  });
});
