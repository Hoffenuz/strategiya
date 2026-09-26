import { BUILDINGS, DIFFICULTIES, SPECIES, type Difficulty } from '../config';
import { must, query } from '../ecs/world';
import { buildingCost } from '../economy/formulas';
import { applyAction, quote, type Intent } from '../actions';
import { area, chebyshev, occupants, tileAt } from '../grid';
import { isTerminal } from '../phases';
import { createGame, type GameState } from '../state';
import { forecast } from '../selectors';
import { restorationSummary } from '../systems/restorable';

/**
 * Scripted players for macro-balance simulation (design §4.11, GEEvo-inspired):
 * the greedy bot must win Balanced within the turn limit; the passive bot must not.
 */

export type Strategy = 'greedy' | 'passive';

interface TileView {
  x: number;
  y: number;
  kind: string;
  pollution: number;
  occupied: boolean;
  sealedStack: boolean;
}

function view(s: GameState): TileView[] {
  const occ = occupants(s);
  const out: TileView[] = [];
  for (let y = 0; y < s.height; y++)
    for (let x = 0; x < s.width; x++) {
      const t = tileAt(s, x, y);
      const key = y * s.width + x;
      const src = s.world.c.ToxicSource[t];
      out.push({
        x,
        y,
        kind: must(s.world, t, 'Terrain').kind,
        pollution: must(s.world, t, 'PollutionLevel').value,
        occupied: occ.building.has(key) || occ.flora.has(key),
        sealedStack: src ? src.sealed : false,
      });
    }
  return out;
}

function sanctuaryPos(s: GameState): { x: number; y: number } {
  for (const e of query(s.world, 'Building', 'GridPosition')) {
    if (must(s.world, e, 'Building').type === 'sanctuary') return must(s.world, e, 'GridPosition');
  }
  return { x: 0, y: 0 };
}

function unsealedStacks(tiles: TileView[]): TileView[] {
  return tiles.filter((t) => t.kind === 'stack' && !t.sealedStack);
}

function areaPollution(s: GameState, tiles: TileView[], x: number, y: number, r: number): number {
  let sum = 0;
  for (const [ax, ay] of area(s, x, y, r)) {
    const t = tiles[ay * s.width + ax]!;
    if (t.kind === 'soil' || t.kind === 'water' || t.kind === 'ruin') sum += t.pollution;
  }
  return sum;
}

