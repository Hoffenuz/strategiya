import { quote, type Intent } from './actions';
import { K_MANUAL, SPECIES } from './config';
import type { BuildingType, Species } from './ecs/components';
import { get, must } from './ecs/world';
import { salvageYield } from './economy/formulas';
import { forecastResolution, type PlacedFlora, type ResolutionForecast } from './forecast';
import { occupants, tileAt } from './grid';
import { greedyIntent } from './sim/bot';
import type { GameState } from './state';

/** What a hint is about; the UI turns `id` + `params` into a sentence (R-13.13). */
export type AdviceId =
  | 'witherRisk'
  | 'noEnergy'
  | 'seal'
  | 'energy'
  | 'battery'
  | 'recycler'
  | 'scrubber'
  | 'purifier'
  | 'salvage'
  | 'plant'
  | 'cleanup'
  | 'upgrade'
  | 'relocate'
  | 'toggle'
  | 'endTurn';

export interface AdviceParams {
  species?: Species;
  building?: BuildingType;
  /** Pollution of the tile now. */
  pollution?: number;
  /** Pollution of the tile after the coming resolution. */
  after?: number;
  /** Withering threshold of the species. */
  limit?: number;
  gold?: number;
  /** How many plants will wither. */
  count?: number;
}

export interface Advice {
  id: AdviceId;
  /** A legal move for "Show me", or null when the advice is to end the turn or informational. */
  intent: Intent | null;
  at: { x: number; y: number } | null;
  params: AdviceParams;
}

const END_TURN: Advice = { id: 'endTurn', intent: null, at: null, params: {} };

function buildingTypeAt(s: GameState, x: number, y: number): BuildingType | undefined {
  const e = occupants(s).building.get(y * s.width + x);
  return e === undefined ? undefined : must(s.world, e, 'Building').type;
}

/** Explains a move in terms of what it achieves. */
export function adviceFor(intent: Intent, s: GameState): Advice {
  if (intent.kind === 'endTurn') return END_TURN;
  const at = { x: intent.x, y: intent.y };
  const advice = (id: AdviceId, params: AdviceParams = {}): Advice => ({ id, intent, at, params });
  switch (intent.kind) {
    case 'build':
      switch (intent.building) {
        case 'sealer':
          return advice('seal');
        case 'solar':
        case 'wind':
          return advice('energy', { building: intent.building });
        default:
          return advice(intent.building, { building: intent.building });
      }
    case 'upgrade': {
      const building = buildingTypeAt(s, at.x, at.y);
      return building === 'battery' ? advice('battery', { building }) : advice('upgrade', building ? { building } : {});
    }
    case 'salvage': {
      const salvage = get(s.world, tileAt(s, at.x, at.y), 'Salvage');
      return advice('salvage', salvage ? { gold: salvageYield(salvage.density) } : {});
    }
    case 'plant':
      return advice('plant', { species: intent.species });
    case 'cleanup':
      return advice('cleanup', { pollution: must(s.world, tileAt(s, at.x, at.y), 'PollutionLevel').value });
    case 'demolish': {
      const building = buildingTypeAt(s, at.x, at.y);
      return advice('relocate', building ? { building } : {});
    }
    case 'toggle': {
      const building = buildingTypeAt(s, at.x, at.y);
      return advice('toggle', building ? { building } : {});
    }
  }
}

/** Among the doomed plants, the one most worth saving: savable by one cleanup, then most valuable. */
function mostWorthSaving(s: GameState, f: ResolutionForecast): PlacedFlora {
  const score = (p: PlacedFlora) => {
    const i = p.y * s.width + p.x;
    const now = must(s.world, s.tiles[i]!, 'PollutionLevel').value;
    const savable = f.pollution[i]! - Math.min(K_MANUAL, now) <= SPECIES[p.species].withers ? 100 : 0;
    return savable + SPECIES[p.species].eco;
  };
  return f.withered.reduce((best, p) => (score(p) > score(best) ? p : best));
}

/**
 * One piece of advice for the current action phase (design §3.8): a plant that will
 * wither, else no Energy, else the greedy strategy's next move, else end the turn.
 * Every move it suggests is legal (Invariant 14).
 */
export function advise(s: GameState, f: ResolutionForecast | null = forecastResolution(s)): Advice | null {
  if (s.phase !== 'action' || !f) return null;
  if (f.withered.length > 0) {
    const p = mostWorthSaving(s, f);
    const i = p.y * s.width + p.x;
    const cleanup: Intent = { kind: 'cleanup', x: p.x, y: p.y };
    return {
      id: 'witherRisk',
      intent: quote(s, cleanup).ok ? cleanup : null,
      at: { x: p.x, y: p.y },
      params: {
        species: p.species,
        pollution: must(s.world, s.tiles[i]!, 'PollutionLevel').value,
        after: f.pollution[i]!,
        limit: SPECIES[p.species].withers,
        count: f.withered.length,
      },
    };
  }
  if (s.energy.current === 0) return { id: 'noEnergy', intent: null, at: null, params: {} };
  const move = greedyIntent(s);
  return move ? adviceFor(move, s) : END_TURN;
}
