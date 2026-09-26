# Terra Revival: Requirements

> Phase 1 of the Spec-Driven Development (SDD) flow. Every requirement uses
> EARS notation (Easy Approach to Requirements Syntax):
>
> - **Ubiquitous:** THE SYSTEM SHALL ...
> - **Event-driven:** WHEN <trigger>, THE SYSTEM SHALL ...
> - **State-driven:** WHILE <state>, THE SYSTEM SHALL ...
> - **Unwanted behaviour:** IF <condition>, THEN THE SYSTEM SHALL ...
> - **Optional feature:** WHERE <feature is enabled>, THE SYSTEM SHALL ...
>
> Requirement ids (`R-x.y`) are referenced by `design.md` and `tasks.md`.
> Numeric values in angle brackets such as `⟨C_build⟩` are defined exactly in
> `design.md` §4 (Economy formulas).

## 0. Vision

**Terra Revival** is a turn-based, top-down 2D pixel-art strategy game about
healing, not conquest. The player is the *Guardian* of a wasteland poisoned by
a collapsed industry. They salvage toxic ruins for **Gold**, spend **Energy**
(a per-turn action budget) to build clean infrastructure, cleanse soil and
water, plant flora and watch an ecosystem return. The palette moves from
*Cyberpunk Chrome* (crisis) through *Autumn Harvest* (transition) to *Spring
Blossom* (recovery) as the land heals. The game suits all ages: calm pacing,
clear feedback, no violence.

Glossary:

| Term | Meaning |
|---|---|
| Tile | One cell of the rectangular grid. Has a terrain and a pollution level 0–100. |
| Terrain | `soil`, `water`, `rock`, `ruin` (salvageable scrap), `stack` (toxic smokestack). |
| Pollution band | `toxic` (61–100), `polluted` (21–60), `recovering` (1–20), `clean` (0). |
| Flora | A plant on a tile: `grass`, `shrub` or `tree`, growing from seedling to mature. |
| Restored tile | A land tile with pollution 0 and mature flora, or a water tile with pollution 0. |
| Restorable tile | Any `soil`, `ruin` or `water` tile. `rock` and `stack` tiles are not counted. |
| Restoration ratio | restored tiles ÷ restorable tiles, in [0, 1]. |
| Turn | One full cycle: Preparation → Action → Resolution. |
| Transaction | One player action with a unique id, applied at most once. |

---

## 1. Game session and turn cycle

**User story 1.** As a player, I want a clear, predictable turn cycle so that
I always know when I can act and when the world reacts.

- **R-1.1** WHEN the player starts a new game with a seed and a difficulty, THE SYSTEM SHALL generate the same map, starting resources and random-event sequence for the same seed and difficulty (determinism).
- **R-1.2** THE SYSTEM SHALL model each turn as the finite state machine `preparation → action → resolution → preparation (next turn)`, with terminal states `victory` and `defeat`.
- **R-1.3** WHEN a turn enters the `preparation` phase, THE SYSTEM SHALL, in order: increment the turn counter, credit passive Gold income, produce Energy, charge building upkeep, roll at most one random event, and then enter the `action` phase.
- **R-1.4** WHILE the game is in the `action` phase, THE SYSTEM SHALL accept player actions and SHALL NOT advance time until the player ends the turn.
- **R-1.5** WHEN the player ends the turn, THE SYSTEM SHALL enter `resolution`, apply cleansing, pollution emission, flora growth, flora death and flora spread, evaluate restoration and milestones, evaluate victory and defeat, and then start the next `preparation` phase unless a terminal state was reached.
- **R-1.6** IF an action or phase trigger is not allowed in the current phase, THEN THE SYSTEM SHALL reject it, leave the state unchanged and emit an `action:rejected` event with a reason code.
- **R-1.7** WHILE the game is in a terminal state, THE SYSTEM SHALL reject every action except starting a new game.
- **R-1.8** WHEN the player undoes an action during the `action` phase, THE SYSTEM SHALL restore the exact state before that action; undo SHALL NOT cross a turn boundary.

