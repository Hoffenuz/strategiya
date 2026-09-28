# Structure

```
src/core     ECS world + components, systems, economy (formulas, ledger), phases,
             actions (quote + applyAction), selectors, save, sim/bot (balance bot)
src/render   palette (3 keyframes), color (WCAG, hue shift), sprites (character maps),
             renderer (map canvas), fx (particle simulation + layer)
src/ui       app (store, dispatch, undo, autosave, screens), icons, dom, settings,
             theme, achievements, audio, storage
src/i18n     en (key source), uz, index
tests        *.test.ts (unit), *.prop.test.ts (fast-check), balance.sim.test.ts
.kiro/specs/terra-revival   requirements.md (EARS), design.md, tasks.md
```

Dependency direction: `ui` → `render` → `core`; `ui` → `i18n`. Nothing imports `ui`.
