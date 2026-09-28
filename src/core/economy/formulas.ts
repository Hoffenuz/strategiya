import {
  BUILDINGS,
  COST_GROWTH,
  EMAX_ALPHA,
  EMAX_BETA,
  G_BASE,
  G_MILESTONE_STEP,
  K_REC,
  K_SALV,
  SPREAD_K,
  SPREAD_L,
  SPREAD_R0,
  type PlaceableBuilding,
} from '../config';

/** Pure economy math from design.md §4. All outputs are integers except probabilities. */

/** Round half away from zero. */
export function roundHalfAway(x: number): number {
  return Math.sign(x) * Math.round(Math.abs(x));
}

/** §4.1 Linear Gold income: I = G_base + k_rec · ΣL. */
export function goldIncome(totalRecyclerLevel: number): number {
  return G_BASE + K_REC * totalRecyclerLevel;
}

/** §4.2 Linear salvage yield: G = k_salv · d. */
export function salvageYield(density: number): number {
  return K_SALV * density;
}

/** §4.3 Exponential cost to reach `level`: ⌈a · b^(L−1)⌉. */
export function buildingCost(type: PlaceableBuilding, level: number): number {
  const a = BUILDINGS[type].a;
  // Small epsilon keeps ⌈⌉ stable against floating-point noise (e.g. 14·1.75 = 24.500000000000004).
  return Math.ceil(a * Math.pow(COST_GROWTH, level - 1) - 1e-9);
}

/** §4.4 Energy output of one producer. */
export function producerOutput(kind: 'sanctuary' | 'solar' | 'wind', level: number): number {
  switch (kind) {
    case 'solar':
      return level + 1;
    case 'wind':
      return 2 * level + 1;
    case 'sanctuary':
      return 0; // R_base is added separately.
  }
}

/** §4.5 Logarithmic energy cap: ⌊α · ln(1 + B) + β⌋. */
export function energyCapacity(totalBatteryLevel: number): number {
  return Math.floor(EMAX_ALPHA * Math.log(1 + totalBatteryLevel) + EMAX_BETA + 1e-9);
}

/** §4.6 Logarithmic soil cleansing power. */
export function soilCleansePower(level: number): number {
  return roundHalfAway(8 * Math.log(1 + level) + 6);
}

/** §4.6 Logarithmic water cleansing power. */
export function waterCleansePower(level: number): number {
  return roundHalfAway(12 * Math.log(1 + level) + 10);
}

export function scrubberRadius(level: number): number {
  return level >= 3 ? 2 : 1;
}

/** §4.8 Logistic S-curve for flora spread. */
export function spreadChance(ratio: number): number {
  return SPREAD_L / (1 + Math.exp(-SPREAD_K * (ratio - SPREAD_R0)));
}

/** §4.9 Milestone reward for the i-th milestone (1-based). */
export function milestoneReward(i: number): number {
  return G_MILESTONE_STEP * i;
}