## 2. Grid interaction

**User story 2.** As a player, I want to inspect and act on individual tiles
with mouse, touch or keyboard.

- **R-2.1** THE SYSTEM SHALL present the world as a rectangular top-down tile grid (default 16 × 12).
- **R-2.2** WHEN the player hovers, taps or moves the keyboard cursor onto a tile, THE SYSTEM SHALL show that tile's terrain, pollution value and band, flora (species, growth stage), building (type, level, active state) and restoration status in the inspector panel.
- **R-2.3** WHEN the player selects a tool and activates a tile, THE SYSTEM SHALL validate the matching action and either apply it or show the rejection reason next to the tool.
- **R-2.4** THE SYSTEM SHALL show, for every tool, its Gold cost and Energy cost for the selected tile before the player confirms, and SHALL mark tools the player cannot afford or cannot use on that tile as disabled, with a text reason.
- **R-2.5** IF the player targets a coordinate outside the grid, THEN THE SYSTEM SHALL reject the action with reason `out_of_bounds`.
- **R-2.6** THE SYSTEM SHALL allow the full game to be played with the keyboard alone (cursor movement, tool selection, activation, end turn, undo, menus).

## 3. Resources: Gold and Energy

**User story 3.** As a player, I want two understandable resources whose
growth feels fair: Gold for building, Energy for acting.

- **R-3.1** THE SYSTEM SHALL track Gold as a non-negative integer balance together with lifetime totals `earned` and `spent`.
- **R-3.2** THE SYSTEM SHALL track Energy as a non-negative integer `current` together with lifetime totals `produced` and `consumed` and an informational `curtailed` total.
- **R-3.3** WHEN a turn enters `preparation`, THE SYSTEM SHALL credit Gold income that grows linearly with the total level of Recyclers ⟨I_gold⟩.
- **R-3.4** WHEN a turn enters `preparation`, THE SYSTEM SHALL produce Energy equal to base regeneration plus the output of every powered producer, and SHALL add only the part that fits under the energy capacity; the rest SHALL be recorded as `curtailed` and SHALL NOT count as produced.
- **R-3.5** THE SYSTEM SHALL cap maximum Energy capacity with a logarithmic function of the total Battery level ⟨E_max⟩.
- **R-3.6** IF an action's Gold cost exceeds the Gold balance, THEN THE SYSTEM SHALL reject it with reason `insufficient_gold` and SHALL NOT change any balance.
- **R-3.7** IF an action's Energy cost exceeds current Energy, THEN THE SYSTEM SHALL reject it with reason `insufficient_energy` and SHALL NOT change any balance.
- **R-3.8** WHEN an action is applied, THE SYSTEM SHALL debit its Gold and Energy costs atomically: either both are debited and the effect applies, or nothing changes.
- **R-3.9** IF a transaction id has already been applied, THEN THE SYSTEM SHALL ignore the repeated transaction without changing any state (idempotency).
- **R-3.10** THE SYSTEM SHALL guarantee at all times: `gold.spent + gold.balance = gold.earned` and `energy.consumed + energy.current = energy.produced` (conservation).
- **R-3.11** THE SYSTEM SHALL guarantee at all times that Gold and Energy balances are never negative, for any order of actions and events.
- **R-3.12** THE SYSTEM SHALL keep a base Gold income and a base Energy regeneration greater than zero and a manual cleanup action that costs no Gold, so that a player can never be permanently stuck (no softlock).

## 4. Salvage

**User story 4.** As a player, I want to recycle toxic ruins into Gold, so
that cleaning up the past funds the future.

