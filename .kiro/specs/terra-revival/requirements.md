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
| Restored tile | A `soil` tile with pollution 0 that holds mature flora or a building, or a `water` tile with pollution 0. |
| Restorable tile | Any `soil`, `ruin` or `water` tile. `rock` and `stack` tiles are not counted. |
| Restoration ratio | restored tiles ÷ restorable tiles, in [0, 1]. |
| Progress | restoration ratio ÷ the difficulty's win ratio, clamped to [0, 1]. 1 means the goal is reached. |
| World stage | *Industrial Collapse* (progress < 0.45), *Transition* (0.45 ≤ progress < 0.9), *Ecological Revival* (progress ≥ 0.9). |
| Turn | One full cycle: Preparation → Action → Resolution. |
| Transaction | One player action with a unique id, applied at most once. |
| Forecast | The exact result of the coming resolution, computed on a copy of the state without changing the game. |

---

## 1. Game session and turn cycle

**User story 1.** As a player, I want a clear, predictable turn cycle so that
I always know when I can act and when the world reacts.

- **R-1.1** WHEN the player starts a new game with a seed and a difficulty, THE SYSTEM SHALL generate the same map, starting resources and random-event sequence for the same seed and difficulty (determinism).
- **R-1.2** THE SYSTEM SHALL model each turn as the finite state machine `preparation → action → resolution → preparation (next turn)`, with terminal states `victory` and `defeat`.
- **R-1.3** WHEN a turn enters the `preparation` phase, THE SYSTEM SHALL, in order: increment the turn counter, credit passive Gold income, produce Energy and pay building upkeep from it, roll at most one random event, and then enter the `action` phase. A new game starts in turn 1's `action` phase with the starting resources.
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
- **R-2.7** THE SYSTEM SHALL group the action palette by purpose (Restore, Plant, Build, Manage) under visible headings, and WHEN a tutorial step asks for a specific action, THE SYSTEM SHALL mark that action with a dashed outline and scroll it into view inside the palette without scrolling the page.
- **R-2.8** WHERE the pointer is touch or pen AND a tool is selected, WHEN the player taps a tile other than the cursor tile, THE SYSTEM SHALL only move the cursor there and show the preview and reason; WHEN the player taps the cursor tile again, THE SYSTEM SHALL apply the action (tap to preview, tap again to act).

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
- **R-5.9** WHEN a turn enters `preparation`, THE SYSTEM SHALL pay upkeep for enabled buildings in ascending entity order from stored Energy plus this turn's production; IF that pool is insufficient for a building's upkeep, THEN THE SYSTEM SHALL mark that building unpowered for the turn instead of letting Energy go negative.

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
- **R-9.3** WHERE the difficulty allows collapse, IF the average pollution of restorable tiles is at or above the starting average plus the difficulty's collapse margin at the end of 3 consecutive resolutions, THEN THE SYSTEM SHALL enter `defeat` with reason `collapse`.
- **R-9.4** WHERE the difficulty is `gentle`, THE SYSTEM SHALL have no turn limit and no collapse, so young players cannot lose.
- **R-9.5** THE SYSTEM SHALL keep the balanced difficulty winnable: a scripted greedy strategy SHALL win on a set of fixed seeds within the turn limit, and a passive strategy SHALL NOT win (macro-balance regression test).

## 10. Persistence

- **R-10.1** WHEN a game starts, an action is applied, an action is undone or a turn enters the `action` phase, THE SYSTEM SHALL autosave the game state to browser storage.
- **R-10.2** WHEN the player chooses Continue, THE SYSTEM SHALL restore the saved state exactly (a save→load round trip is lossless).
- **R-10.3** IF browser storage is unavailable or the save is corrupt or from an incompatible version, THEN THE SYSTEM SHALL keep running, hide Continue and not crash.
- **R-10.4** THE SYSTEM SHALL persist settings (language, scale, contrast, motion, sound, music, key bindings) and unlocked achievements separately from the game save.
- **R-10.5** WHEN a resolution ends, THE SYSTEM SHALL append the resolved turn, the restoration ratio and the average pollution to the game's history; a new game SHALL start with one history point for turn 0.
- **R-10.6** IF a save of the previous compatible version (version 1) is loaded, THEN THE SYSTEM SHALL migrate it to the current version (with a one-point history) instead of discarding it.
- **R-10.7** WHEN a game ends, THE SYSTEM SHALL update the local records of its difficulty (games played, wins, best Harmony score of a win, fewest turns to win), show them in the New game dialog, and say on the end screen when a record was beaten.

## 11. Presentation, narrative and feedback

