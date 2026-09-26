import { R_BASE } from '../config';
import { must, query } from '../ecs/world';
import { energyCapacity, producerOutput } from '../economy/formulas';
import { produceEnergy, setEnergyMax, tryConsumeEnergy } from '../economy/ledger';
import type { GameState } from '../state';
import type { SystemContext } from './context';
import { upkeepSystem } from './upkeep';

export function totalBatteryLevel(s: GameState): number {
  let b = 0;
  for (const e of query(s.world, 'Building', 'EnergyStorage')) b += must(s.world, e, 'Building').level;
  return b;
}

/** Gross production before the capacity clamp (design §4.4). */
export function grossProduction(s: GameState): number {
  let total = R_BASE;
  for (const e of query(s.world, 'Building', 'EnergyProducer')) {
    total += producerOutput(must(s.world, e, 'EnergyProducer').kind, must(s.world, e, 'Building').level);
  }
  return total;
}

/** Recomputes the logarithmic cap from battery levels. */
export function refreshCapacity(s: GameState): void {
  setEnergyMax(s.energy, energyCapacity(totalBatteryLevel(s)));
}

/**
 * EnergySystem: production first pays building upkeep, the rest is stored up to the
 * logarithmic cap and any overflow is curtailed (design §4.4–4.5).
 */
export function energySystem(ctx: SystemContext): { produced: number; curtailed: number; upkeep: number } {
  const { s, emit } = ctx;
  refreshCapacity(s);
  const gross = grossProduction(s);
  const upkeep = upkeepSystem(ctx, s.energy.current + gross);
  const added = produceEnergy(s.energy, gross, upkeep);
  if (!tryConsumeEnergy(s.energy, upkeep)) throw new Error('upkeep exceeds available energy');
  emit({ type: 'energy:changed', delta: added - upkeep, current: s.energy.current });
  return { produced: added, curtailed: gross - added, upkeep };
}
