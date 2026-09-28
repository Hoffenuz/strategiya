import { must, query } from '../ecs/world';
import { creditGold } from '../economy/ledger';
import { goldIncome } from '../economy/formulas';
import type { SystemContext } from './context';

/** EconomySystem: linear passive Gold income (design §4.1). Returns the amount credited. */
export function economySystem({ s, emit }: SystemContext): number {
  let levels = 0;
  for (const e of query(s.world, 'Building', 'GoldProducer')) levels += must(s.world, e, 'Building').level;
  const income = goldIncome(levels);
  creditGold(s.gold, income);
  emit({ type: 'gold:changed', delta: income, balance: s.gold.balance });
  return income;
}