- **R-4.1** WHEN the player salvages a `ruin` tile that has scrap remaining and has at least ⟨E_salvage⟩ Energy, THE SYSTEM SHALL debit the Energy, credit Gold equal to the linear yield ⟨G_salvage⟩ and decrement the tile's scrap by one.
- **R-4.2** WHEN a ruin's scrap reaches zero, THE SYSTEM SHALL convert the tile to `soil`, keeping its pollution value.
- **R-4.3** IF the player salvages a tile that is not a `ruin`, THEN THE SYSTEM SHALL reject the action with reason `invalid_target`.

## 5. Building placement and upgrades

**User story 5.** As a player, I want to build and upgrade clean
infrastructure, with costs that grow steeply so every upgrade is a decision.

Buildings: Solar Panel, Wind Turbine, Soil Scrubber, Water Purifier,
Recycler, Battery, Stack Sealer. The Sanctuary (starting hub) is pre-placed
and cannot be built, upgraded or removed.

- **R-5.1** WHEN the player places a building on a tile allowed for that building type that has no building and no flora AND has enough Gold and Energy, THE SYSTEM SHALL debit the build cost ⟨C_build⟩ and ⟨E_build⟩ Energy and create the building at level 1.
- **R-5.2** THE SYSTEM SHALL enforce placement rules: Solar Panel, Soil Scrubber, Recycler and Battery on `soil`; Wind Turbine on `rock`; Water Purifier on `water`; Stack Sealer on an unsealed `stack`.
- **R-5.3** IF the target tile is occupied, is the wrong terrain or the building type is not placeable there, THEN THE SYSTEM SHALL reject the action with reason `occupied` or `invalid_terrain`.
- **R-5.4** WHEN the player upgrades a building below its maximum level AND has enough Gold and Energy, THE SYSTEM SHALL debit the exponential upgrade cost ⟨C_upgrade⟩ and ⟨E_upgrade⟩ Energy and increase the level by one.
- **R-5.5** IF the building is at its maximum level, THEN THE SYSTEM SHALL reject the upgrade with reason `max_level`.
- **R-5.6** WHEN a Stack Sealer is placed, THE SYSTEM SHALL mark the stack as sealed so it stops emitting pollution from the next resolution onward.
- **R-5.7** WHEN the player demolishes a building they built, THE SYSTEM SHALL remove it and credit a refund of ⌊50 %⌋ of the Gold spent on it as new earned Gold.
- **R-5.8** WHEN the player toggles a building with upkeep, THE SYSTEM SHALL switch it between enabled and disabled; disabled buildings pay no upkeep and have no effect.
- **R-5.9** WHEN a turn enters `preparation`, THE SYSTEM SHALL charge upkeep for enabled buildings in ascending entity order; IF Energy is insufficient for a building's upkeep, THEN THE SYSTEM SHALL mark that building unpowered for the turn instead of letting Energy go negative.

## 6. Pollution and cleansing

**User story 6.** As a player, I want pollution to behave like a living
threat that spreads from its sources and can be pushed back.

- **R-6.1** THE SYSTEM SHALL keep every tile's pollution as an integer clamped to [0, 100].
- **R-6.2** WHEN resolution runs, THE SYSTEM SHALL let every unsealed stack emit pollution to tiles within Chebyshev distance 3 with a falloff ⟨P_emit⟩.
- **R-6.3** WHEN resolution runs, THE SYSTEM SHALL let every powered Soil Scrubber and Water Purifier reduce pollution on its tile and on tiles within its radius by the logarithmic cleansing power ⟨K_clean⟩.
- **R-6.4** WHEN resolution runs, THE SYSTEM SHALL let every mature plant reduce its own tile's pollution by its bioremediation value.
- **R-6.5** WHEN the player performs a manual cleanup on a tile, THE SYSTEM SHALL debit ⟨E_cleanup⟩ Energy and reduce that tile's pollution by ⟨K_manual⟩, costing no Gold.
- **R-6.6** THE SYSTEM SHALL apply cleansing before emission within one resolution, so a scrubber placed next to a stack gives visible progress.

