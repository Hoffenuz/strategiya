import { BUILDINGS, E_BUILD, E_CLEANUP, E_SALVAGE, E_UPGRADE, K_MANUAL, SPECIES, type PlaceableBuilding } from './config';
import type { Species } from './ecs/components';
import { destroyEntity, get, must, type Entity } from './ecs/world';
import { buildingCost, salvageYield } from './economy/formulas';
import { creditGold, tryConsumeEnergy, tryDebitGold } from './economy/ledger';
import type { Emit, GameEvent, RejectReason } from './events';
import { inBounds, occupants, tileAt } from './grid';
import { isTerminal, transition } from './phases';
import type { Rng } from './rng';
import { cloneState, spawnBuilding, type GameState } from './state';
import type { SystemContext } from './systems/context';
import { cleansingSystem } from './systems/cleansing';
import { economySystem } from './systems/economy';
import { energySystem, refreshCapacity } from './systems/energy';
import { growthSystem, spawnFlora } from './systems/growth';
import { pollutionSystem } from './systems/pollution';
import { randomEventSystem } from './systems/randomEvents';
import { isRestorable } from './systems/restorable';
import { refreshRestored, restorationSystem } from './systems/restoration';
import { victorySystem } from './systems/victory';

type At = { x: number; y: number };

/** An intent without its transaction id: used for previews and validation. */
export type Intent =
  | ({ kind: 'salvage' } & At)
  | ({ kind: 'build'; building: PlaceableBuilding } & At)
  | ({ kind: 'upgrade' } & At)
  | ({ kind: 'demolish' } & At)
  | ({ kind: 'toggle' } & At)
  | ({ kind: 'plant'; species: Species } & At)
  | ({ kind: 'cleanup' } & At)
  | { kind: 'endTurn' };

export type Action = Intent & { txId: string };

export type Quote = { ok: true; gold: number; energy: number } | { ok: false; reason: RejectReason; gold: number; energy: number };

function reject(reason: RejectReason, gold = 0, energy = 0): Quote {
  return { ok: false, reason, gold, energy };
}

function affordability(s: GameState, gold: number, energy: number): Quote {
  if (gold > s.gold.balance) return reject('insufficient_gold', gold, energy);
  if (energy > s.energy.current) return reject('insufficient_energy', gold, energy);
  return { ok: true, gold, energy };
}

function buildingAt(s: GameState, x: number, y: number): Entity | undefined {
  return occupants(s).building.get(y * s.width + x);
}

/** Validates an intent against the current state and prices it (never mutates). */
export function quote(s: GameState, a: Intent): Quote {
  if (isTerminal(s.phase)) return reject('game_over');
  const trigger = a.kind === 'endTurn' ? 'endTurn' : 'playerAction';
  if (transition(s.phase, trigger) === null) return reject('wrong_phase');
  if (a.kind === 'endTurn') return { ok: true, gold: 0, energy: 0 };
  if (!inBounds(s, a.x, a.y)) return reject('out_of_bounds');

  const tile = tileAt(s, a.x, a.y);
  const kind = must(s.world, tile, 'Terrain').kind;
  const pollution = must(s.world, tile, 'PollutionLevel').value;
  const occ = occupants(s);
  const key = a.y * s.width + a.x;
  const building = occ.building.get(key);
  const occupied = building !== undefined || occ.flora.has(key);

  switch (a.kind) {
    case 'salvage': {
      const salvage = get(s.world, tile, 'Salvage');
      if (kind !== 'ruin' || !salvage || salvage.remaining <= 0) return reject('invalid_target', 0, E_SALVAGE);
      return affordability(s, 0, E_SALVAGE);
    }
    case 'build': {
      const def = BUILDINGS[a.building];
      if (!def) return reject('invalid_target');
      const cost = buildingCost(a.building, 1);
      if (kind !== def.terrain) return reject('invalid_terrain', cost, E_BUILD);
      if (occupied) return reject('occupied', cost, E_BUILD);
      if (a.building === 'sealer' && must(s.world, tile, 'ToxicSource').sealed) return reject('invalid_target', cost, E_BUILD);
      return affordability(s, cost, E_BUILD);
    }
    case 'upgrade': {
      if (building === undefined) return reject('no_building');
      const b = must(s.world, building, 'Building');
      if (b.type === 'sanctuary') return reject('immovable');
      if (b.level >= BUILDINGS[b.type].maxLevel) return reject('max_level');
      return affordability(s, buildingCost(b.type, b.level + 1), E_UPGRADE);
    }
    case 'demolish': {
      if (building === undefined) return reject('no_building');
      const b = must(s.world, building, 'Building');
      if (b.type === 'sanctuary' || b.type === 'sealer') return reject('immovable');
      return affordability(s, 0, 1);
    }
    case 'toggle': {
      if (building === undefined) return reject('no_building');
      if (get(s.world, building, 'EnergyCost') === undefined) return reject('not_toggleable');
      return { ok: true, gold: 0, energy: 0 };
    }
    case 'plant': {
      const def = SPECIES[a.species];
      if (!def) return reject('invalid_target');
      if (kind !== 'soil') return reject('invalid_terrain', def.gold, def.energy);
      if (occupied) return reject('occupied', def.gold, def.energy);
      if (pollution > def.tolerance) return reject('too_polluted', def.gold, def.energy);
      return affordability(s, def.gold, def.energy);
    }
    case 'cleanup': {
      if (!isRestorable(kind)) return reject('invalid_terrain', 0, E_CLEANUP);
      if (pollution === 0) return reject('already_clean', 0, E_CLEANUP);
      return affordability(s, 0, E_CLEANUP);
    }
  }
}

export interface ActionResult {
  state: GameState;
  events: GameEvent[];
}

