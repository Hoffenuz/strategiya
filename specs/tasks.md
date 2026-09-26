# Terra Revival: Implementation Plan

> Phase 3 of the SDD flow. Tasks are ordered by dependency and grouped into
> **Waves**: every task inside one wave depends only on earlier waves, so the
> tasks of a wave can be executed by parallel agents. Test tasks (🧪) always
> come before the logic they specify (TDD): the tests are written first,
> fail, and then the implementation task makes them pass.
>
> Each task lists the requirements it satisfies. Status: `[x]` done (all tasks
> are implemented; `npm test` runs every 🧪 suite).

## Wave 0 — Project skeleton

- [x] **T0.1** Initialise Vite + TypeScript (`strict`), Vitest, fast-check, npm scripts `dev`, `build`, `test`, `typecheck`. _(R-14.4)_
- [x] **T0.2** Folder layout from design §2; lint rule by convention: `core/` imports nothing from `ui/`, `render/`, `i18n/`. _(R-14.1)_

## Wave 1 — Independent foundations (parallel)

- [x] 🧪 **T1.1** Write unit tests for the ECS world: create/destroy entity, add/get/remove component, `query` returns ascending ids and only entities holding every component, destroy clears all stores, world survives `structuredClone`. _(R-14.1)_
- [x] **T1.2** Implement `core/ecs/world.ts` and `core/ecs/components.ts` to pass T1.1. _(depends T1.1)_
- [x] 🧪 **T1.3** Write fast-check properties for `economy/formulas.ts`: linear income additivity, exponential cost monotonicity and ratio → b, `E_max` monotone and concave, `K_clean`/`K_water` monotone and concave, `p_spread` bounded and monotone, exact table values from design §4. _(R-3.3, R-3.5, R-5.4, R-6.3, R-7.5)_
- [x] **T1.4** Implement `core/config.ts` and `core/economy/formulas.ts` to pass T1.3. _(depends T1.3)_
- [x] 🧪 **T1.5** Write tests for the seeded PRNG: same seed ⇒ same sequence, values in [0, 1), state serializable and resumable. _(R-1.1)_
- [x] **T1.6** Implement `core/rng.ts`. _(depends T1.5)_
- [x] 🧪 **T1.7** Write tests for the phase transition table: every legal pair, every illegal pair returns `null`, terminal states accept nothing. _(R-1.2, R-1.6, R-1.7)_
- [x] **T1.8** Implement `core/phases.ts`. _(depends T1.7)_
- [x] **T1.9** Implement `core/events.ts`: `GameEvent` union and typed `EventBus` with `on`, `onAny`, `off`, `emit`; test that handlers are isolated (one throwing handler does not block others). _(R-11.3)_
- [x] **T1.10** Write `i18n/en.ts` (key source) and `i18n/uz.ts` typed as `Record<keyof typeof en, string>`; test key parity and placeholder parity. _(R-12.1, R-12.3)_

## Wave 2 — Ledger and state (parallel)

- [x] 🧪 **T2.1** Write fast-check properties for the ledger **before** implementing it: any sequence of `credit`/`tryDebit`/`produceEnergy`/`tryConsumeEnergy` keeps Invariant 1 (`consumed + current = produced`), Invariant 2 (`spent + balance = earned`), Invariant 3 (balances ≥ 0) and Invariant 4 (`current ≤ max`); failed debits change nothing. _(R-3.1, R-3.2, R-3.6–R-3.11)_
- [x] **T2.2** Implement `core/economy/ledger.ts` to pass T2.1. _(depends T2.1)_
- [x] 🧪 **T2.3** Write tests for map generation: deterministic per seed, stack count per difficulty, sanctuary area clean, at least N ruins, water and rock present, every restorable tile has integer pollution in [0, 100]. _(R-1.1, R-2.1)_
- [x] **T2.4** Implement `core/map.ts` and `core/state.ts` (`createGame`, `cloneState`). _(depends T2.3, T1.2, T1.6)_

## Wave 3 — Systems (parallel: each system is isolated by the ECS)