- **R-11.1** THE SYSTEM SHALL render tiles and objects as crisp pixel art (no smoothing) from a restricted palette that uses hue shifting for shadows and highlights.
- **R-11.2** THE SYSTEM SHALL blend the world palette from *Cyberpunk Chrome* to *Autumn Harvest* to *Spring Blossom* by progress toward the goal: Chrome at progress 0, Autumn at 0.45, Spring from 0.9, so that every victory, on every difficulty, ends in full Spring Blossom.
- **R-11.3** WHEN any game event happens, THE SYSTEM SHALL publish it on an event bus; the HUD, event log, audio and achievements SHALL react only through subscriptions, never by being called from game logic.
- **R-11.4** THE SYSTEM SHALL show an opening story, a step-by-step tutorial for the first turns that can be skipped, and Guardian's journal entries at milestones.
- **R-11.5** THE SYSTEM SHALL unlock achievements (e.g. First Sprout, Sun Catcher, Stack Sealed, Clean Waters, Forest Guardian) and show them in the menu.
- **R-11.6** WHERE sound is enabled, THE SYSTEM SHALL play short synthesized cues for key events.
- **R-11.7** WHERE reduced motion is off, THE SYSTEM SHALL show ambient particles that mirror the ecosystem (smog rising from unsealed stacks, pollen drifting over restored tiles), short bursts for salvage, cleanup, planting, growth, restoration and sealing, and a petal shower at milestones and on victory. Particles SHALL live on a separate layer that never receives input, and no more than 240 SHALL exist at once.
- **R-11.8** WHILE a tool is selected, THE SYSTEM SHALL preview it on the tile under the cursor: the translucent building or seedling it would add when the action is allowed, and a badge that is a green check when allowed and a red cross when not (shape and color, R-13.2).
- **R-11.9** WHEN a saved game is continued, THE SYSTEM SHALL greet the Guardian in the chronicle with the current turn instead of reporting a turn's income.
- **R-11.10** WHILE the game is in the `action` phase with no Energy left, THE SYSTEM SHALL mark the End turn button with a soft glow, or a static ring when reduced motion is on.
- **R-11.11** THE SYSTEM SHALL open with a title diorama that tells the arc of the game from left to right (toxic stack and ruin → sealer and scrubber → solar and wind → grass, shrub and trees) over ground that blends the three world palettes.
- **R-11.12** WHEN progress crosses a world-stage boundary (Industrial Collapse → Transition at 0.45, Transition → Ecological Revival at 0.9), THE SYSTEM SHALL announce the new stage with a banner over the map, a chronicle entry and a screen-reader announcement.
- **R-11.13** THE SYSTEM SHALL draw every plant in three growth stages — seedling (growth below one third of its maturation time), young, and mature — so growth is visible every turn, and the inspector SHALL name the stage and the turns left until maturity.
- **R-11.14** THE SYSTEM SHALL draw banks where water meets land: a light foam edge on the water side and a dark wet edge on the land side.
- **R-11.15** WHERE reduced motion is off, THE SYSTEM SHALL show ambient life that grows with the ecosystem: butterflies around mature shrubs and trees, birds crossing the valley once progress reaches 0.25, and glints on clean water.
- **R-11.16** WHERE reduced motion is off, WHEN a random event happens, THE SYSTEM SHALL show it as weather: acid-rain streaks with a violet dimming and splashes on the tiles it hit, a warm glow with rising motes on a sunny day, a swarm of butterflies for pollinators, and gold sparks at the Sanctuary for a scrap caravan.
- **R-11.17** WHERE reduced motion is off, WHEN a turn resolves, THE SYSTEM SHALL show cause and effect on the map: a solid cyan square wave from every working scrubber and purifier out to its radius, followed by a dashed red wave from every unsealed stack out to three tiles (cleansing before emission, R-6.6).
- **R-11.18** WHERE music is enabled, THE SYSTEM SHALL play a quiet generative soundtrack whose harmony follows the world stage (a low minor drone in Industrial Collapse, warm modal pads in Transition, bright major-pentatonic pads and bells in Ecological Revival), crossfading when the stage changes and pausing while the page is hidden. Music SHALL be a setting separate from sound effects.
- **R-11.19** WHEN a new turn starts, THE SYSTEM SHALL show next to Gold, Energy, restoration and average pollution how much each changed since the previous turn, with an up or down arrow and a good or bad color, until the next action or for 6 seconds.
- **R-11.20** WHEN a game ends, and in the Journal, THE SYSTEM SHALL show a chart of restoration and average pollution per turn together with the goal line, telling the lines apart by style (solid, dashed, dotted) and a text legend as well as by color, with a text summary for screen readers and the world seed.

## 12. Localization

