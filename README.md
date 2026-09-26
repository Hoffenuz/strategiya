# Terra Revival

**English** · [O'zbekcha](#terra-revival-ozbekcha)

A calm, turn-based 2D pixel-art strategy game about healing, not conquest.
You are the Guardian of the last Sanctuary in a valley poisoned by a dead
industry. Salvage toxic ruins for **Gold**, spend **Energy** to build clean
infrastructure, seal the smoking stacks, cleanse soil and water, and plant
life back into the land. The world's colors move from *Cyberpunk Chrome*
through *Autumn Harvest* to *Spring Blossom* as it heals.

The game is fully playable in **English** and **Uzbek**, with keyboard-only
controls, high-contrast mode, UI scaling up to 200 %, reduced motion and
colour-blind-safe patterns.

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

`npm run build` writes a static site to `dist/` (works from any folder or
GitHub Pages; see `.github/workflows/pages.yml`).

### How to play

| | |
|---|---|
| **Goal** | Restore the share of land shown in the top bar (55 % Gentle, 65 % Balanced, 70 % Hard). A soil tile is restored when its pollution is 0 and it holds a grown plant or a building; clean water counts too. |
| **Turn** | Preparation (income, energy, events) → Action (you play) → Resolution (cleansing, pollution, growth). |
| **Gold** | Salvage ruins, build Recyclers, earn a bounty for every restored tile and each milestone. |
| **Energy** | Every action costs Energy. It refills each turn from the Sanctuary, Solar Panels and Wind Turbines, up to a capacity that Batteries raise (with diminishing returns). |
| **Pollution** | Unsealed stacks spread pollution every turn. Seal them (45 Gold), then clean with Soil Scrubbers, Water Purifiers, plants or by hand. |
| **Difficulty** | Gentle has no way to lose. Balanced and Hard have a turn limit and can collapse if pollution rises well above where it started. |

Controls: click or tap a tool, then a tile. Keyboard: arrows move, `1`–`9`
choose a tool, `[` `]` cycle tools, `Enter` acts, `E` ends the turn, `Z`
undoes, `Esc` opens the menu. Every key can be remapped in Settings.

## Engineering

The project follows Spec-Driven Development; the specs live in
[`specs/`](specs):

- [`requirements.md`](specs/requirements.md): EARS requirements (R-x.y).
- [`design.md`](specs/design.md): ECS architecture, event bus, turn state
  machine, exact economy formulas and the property-based test strategy.
- [`tasks.md`](specs/tasks.md): dependency-ordered, TDD-first tasks in waves.

Highlights:

- `src/core` is pure TypeScript (no DOM): an Entity-Component-System world,
  isolated systems, and one pure reducer `applyAction(state, action)`.
- Economy curves: linear income `I = 2 + 4·ΣL`, exponential costs
  `⌈a·1.75^(L−1)⌉`, logarithmic energy cap `⌊6·ln(1+B) + 8⌋`, logistic
  flora spread.
- `npm test` runs unit tests, **fast-check** property tests of the economic
  invariants (energy and gold conservation, non-negativity, idempotent
  transactions, purity, determinism, lossless saves) and a macro-balance
  simulation where a scripted player must win Balanced with 10 turns to
  spare while a passive one must not.
- UI text contrast is verified against WCAG (≥ 4.5 : 1) by a test.

```bash
npm run typecheck
npm test
```

---

## Terra Revival (O'zbekcha)

Bosib olish emas, davolash haqidagi xotirjam, navbatli 2D piksel-art
strategiya o'yini. Siz zaharlangan vodiydagi so'nggi Boshpananing
Qo'riqchisisiz. Xarobalarni **Oltin**ga aylantiring, **Energiya** sarflab
toza inshootlar quring, zaharli mo'rilarni muhrlang, tuproq va suvni
tozalang, yerga hayotni qaytaring.

Ishga tushirish: `npm install`, so'ng `npm run dev`. O'yin ichida tilni
yuqoridagi **UZ / EN** tugmasi yoki Sozlamalar orqali almashtiring.
Spetsifikatsiyalar `specs/` papkasida.
