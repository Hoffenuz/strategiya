/** Turn state machine (design §3.5). */

export type Phase = 'preparation' | 'action' | 'resolution' | 'victory' | 'defeat';
export type PhaseTrigger = 'prepared' | 'playerAction' | 'endTurn' | 'resolved' | 'won' | 'lost';

const TABLE: Record<Phase, Partial<Record<PhaseTrigger, Phase>>> = {
  preparation: { prepared: 'action' },
  action: { playerAction: 'action', endTurn: 'resolution' },
  resolution: { resolved: 'preparation', won: 'victory', lost: 'defeat' },
  victory: {},
  defeat: {},
};

export const PHASES: readonly Phase[] = ['preparation', 'action', 'resolution', 'victory', 'defeat'];
export const TRIGGERS: readonly PhaseTrigger[] = ['prepared', 'playerAction', 'endTurn', 'resolved', 'won', 'lost'];

/** Next phase, or null when the trigger is illegal in `phase`. */
export function transition(phase: Phase, trigger: PhaseTrigger): Phase | null {
  return TABLE[phase][trigger] ?? null;
}

export function isTerminal(phase: Phase): boolean {
  return phase === 'victory' || phase === 'defeat';
}