## 7. Flora and restoration

**User story 7.** As a player, I want to plant and nurture life that grows,
spreads and dies when conditions are wrong.

- **R-7.1** WHEN the player plants a species on an empty `soil` tile whose pollution is at or below that species' tolerance AND has enough Gold and Energy, THE SYSTEM SHALL debit the costs and create a seedling.
- **R-7.2** IF the tile's pollution exceeds the species tolerance, THEN THE SYSTEM SHALL reject the planting with reason `too_polluted`.
- **R-7.3** WHEN resolution runs, THE SYSTEM SHALL advance each living plant's growth by one, or by two when it is orthogonally adjacent to clean water, and SHALL mark it mature once growth reaches the species' maturation time.
- **R-7.4** IF a plant's tile pollution exceeds the species' withering threshold during resolution, THEN THE SYSTEM SHALL remove the plant and emit `flora:withered`.
- **R-7.5** WHEN resolution runs, THE SYSTEM SHALL give each mature grass or shrub a chance to seed an empty adjacent clean-enough soil tile, with probability following the logistic S-curve ⟨p_spread⟩ of the current restoration ratio.
- **R-7.6** WHEN a tile becomes restored for the first time, THE SYSTEM SHALL credit the restoration bounty ⟨G_restore⟩ exactly once for that tile and emit `tile:restored`.
- **R-7.7** WHEN the restoration ratio first reaches each milestone (10 %, 25 %, 50 %, 75 %), THE SYSTEM SHALL credit the milestone reward ⟨G_milestone⟩ exactly once, add a Guardian's journal entry and emit `ecosystem:milestone` (the `EV_ECOSYSTEM_RESTORED` event).

## 8. Random events

**User story 8.** As a player, I want occasional surprises that keep each
game fresh without feeling unfair.

- **R-8.1** WHEN a turn enters `preparation` from turn 3 onward, THE SYSTEM SHALL roll one seeded random event with the fixed probability and weights defined in the design (Acid Rain, Scrap Caravan, Pollinators, Sunny Day).
- **R-8.2** THE SYSTEM SHALL document the expected Gold and Energy value of the random events per turn.
- **R-8.3** THE SYSTEM SHALL route every random-event effect through the same ledger operations as player actions, so all invariants in R-3.10 and R-3.11 hold.

## 9. Victory and defeat

**User story 9.** As a player, I want a clear goal and fair failure
conditions that match the chosen difficulty.

- **R-9.1** WHEN resolution ends with the restoration ratio at or above the difficulty's win threshold, THE SYSTEM SHALL enter `victory` and show a summary (turns, restored tiles, flora, Gold earned, Harmony score).
- **R-9.2** WHERE the difficulty has a turn limit, WHEN resolution ends on the last allowed turn without victory, THE SYSTEM SHALL enter `defeat` with reason `time`.
- **R-9.3** WHERE the difficulty allows collapse, IF the average pollution of restorable tiles is at or above the collapse threshold at the end of 3 consecutive resolutions, THEN THE SYSTEM SHALL enter `defeat` with reason `collapse`.
- **R-9.4** WHERE the difficulty is `gentle`, THE SYSTEM SHALL have no turn limit and no collapse, so young players cannot lose.
- **R-9.5** THE SYSTEM SHALL keep the balanced difficulty winnable: a scripted greedy strategy SHALL win on a set of fixed seeds within the turn limit, and a passive strategy SHALL NOT win (macro-balance regression test).

## 10. Persistence

- **R-10.1** WHEN a turn enters the `action` phase, THE SYSTEM SHALL autosave the game state to browser storage.
- **R-10.2** WHEN the player chooses Continue, THE SYSTEM SHALL restore the saved state exactly (a save→load round trip is lossless).
- **R-10.3** IF browser storage is unavailable or the save is corrupt or from an incompatible version, THEN THE SYSTEM SHALL keep running, hide Continue and not crash.
- **R-10.4** THE SYSTEM SHALL persist settings (language, scale, contrast, motion, sound, key bindings) and unlocked achievements separately from the game save.

