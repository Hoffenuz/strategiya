# Tech and rules

- TypeScript (`strict`), Vite, Canvas 2D, plain DOM + CSS custom properties. No runtime dependencies.
- Tests: Vitest + fast-check in `tests/` — unit tests, property tests of the economy invariants, and a macro-balance simulation.
- Commands: `npm run dev`, `npm test`, `npm run typecheck`, `npm run build` (type check + Vite build into `dist/`).
- CI: `.github/workflows/ci.yml` (type check, tests, build on every pull request); `pages.yml` deploys `main` to GitHub Pages.

Rules:

- `src/core` is pure: no DOM, Canvas, `i18n`, `ui` or `render` imports. It stays deterministic (seeded RNG, ascending entity order).
- Every Gold / Energy change goes through `src/core/economy/ledger.ts`.
- The game only advances through `applyAction(state, action) → { state, events }`, which never mutates its input.
- HUD, audio, achievements and particles react to `GameEvent`s on the bus; core never calls them.
- Balance constants live in `src/core/config.ts` and must match `design.md` §4; `tests/balance.sim.test.ts` must stay green.
- Icons come from `src/ui/icons.ts` (pixel SVG) or sprites — never emoji or Unicode symbols in the interface.
- A new string needs a key in both `src/i18n/en.ts` and `src/i18n/uz.ts` (the type check fails otherwise).
- Anything animated must honor reduced motion.
- Write the tests for a pure module before the module (TDD), as in `tasks.md`.
