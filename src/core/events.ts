import type { BuildingType, Species } from './ecs/components';
import type { RandomEventKind } from './config';
import type { Phase } from './phases';

export type RejectReason =
  | 'wrong_phase'
  | 'out_of_bounds'
  | 'invalid_target'
  | 'invalid_terrain'
  | 'occupied'
  | 'no_building'
  | 'max_level'
  | 'immovable'
  | 'not_toggleable'
  | 'insufficient_gold'
  | 'insufficient_energy'
  | 'too_polluted'
  | 'game_over'
  | 'already_clean';

export type GameEvent =
  | { type: 'phase:changed'; phase: Phase }
  | { type: 'turn:started'; turn: number; income: number; produced: number; curtailed: number; upkeep: number }
  | { type: 'gold:changed'; delta: number; balance: number }
  | { type: 'energy:changed'; delta: number; current: number }
  | { type: 'building:placed'; building: BuildingType; x: number; y: number }
  | { type: 'building:upgraded'; building: BuildingType; level: number; x: number; y: number }
  | { type: 'building:demolished'; building: BuildingType; refund: number; x: number; y: number }
  | { type: 'building:toggled'; building: BuildingType; enabled: boolean; x: number; y: number }
  | { type: 'building:unpowered'; building: BuildingType; x: number; y: number }
  | { type: 'tile:salvaged'; gold: number; remaining: number; x: number; y: number }
  | { type: 'tile:cleaned'; amount: number; x: number; y: number }
  | { type: 'flora:planted'; species: Species; x: number; y: number }
  | { type: 'flora:matured'; species: Species; x: number; y: number }
  | { type: 'flora:withered'; species: Species; x: number; y: number }
  | { type: 'flora:spread'; species: Species; x: number; y: number }
  | { type: 'tile:restored'; bounty: number; x: number; y: number }
  | { type: 'ecosystem:milestone'; index: number; ratio: number; reward: number }
  | { type: 'stack:sealed'; x: number; y: number }
  | { type: 'event:random'; kind: RandomEventKind; amount: number }
  | { type: 'action:rejected'; action: string; reason: RejectReason }
  | { type: 'game:won'; turn: number; score: number }
  | { type: 'game:lost'; turn: number; reason: 'time' | 'collapse' };

export type GameEventType = GameEvent['type'];
export type EventOf<T extends GameEventType> = Extract<GameEvent, { type: T }>;
export type Emit = (e: GameEvent) => void;

/** Typed publish/subscribe bus decoupling core from UI, audio and achievements (design §3.4). */
export class EventBus {
  private handlers = new Map<GameEventType, Set<(e: GameEvent) => void>>();
  private anyHandlers = new Set<(e: GameEvent) => void>();
  onError: (err: unknown) => void = (err) => console.error(err);

  on<T extends GameEventType>(type: T, fn: (e: EventOf<T>) => void): () => void {
    let set = this.handlers.get(type);
    if (!set) this.handlers.set(type, (set = new Set()));
    const h = fn as (e: GameEvent) => void;
    set.add(h);
    return () => set.delete(h);
  }

  onAny(fn: (e: GameEvent) => void): () => void {
    this.anyHandlers.add(fn);
    return () => this.anyHandlers.delete(fn);
  }

  emit(e: GameEvent): void {
    for (const h of this.handlers.get(e.type) ?? []) this.safe(h, e);
    for (const h of this.anyHandlers) this.safe(h, e);
  }

  emitAll(events: readonly GameEvent[]): void {
    for (const e of events) this.emit(e);
  }

  private safe(h: (e: GameEvent) => void, e: GameEvent): void {
    try {
      h(e);
    } catch (err) {
      this.onError(err);
    }
  }
}
