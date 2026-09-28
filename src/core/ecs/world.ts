import { COMPONENT_NAMES, type ComponentMap, type ComponentName } from './components';

export type Entity = number;

/** A serializable ECS world: entities are ids, components live in stores (design §3.1). */
export interface World {
  nextId: Entity;
  alive: Record<Entity, true>;
  c: { [K in ComponentName]: Record<Entity, ComponentMap[K]> };
}

export function createWorld(): World {
  const c = {} as World['c'];
  for (const name of COMPONENT_NAMES) (c as Record<string, unknown>)[name] = {};
  return { nextId: 1, alive: {}, c };
}

export function createEntity(world: World): Entity {
  const id = world.nextId++;
  world.alive[id] = true;
  return id;
}

export function destroyEntity(world: World, e: Entity): void {
  delete world.alive[e];
  for (const name of COMPONENT_NAMES) delete world.c[name][e];
}

export function isAlive(world: World, e: Entity): boolean {
  return world.alive[e] === true;
}

export function add<K extends ComponentName>(world: World, e: Entity, name: K, data: ComponentMap[K]): void {
  if (!isAlive(world, e)) throw new Error(`add ${name}: entity ${e} is not alive`);
  world.c[name][e] = data;
}

export function get<K extends ComponentName>(world: World, e: Entity, name: K): ComponentMap[K] | undefined {
  return world.c[name][e];
}

export function must<K extends ComponentName>(world: World, e: Entity, name: K): ComponentMap[K] {
  const v = world.c[name][e];
  if (v === undefined) throw new Error(`entity ${e} has no ${name}`);
  return v;
}

export function has(world: World, e: Entity, name: ComponentName): boolean {
  return world.c[name][e] !== undefined;
}

export function remove(world: World, e: Entity, name: ComponentName): void {
  delete world.c[name][e];
}

/** Ids of entities holding every named component, in ascending order (deterministic). */
export function query(world: World, ...names: ComponentName[]): Entity[] {
  if (names.length === 0) return Object.keys(world.alive).map(Number).sort((a, b) => a - b);
  let smallest = names[0]!;
  for (const n of names) {
    if (Object.keys(world.c[n]).length < Object.keys(world.c[smallest]).length) smallest = n;
  }
  const out: Entity[] = [];
  for (const key of Object.keys(world.c[smallest])) {
    const e = Number(key);
    if (names.every((n) => world.c[n][e] !== undefined)) out.push(e);
  }
  return out.sort((a, b) => a - b);
}