## 11. Presentation, narrative and feedback

- **R-11.1** THE SYSTEM SHALL render tiles and objects as crisp pixel art (no smoothing) from a restricted palette that uses hue shifting for shadows and highlights.
- **R-11.2** THE SYSTEM SHALL blend the world palette from *Cyberpunk Chrome* to *Autumn Harvest* to *Spring Blossom* as the restoration ratio grows.
- **R-11.3** WHEN any game event happens, THE SYSTEM SHALL publish it on an event bus; the HUD, event log, audio and achievements SHALL react only through subscriptions, never by being called from game logic.
- **R-11.4** THE SYSTEM SHALL show an opening story, a step-by-step tutorial for the first turns that can be skipped, and Guardian's journal entries at milestones.
- **R-11.5** THE SYSTEM SHALL unlock achievements (e.g. First Sprout, Sun Catcher, Stack Sealed, Clean Waters, Forest Guardian) and show them in the menu.
- **R-11.6** WHERE sound is enabled, THE SYSTEM SHALL play short synthesized cues for key events.

## 12. Localization

- **R-12.1** THE SYSTEM SHALL use English as the primary language and provide a complete Uzbek (Latin script) translation.
- **R-12.2** WHEN the player switches language, THE SYSTEM SHALL re-render every visible text immediately without restarting the game.
- **R-12.3** THE SYSTEM SHALL fail the build (type check) if any English string key is missing from the Uzbek dictionary.

## 13. Non-functional: accessibility and cognitive openness

- **R-13.1** THE SYSTEM SHALL give all HUD body text a contrast ratio of at least 4.5 : 1 and large UI elements and meaningful graphics at least 3 : 1 against their backgrounds, in both default and high-contrast themes; this SHALL be verified by an automated test over the theme tokens.
- **R-13.2** THE SYSTEM SHALL never use color as the only carrier of state: pollution bands use hatch patterns and glyphs, building state uses icons, resources carry text labels, and tool availability carries a text reason.
- **R-13.3** WHERE the player changes UI scale (100 %–200 %), THE SYSTEM SHALL scale the HUD text and controls without clipping or horizontal page scroll.
- **R-13.4** WHERE reduced motion is enabled (default: follows the OS `prefers-reduced-motion`), THE SYSTEM SHALL disable camera shake and non-essential animations.
- **R-13.5** THE SYSTEM SHALL let the player remap every keyboard control and SHALL reject a binding that conflicts with another action.
- **R-13.6** THE SYSTEM SHALL announce the result of each action and each turn summary through an ARIA live region for screen readers.
- **R-13.7** THE SYSTEM SHALL keep a clear visual hierarchy: resources top, map centre, tools and inspector at the side, log at the bottom; no decorative element may overlap information.
- **R-13.8** THE SYSTEM SHALL provide visible keyboard focus indicators on every interactive control.

## 14. Non-functional: quality and architecture

- **R-14.1** THE SYSTEM SHALL keep game logic in a pure TypeScript core with no DOM or Canvas dependency, structured as Entity-Component-System with an event bus.
- **R-14.2** THE SYSTEM SHALL expose game progression only through the pure reducer `applyAction(state, action) → { state, events }` which does not mutate its input.
- **R-14.3** THE SYSTEM SHALL verify the economy invariants (R-3.9–R-3.11) with property-based tests using fast-check over random action and event sequences.
- **R-14.4** THE SYSTEM SHALL compile under TypeScript `strict` mode with zero errors and pass all tests before release.
- **R-14.5** THE SYSTEM SHALL render the map at 60 fps on a mid-range laptop by redrawing only when state, cursor or animation changes.
- **R-14.6** THE SYSTEM SHALL work in current desktop and mobile browsers at viewport widths down to 360 px.