/** Chooses the next greedy intent, or null to end the turn. */
export function greedyIntent(s: GameState): Intent | null {
  const tiles = view(s);
  const home = sanctuaryPos(s);
  const ok = (i: Intent) => quote(s, i).ok;
  const byDistance = (a: TileView, b: TileView) => chebyshev(a.x, a.y, home.x, home.y) - chebyshev(b.x, b.y, home.x, home.y);
  const f = forecast(s);
  const net = f.production - f.upkeep;
  const stacks = unsealedStacks(tiles).sort(byDistance);
  const recyclers = query(s.world, 'GoldProducer').length;

  // 1. Seal stacks as soon as affordable.
  for (const st of stacks) {
    const i: Intent = { kind: 'build', building: 'sealer', x: st.x, y: st.y };
    if (ok(i)) return i;
  }
  const savingForSealer = stacks.length > 0 && s.gold.balance < BUILDINGS.sealer.a && s.turn > 4;

  const soilFree = tiles.filter((t) => t.kind === 'soil' && !t.occupied);

  // 3. Energy: build solar (or wind on rock) when the net flow is thin; batteries when production is wasted.
  const wantEnergy = net < Math.min(12, 5 + Math.floor(s.turn / 6));
  if (wantEnergy && !savingForSealer) {
    const rock = tiles.find((t) => t.kind === 'rock' && !t.occupied);
    if (rock && s.gold.balance >= buildingCost('wind', 1) + 10 && ok({ kind: 'build', building: 'wind', x: rock.x, y: rock.y }))
      return { kind: 'build', building: 'wind', x: rock.x, y: rock.y };
    const spot = soilFree.slice().sort((a, b) => b.pollution - a.pollution || byDistance(a, b))[0];
    if (spot && ok({ kind: 'build', building: 'solar', x: spot.x, y: spot.y })) return { kind: 'build', building: 'solar', x: spot.x, y: spot.y };
  }
  if (f.production - f.upkeep > s.energy.max - 2 && !savingForSealer) {
    for (const e of query(s.world, 'Building', 'EnergyStorage', 'GridPosition')) {
      const p = must(s.world, e, 'GridPosition');
      if (ok({ kind: 'upgrade', x: p.x, y: p.y })) return { kind: 'upgrade', x: p.x, y: p.y };
    }
    const spot = soilFree.slice().sort((a, b) => b.pollution - a.pollution)[0];
    if (spot && ok({ kind: 'build', building: 'battery', x: spot.x, y: spot.y })) return { kind: 'build', building: 'battery', x: spot.x, y: spot.y };
  }

  // 4. A couple of recyclers for linear income.
  if (recyclers < 2 && s.gold.balance >= buildingCost('recycler', 1) + 10 && !savingForSealer) {
    const spot = soilFree.slice().sort((a, b) => b.pollution - a.pollution)[0];
    if (spot && ok({ kind: 'build', building: 'recycler', x: spot.x, y: spot.y })) return { kind: 'build', building: 'recycler', x: spot.x, y: spot.y };
  }

  // 4b. Salvage the nearest ruin.
  const ruin = tiles.filter((t) => t.kind === 'ruin').sort(byDistance)[0];
  if (ruin && ok({ kind: 'salvage', x: ruin.x, y: ruin.y })) return { kind: 'salvage', x: ruin.x, y: ruin.y };

  // 5. Scrubbers on the most polluted cluster away from live stacks, if upkeep is sustainable.
  if (net >= 2 && !savingForSealer) {
    const candidates = soilFree
      .filter((t) => t.pollution > 0 && stacks.every((st) => chebyshev(st.x, st.y, t.x, t.y) > 3))
      .map((t) => ({ t, score: areaPollution(s, tiles, t.x, t.y, 1) - chebyshev(t.x, t.y, home.x, home.y) * 4 }))
      .sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (best && best.score > 60) {
      const i: Intent = { kind: 'build', building: 'scrubber', x: best.t.x, y: best.t.y };
      if (ok(i)) return i;
    }
  }

  // 6. Relocate scrubbers whose area is fully clean.
  for (const e of query(s.world, 'Cleanser', 'GridPosition', 'Building')) {
    const p = must(s.world, e, 'GridPosition');
    if (must(s.world, e, 'Building').type !== 'scrubber') continue;
    if (areaPollution(s, tiles, p.x, p.y, 2) === 0) {
      const i: Intent = { kind: 'demolish', x: p.x, y: p.y };
      if (ok(i)) return i;
    }
  }

  // 7. Water purifiers on polluted water near home.
  if (net >= 4 && !savingForSealer && s.gold.balance > 40) {
    const w = tiles.filter((t) => t.kind === 'water' && !t.occupied && t.pollution > 20).sort(byDistance)[0];
    if (w && ok({ kind: 'build', building: 'purifier', x: w.x, y: w.y })) return { kind: 'build', building: 'purifier', x: w.x, y: w.y };
  }

  // 8. Plant: grass on anything it tolerates, trees on very clean tiles when rich.
  const plantable = soilFree.filter((t) => t.pollution <= SPECIES.grass.tolerance).sort((a, b) => a.pollution - b.pollution || byDistance(a, b));
  for (const t of plantable) {
    const species = t.pollution <= SPECIES.tree.tolerance && s.gold.balance > 80 ? 'tree' : 'grass';
    const i: Intent = { kind: 'plant', species, x: t.x, y: t.y };
    if (ok(i) && (s.gold.balance >= 20 || !savingForSealer)) return i;
  }

  // 9. Spend leftover energy finishing nearly-clean tiles.
  const nearlyClean = tiles
    .filter((t) => (t.kind === 'soil' || t.kind === 'water') && t.pollution > 0 && t.pollution <= 10)
    .sort(byDistance)[0];
  if (nearlyClean && ok({ kind: 'cleanup', x: nearlyClean.x, y: nearlyClean.y })) return { kind: 'cleanup', x: nearlyClean.x, y: nearlyClean.y };

  // 10. Upgrade producers when rich.
  if (s.gold.balance > 90) {
    for (const e of query(s.world, 'Building', 'GridPosition')) {
      const b = must(s.world, e, 'Building');
      if (b.type !== 'solar' && b.type !== 'recycler') continue;
      const p = must(s.world, e, 'GridPosition');
      if (ok({ kind: 'upgrade', x: p.x, y: p.y })) return { kind: 'upgrade', x: p.x, y: p.y };
    }
  }
  return null;
}

export interface SimResult {
  state: GameState;
  won: boolean;
  turns: number;
}

export function runBot(seed: number, difficulty: Difficulty, strategy: Strategy, maxTurns = 200, trace?: (s: GameState) => void): SimResult {
  let s = createGame(seed, difficulty);
  let tx = 0;
  const limit = DIFFICULTIES[difficulty].turnLimit ?? maxTurns;
  while (!isTerminal(s.phase) && s.turn <= Math.min(limit, maxTurns)) {
    if (strategy === 'greedy') {
      for (let guard = 0; guard < 60; guard++) {
        const intent = greedyIntent(s);
        if (!intent) break;
        const r = applyAction(s, { ...intent, txId: `b${tx++}` } as never);
        if (r.state === s) break;
        s = r.state;
      }
    }
    trace?.(s);
    s = applyAction(s, { kind: 'endTurn', txId: `b${tx++}` }).state;
  }
  return { state: s, won: s.outcome?.result === 'victory', turns: s.turn };
}

export function describe(s: GameState): string {
  const r = restorationSummary(s);
  return `turn ${s.turn} phase ${s.phase} ratio ${r.ratio.toFixed(2)} avgP ${r.averagePollution.toFixed(1)} gold ${s.gold.balance} energy ${s.energy.current}/${s.energy.max} outcome ${JSON.stringify(s.outcome)}`;
}
