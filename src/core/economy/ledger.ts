/**
 * The only code allowed to change Gold and Energy balances.
 * Invariants (design §6): spent + balance = earned; consumed + current = produced;
 * balances ≥ 0; current ≤ max.
 */

export interface GoldLedger {
  balance: number;
  earned: number;
  spent: number;
}

export interface EnergyLedger {
  current: number;
  produced: number;
  consumed: number;
  curtailed: number;
  max: number;
}

function assertAmount(amount: number): void {
  if (!Number.isInteger(amount) || amount < 0) throw new Error(`invalid amount ${amount}`);
}

export function creditGold(g: GoldLedger, amount: number): void {
  assertAmount(amount);
  g.balance += amount;
  g.earned += amount;
}

export function canAffordGold(g: GoldLedger, amount: number): boolean {
  return amount <= g.balance;
}

/** Debits and returns true, or changes nothing and returns false. */
export function tryDebitGold(g: GoldLedger, amount: number): boolean {
  assertAmount(amount);
  if (amount > g.balance) return false;
  g.balance -= amount;
  g.spent += amount;
  return true;
}

/**
 * Adds as much as fits under the cap; the overflow is curtailed. Returns the amount added.
 * `reserved` extends the room for energy that is consumed right after (upkeep drawn from
 * this turn's production), so the caller must consume at least that much immediately.
 */
export function produceEnergy(e: EnergyLedger, amount: number, reserved = 0): number {
  assertAmount(amount);
  assertAmount(reserved);
  const room = Math.max(0, e.max + reserved - e.current);
  const added = Math.min(amount, room);
  e.current += added;
  e.produced += added;
  e.curtailed += amount - added;
  return added;
}

export function tryConsumeEnergy(e: EnergyLedger, amount: number): boolean {
  assertAmount(amount);
  if (amount > e.current) return false;
  e.current -= amount;
  e.consumed += amount;
  return true;
}

/**
 * Changes the capacity. If capacity shrinks below current (demolished battery),
 * the excess is consumed ("discharged") so conservation still holds.
 */
export function setEnergyMax(e: EnergyLedger, max: number): void {
  assertAmount(max);
  e.max = max;
  if (e.current > max) {
    const excess = e.current - max;
    e.current -= excess;
    e.consumed += excess;
  }
}