- **R-12.1** THE SYSTEM SHALL use English as the primary language and provide complete Uzbek (Latin script), Uzbek (Cyrillic script) and Russian translations.
- **R-12.2** WHEN the player switches language, THE SYSTEM SHALL re-render every visible text immediately without restarting the game.
- **R-12.3** THE SYSTEM SHALL fail the build (type check) if any English string key is missing from the Uzbek or Russian dictionary.
- **R-12.4** THE SYSTEM SHALL derive Uzbek Cyrillic from the Uzbek Latin dictionary by rule-based transliteration (o'→ў, g'→ғ, sh→ш, ch→ч, yo/yu/ya/ye→ё/ю/я/е, word-initial e→э, q→қ, h→ҳ, x→х, the tutuq belgisi ' → ъ), leaving placeholders, key names and the brand name untouched, so both scripts can never drift apart.
- **R-12.5** WHEN the game starts for the first time, THE SYSTEM SHALL choose the language from the browser (Uzbek Cyrillic, Uzbek, Russian, otherwise English); the language button SHALL cycle through all four languages and the Settings list SHALL name each language in its own script.

## 13. Non-functional: accessibility and cognitive openness

- **R-13.1** THE SYSTEM SHALL give all HUD body text a contrast ratio of at least 4.5 : 1 and large UI elements and meaningful graphics at least 3 : 1 against their backgrounds, in both default and high-contrast themes; this SHALL be verified by an automated test over the theme tokens.
- **R-13.2** THE SYSTEM SHALL never use color as the only carrier of state: pollution bands use hatch patterns and glyphs, building state uses icons, resources carry text labels, and tool availability carries a text reason.
- **R-13.3** WHERE the player changes UI scale (100 %–200 %), THE SYSTEM SHALL scale the HUD text and controls without clipping or horizontal page scroll.
- **R-13.4** WHERE reduced motion is enabled (default: follows the OS `prefers-reduced-motion`), THE SYSTEM SHALL disable camera shake and non-essential animations.
- **R-13.5** THE SYSTEM SHALL let the player remap every keyboard control and SHALL reject a binding that conflicts with another action.
- **R-13.6** THE SYSTEM SHALL announce the result of each action and each turn summary through an ARIA live region for screen readers.
- **R-13.7** THE SYSTEM SHALL keep a clear visual hierarchy: resources top, map centre, tools and inspector at the side, log at the bottom; no decorative element may overlap information.
- **R-13.8** THE SYSTEM SHALL provide visible keyboard focus indicators on every interactive control.
- **R-13.9** THE SYSTEM SHALL draw every interface icon (buttons, reasons, log marks, inspector states, achievements, arrow key caps) from its own pixel icon set colored by the surrounding text, and SHALL NOT depend on emoji or symbol fonts that may be missing on the player's system.
- **R-13.10** WHEN tutorial tips or achievement toasts are shown, THE SYSTEM SHALL place them outside the map (tips docked above the action palette, toasts in a bottom corner) so they never cover map tiles or the top-bar controls.
- **R-13.11** WHEN a dialog opens, THE SYSTEM SHALL move focus to its most meaningful control: the selected option, else an explicitly marked field, else the primary action.
- **R-13.12** THE SYSTEM SHALL offer map lenses, switched by a control next to the map and by a key (default L): *Normal*; *Pollution* — the pollution value of every polluted restorable tile in a pixel font on a dark backing, plus the reach of every unsealed stack; *Restoration* — on every restorable tile a mark for what it still needs: restored (check), plant here (sprout), turns until its plant matures (number), needs cleaning (cross); tiles that never count are dimmed.
- **R-13.13** WHEN the player asks for a hint (button or key, default H), THE SYSTEM SHALL give one piece of advice in words, chosen in this order: a plant that will wither this turn and how to help it; no Energy left, so end the turn; the move the scripted strategy of R-9.5 would make next; otherwise end the turn. WHERE the advice names a move, a "Show me" control SHALL select that tool and move the cursor to that tile without acting, and the tile SHALL be outlined on the map until the player acts or closes the hint. Every suggested move SHALL be legal at that moment.
- **R-13.14** WHILE the game is in the `action` phase, THE SYSTEM SHALL show the forecast of the coming resolution: a warning badge on every plant that will wither and a line in the inspector saying why, every tile's pollution after the resolution in the inspector, the forecast restoration on the progress bar, and on End turn the number of plants that will wither, a star when ending the turn wins, and a "last turn" mark when the turn limit is reached.

## 14. Non-functional: quality and architecture

- **R-14.1** THE SYSTEM SHALL keep game logic in a pure TypeScript core with no DOM or Canvas dependency, structured as Entity-Component-System with an event bus.
- **R-14.2** THE SYSTEM SHALL expose game progression only through the pure reducer `applyAction(state, action) → { state, events }` which does not mutate its input.
- **R-14.3** THE SYSTEM SHALL verify the economy invariants (R-3.9–R-3.11) with property-based tests using fast-check over random action and event sequences.
- **R-14.4** THE SYSTEM SHALL compile under TypeScript `strict` mode with zero errors and pass all tests before release.
- **R-14.5** THE SYSTEM SHALL render the map at 60 fps on a mid-range laptop by redrawing only when state, cursor or animation changes, and SHALL run the particle layer at no more than 30 fps and only while particles or ambient sources exist.
- **R-14.6** THE SYSTEM SHALL work in current desktop and mobile browsers at viewport widths down to 360 px.
- **R-14.7** THE SYSTEM SHALL be installable as a Progressive Web App (a manifest with 192 px and 512 px icons, one of them maskable) and SHALL keep working offline after the first visit, through a service worker that serves page navigations network-first and other same-origin files cache-first; the service worker SHALL be registered only in production builds.
- **R-14.8** THE SYSTEM SHALL compute the forecast (R-13.14) by running the very function End turn uses for the resolution on a copy of the state, and SHALL prove with property-based tests that the forecast equals the real resolution for random reachable states and that every hint (R-13.13) is a legal move.
