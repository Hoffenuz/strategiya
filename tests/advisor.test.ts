import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyAction, quote, type Intent } from '../src/core/actions';
import { adviceFor, advise } from '../src/core/advisor';
import { isTerminal } from '../src/core/phases';
import { greedyIntent } from '../src/core/sim/bot';
import { createGame } from '../src/core/state';
import { arbDifficulty, arbScript, arbSeed } from './arbitraries';
import { blankGame } from './helpers';
import { DOOMED, doomedGrass, reach } from './reach';

describe('advisor (T10.3)', () => {
  it('first warns about a plant that will wither and suggests cleaning its tile', () => {
    const a = advise(doomedGrass())!;
    expect(a.id).toBe('witherRisk');
    expect(a.at).toEqual(DOOMED.plant);
    expect(a.intent).toEqual({ kind: 'cleanup', ...DOOMED.plant });
    expect(a.params).toMatchObject({ species: 'grass', pollution: 58, after: 64, limit: 60 });
  });

  it('says to end the turn when no Energy is left', () => {
    const s = createGame(3, 'balanced');
    s.energy.consumed += s.energy.current;
    s.energy.current = 0;
    expect(advise(s)).toMatchObject({ id: 'noEnergy', intent: null, at: null });
  });

  it('otherwise names the move of the greedy strategy', () => {
    const s = createGame(3, 'balanced');
    const intent = greedyIntent(s)!;
    const a = advise(s)!;
    expect(intent).not.toBeNull();
    expect(a.intent).toEqual(intent);
    expect(a.id).toBe(adviceFor(intent, s).id);
  });

  it('advises ending the turn when nothing useful is left', () => {
    const s = blankGame('balanced', 7);
    s.gold.spent += s.gold.balance;
    s.gold.balance = 0;
    expect(greedyIntent(s)).toBeNull();
    expect(advise(s)).toMatchObject({ id: 'endTurn', intent: null, at: null });
  });

  it('maps every kind of move to its own advice', () => {
    const s = createGame(3, 'balanced');
    const cases: [Intent, string][] = [
      [{ kind: 'build', building: 'sealer', x: 1, y: 1 }, 'seal'],
      [{ kind: 'build', building: 'solar', x: 1, y: 1 }, 'energy'],
      [{ kind: 'build', building: 'wind', x: 1, y: 1 }, 'energy'],
      [{ kind: 'build', building: 'battery', x: 1, y: 1 }, 'battery'],
      [{ kind: 'build', building: 'recycler', x: 1, y: 1 }, 'recycler'],
      [{ kind: 'build', building: 'scrubber', x: 1, y: 1 }, 'scrubber'],
      [{ kind: 'build', building: 'purifier', x: 1, y: 1 }, 'purifier'],
      [{ kind: 'salvage', x: 1, y: 1 }, 'salvage'],
      [{ kind: 'plant', species: 'tree', x: 1, y: 1 }, 'plant'],
      [{ kind: 'cleanup', x: 1, y: 1 }, 'cleanup'],
      [{ kind: 'upgrade', x: 1, y: 1 }, 'upgrade'],
      [{ kind: 'demolish', x: 1, y: 1 }, 'relocate'],
    ];
    for (const [intent, id] of cases) {
      const a = adviceFor(intent, s);
      expect(a.id, JSON.stringify(intent)).toBe(id);
      expect(a.intent).toEqual(intent);
      expect(a.at).toEqual({ x: 1, y: 1 });
    }
  });

  it('Invariant 14: every suggested move is legal in random reachable states', () => {
    fc.assert(
      fc.property(arbSeed, arbDifficulty, arbScript, (seed, d, script) => {
        const s = reach(seed, d, script);
        const a = advise(s);
        if (s.phase !== 'action') {
          expect(a).toBeNull();
          return;
        }
        expect(a).not.toBeNull();
        if (a!.intent) expect(quote(s, a!.intent).ok).toBe(true);
        if (a!.intent && a!.intent.kind !== 'endTurn') expect(a!.at).toEqual({ x: a!.intent.x, y: a!.intent.y });
      }),
      { numRuns: 60 },
    );
  });

  it('is silent once the game is over', () => {
    let s = createGame(4, 'hard');
    for (let i = 0; !isTerminal(s.phase) && i < 200; i++) s = applyAction(s, { kind: 'endTurn', txId: `t${i}` }).state;
    expect(advise(s)).toBeNull();
  });
});