/**
 * The pure reducer (design §3.6): never mutates `state`.
 * A repeated txId returns the same state and no events; a rejected action returns
 * the same state and exactly one `action:rejected` event.
 */
export function applyAction(state: GameState, action: Action): ActionResult {
  if (state.processedTx.includes(action.txId)) return { state, events: [] };
  const q = quote(state, action);
  if (!q.ok) return { state, events: [{ type: 'action:rejected', action: action.kind, reason: q.reason }] };

  const s = cloneState(state);
  const events: GameEvent[] = [];
  const emit: Emit = (e) => events.push(e);
  s.processedTx.push(action.txId);

  // Costs are debited atomically: quote() already proved both fit.
  if (!tryDebitGold(s.gold, q.gold) || !tryConsumeEnergy(s.energy, q.energy)) throw new Error('ledger precondition violated');
  if (q.gold > 0) emit({ type: 'gold:changed', delta: -q.gold, balance: s.gold.balance });
  if (q.energy > 0) emit({ type: 'energy:changed', delta: -q.energy, current: s.energy.current });

  if (action.kind === 'endTurn') {
    endTurn(s, emit);
    return { state: s, events };
  }

  const { x, y } = action;
  const tile = tileAt(s, x, y);
  switch (action.kind) {
    case 'salvage': {
      const salvage = must(s.world, tile, 'Salvage');
      const gold = salvageYield(salvage.density);
      salvage.remaining--;
      creditGold(s.gold, gold);
      s.stats.salvaged++;
      if (salvage.remaining === 0) {
        must(s.world, tile, 'Terrain').kind = 'soil';
        delete s.world.c.Salvage[tile];
      }
      emit({ type: 'tile:salvaged', gold, remaining: salvage.remaining, x, y });
      emit({ type: 'gold:changed', delta: gold, balance: s.gold.balance });
      break;
    }
    case 'build': {
      spawnBuilding(s.world, action.building, x, y, q.gold);
      s.stats.built++;
      if (action.building === 'sealer') {
        must(s.world, tile, 'ToxicSource').sealed = true;
        s.stats.sealed++;
        emit({ type: 'stack:sealed', x, y });
      }
      if (action.building === 'battery') refreshCapacity(s);
      emit({ type: 'building:placed', building: action.building, x, y });
      break;
    }
    case 'upgrade': {
      const b = must(s.world, buildingAt(s, x, y)!, 'Building');
      b.level++;
      b.goldInvested += q.gold;
      if (b.type === 'battery') refreshCapacity(s);
      emit({ type: 'building:upgraded', building: b.type, level: b.level, x, y });
      break;
    }
    case 'demolish': {
      const e = buildingAt(s, x, y)!;
      const b = must(s.world, e, 'Building');
      const refund = Math.floor(b.goldInvested / 2);
      destroyEntity(s.world, e);
      creditGold(s.gold, refund);
      if (b.type === 'battery') refreshCapacity(s);
      emit({ type: 'building:demolished', building: b.type, refund, x, y });
      emit({ type: 'gold:changed', delta: refund, balance: s.gold.balance });
      emit({ type: 'energy:changed', delta: 0, current: s.energy.current });
      break;
    }
    case 'toggle': {
      const e = buildingAt(s, x, y)!;
      const active = must(s.world, e, 'ActiveState');
      active.enabled = !active.enabled;
      // Re-enabling mid-turn does not grant power: upkeep is paid at the next preparation.
      if (!active.enabled) active.powered = false;
      emit({ type: 'building:toggled', building: must(s.world, e, 'Building').type, enabled: active.enabled, x, y });
      break;
    }
    case 'plant': {
      spawnFlora(s, action.species, x, y);
      s.stats.planted++;
      emit({ type: 'flora:planted', species: action.species, x, y });
      break;
    }
    case 'cleanup': {
      const p = must(s.world, tile, 'PollutionLevel');
      const amount = Math.min(K_MANUAL, p.value);
      p.value -= amount;
      emit({ type: 'tile:cleaned', amount, x, y });
      break;
    }
  }
  // Keep `restored` flags current for the inspector; bounties are paid only in resolution.
  refreshRestored(s, false);
  return { state: s, events };
}

function setPhase(s: GameState, emit: Emit, trigger: Parameters<typeof transition>[1]): void {
  const next = transition(s.phase, trigger);
  if (next === null) throw new Error(`illegal transition ${s.phase} --${trigger}`);
  s.phase = next;
  emit({ type: 'phase:changed', phase: next });
}

/** Resolution then the next preparation (design §3.3 order). */
function endTurn(s: GameState, emit: Emit): void {
  const rng: Rng = { state: s.rng };
  const ctx: SystemContext = { s, emit, rng };

  setPhase(s, emit, 'endTurn');
  cleansingSystem(ctx);
  pollutionSystem(ctx);
  growthSystem(ctx);
  restorationSystem(ctx);
  const outcome = victorySystem(ctx);
  if (outcome) {
    s.outcome = outcome;
    s.rng = rng.state;
    setPhase(s, emit, outcome.result === 'victory' ? 'won' : 'lost');
    if (outcome.result === 'victory') emit({ type: 'game:won', turn: s.turn, score: outcome.score });
    else emit({ type: 'game:lost', turn: s.turn, reason: outcome.reason === 'collapse' ? 'collapse' : 'time' });
    return;
  }

  setPhase(s, emit, 'resolved');
  s.turn++;
  const income = economySystem(ctx);
  const { produced, curtailed, upkeep } = energySystem(ctx);
  randomEventSystem(ctx);
  s.rng = rng.state;
  emit({ type: 'turn:started', turn: s.turn, income, produced, curtailed, upkeep });
  setPhase(s, emit, 'prepared');
}
