import { G_RESTORE, MILESTONES } from '../config';
import { must, query } from '../ecs/world';
import { milestoneReward } from '../economy/formulas';
import { creditGold } from '../economy/ledger';
import { occupants } from '../grid';
import type { GameState } from '../state';
import type { SystemContext } from './context';
import { restorationSummary } from './restorable';

/**
 * Recomputes every tile's `restored` flag. Returns tiles restored for the first time;
 * with `commit = false` it does not mark them, so their bounty is still paid later.
 */
export function refreshRestored(s: GameState, commit = true): { x: number; y: number }[] {
  const occ = occupants(s);
  const firstTime: { x: number; y: number }[] = [];
  for (const e of query(s.world, 'Terrain', 'EcoValue', 'PollutionLevel', 'GridPosition')) {
    const kind = must(s.world, e, 'Terrain').kind;
    const clean = must(s.world, e, 'PollutionLevel').value === 0;
    const pos = must(s.world, e, 'GridPosition');
    const key = pos.y * s.width + pos.x;
    let restored = false;
    if (kind === 'water') restored = clean;
    else if (kind === 'soil') {
      const f = occ.flora.get(key);
      restored = clean && ((f !== undefined && must(s.world, f, 'Flora').mature) || occ.building.has(key));
    }
    const eco = must(s.world, e, 'EcoValue');
    eco.restored = restored;
    if (restored && !eco.everRestored) {
      if (commit) eco.everRestored = true;
      firstTime.push(pos);
    }
  }
  return firstTime;
}

/** RestorationSystem: first-time bounties and milestones, each paid exactly once (R-7.6, R-7.7). */
export function restorationSystem({ s, emit }: SystemContext): void {
  for (const pos of refreshRestored(s)) {
    creditGold(s.gold, G_RESTORE);
    s.stats.restoredEver++;
    s.stats.bountyPaid += G_RESTORE;
    emit({ type: 'tile:restored', bounty: G_RESTORE, x: pos.x, y: pos.y });
  }
  const { ratio } = restorationSummary(s);
  while (s.milestonesReached < MILESTONES.length && ratio >= MILESTONES[s.milestonesReached]!) {
    s.milestonesReached++;
    const reward = milestoneReward(s.milestonesReached);
    creditGold(s.gold, reward);
    s.stats.milestoneGold += reward;
    s.journal.push(s.milestonesReached);
    emit({ type: 'ecosystem:milestone', index: s.milestonesReached, ratio, reward });
  }
  emit({ type: 'gold:changed', delta: 0, balance: s.gold.balance });
}