- [x] 🧪 **T3.1** Write tests for `EconomySystem` + `EnergySystem` + `UpkeepSystem`: income = `I_gold`, production capped with curtailment, upkeep in id order, unpowered when short, energy never negative. _(R-3.3–R-3.5, R-5.9)_
- [x] **T3.2** Implement those three systems. _(depends T3.1)_
- [x] 🧪 **T3.3** Write tests for `CleansingSystem` + `PollutionSystem`: exact `K_clean` amounts by radius, water purifier medium rule, emission falloff, sealed stacks silent, clamp [0, 100], cleansing before emission. _(R-6.1–R-6.3, R-6.6)_
- [x] **T3.4** Implement those systems. _(depends T3.3)_
- [x] 🧪 **T3.5** Write tests for `GrowthSystem`: growth +1 / +2 near clean water, maturation, bioremediation, withering threshold, spread only onto valid tiles. _(R-6.4, R-7.3–R-7.5)_
- [x] **T3.6** Implement `GrowthSystem`. _(depends T3.5)_
- [x] 🧪 **T3.7** Write tests for `RestorationSystem` + `VictorySystem`: restored definition, bounty once per tile, milestones once, win threshold, time limit, collapse streak, gentle cannot lose. _(R-7.6, R-7.7, R-9.1–R-9.4)_
- [x] **T3.8** Implement those systems. _(depends T3.7)_
- [x] **T3.9** Implement `RandomEventSystem` with the weights of design §4.9, all effects through the ledger; test the empirical frequencies over many seeds. _(R-8.1–R-8.3)_

## Wave 4 — Reducer and invariants

- [x] 🧪 **T4.1** Write the fast-check arbitraries (`tests/arbitraries.ts`) and the **economy invariant suite** over random action scripts: Invariants 1–12 of design §6. Must be written before T4.2 and fail against a stub reducer. _(R-3.9–R-3.11, R-14.2, R-14.3)_
- [x] 🧪 **T4.2** Write example tests for every action's happy path and every rejection reason. _(R-4, R-5, R-6.5, R-7.1, R-7.2)_
- [x] **T4.3** Implement `core/actions.ts` (`validateAction`, `applyAction`, turn resolution) to pass T4.1 and T4.2. _(depends T4.1, T4.2, Wave 3)_
- [x] **T4.4** Implement `core/selectors.ts` (tile info, action previews with costs and reasons, restoration ratio, Harmony score). _(R-2.2, R-2.4)_
- [x] 🧪 **T4.5** Write save round-trip property and corrupt-save tests; implement `core/save.ts`. _(R-10.1–R-10.3)_

## Wave 5 — Balance simulation

- [x] 🧪 **T5.1** Write the macro-balance test: greedy bot wins *balanced* on fixed seeds within the limit; passive bot does not win; gentle passive bot never loses. _(R-9.5)_
- [x] **T5.2** Implement `core/sim/bot.ts`; tune constants in `config.ts` (and design §4) until T5.1 passes. _(depends T5.1)_

## Wave 6 — Presentation (parallel)

- [x] **T6.1** `render/palette.ts`: three keyframe palettes, interpolation by ratio, hue-shift helpers. 🧪 Contrast test for HUD theme tokens ≥ 4.5 : 1 text, ≥ 3 : 1 large. _(R-11.1, R-11.2, R-13.1)_
- [x] **T6.2** `render/sprites.ts`: character-map sprites for terrain, buildings, flora, glyphs; hatch overlays per pollution band. _(R-11.1, R-13.2)_
- [x] **T6.3** `render/renderer.ts`: canvas renderer with integer zoom, cursor, dirty-flag redraw, camera shake gated by reduced motion. _(R-14.5, R-13.4)_
- [x] **T6.4** `ui/settings.ts`: persisted settings (language, scale, contrast, motion, sound, key bindings) with conflict-checked remapping. _(R-10.4, R-13.3–R-13.5)_
- [x] **T6.5** `ui/audio.ts`: WebAudio cues subscribed to the bus. _(R-11.6)_
- [x] **T6.6** `ui/achievements.ts`: bus-driven unlocks, persisted. _(R-11.5)_

## Wave 7 — Integration

- [x] **T7.1** `ui/hud.ts` + `ui/panels.ts`: resource bar, tool palette with costs and disabled reasons, inspector, event log with ARIA live region, undo, end turn. _(R-2.2–R-2.4, R-13.6–R-13.8)_
- [x] **T7.2** `ui/menus.ts`: title screen (new game, continue, settings, how to play, achievements), story intro, tutorial steps, journal, end-of-game summary. _(R-9.1, R-11.4)_
- [x] **T7.3** `main.ts`: store, dispatch, undo stack, autosave, bus wiring, keyboard + pointer input. _(R-1.8, R-2.6, R-10.1)_
- [x] **T7.4** Responsive layout down to 360 px and scale 200 %. _(R-13.3, R-14.6)_

## Wave 8 — Verification

- [x] **T8.1** `npm run typecheck && npm test && npm run build` all green.
- [x] **T8.2** Headless browser smoke test: load, start a game, act with the keyboard, end turns, switch to Uzbek, reach the victory screen, 200 % scale and high contrast without horizontal scroll, no console errors (run with Playwright against `vite preview`, desktop and 375 px viewports).
