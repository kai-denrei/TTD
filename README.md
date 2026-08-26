# TTD — Tank Tower Defense

A mix of passive TD macro strategy with some tactical tank battle elements,
and retro/gaming homage and nostalgia for story-driven minigames.

Three layers, three tempos, and they are *supposed* to feel different:

| Layer | The player is… | Intensity comes from |
|---|---|---|
| **TD macro** | planning, reading the board, committing resources | consequence, not pressure |
| **Tank tactical** | driving, aiming, intercepting | the moment — this is where stress lives |
| **Minigames** | inside a story beat | homage, novelty, stakes |

Built on Vite 6 + TypeScript 5.7 + three.js 0.170.

---

## The `core/` purity rule

```
src/core/   pure, deterministic, Node-tested — no three.js, no DOM, no wall-clock
src/render/ three.js: board, units, effects, post-processing
src/audio/  Web Audio
src/ui/     HUD, dashboard, modals, minigame host
src/games/  embedded minigames (TRANSFER, TRACE, CONSTELLATION)
src/app/    shell, loop, input, cameras
```

**`core/` never imports three.js.** The brain is testable headless; the shell
is thin. This is the structural fix for what went wrong in the PoC (a 3,870-line
`td-tab.js` with four cp+sed siblings, no types, every constant needing a
world rebuild to tune).

Because `core/` has no renderer dependency and uses seeded RNG everywhere
(`mulberry32` streams, no `Math.random` in sim logic), the entire simulation
runs at speed in Node — which is what makes the headless sweep harness possible.

---

## Running the project

```bash
# Install dependencies
npm install

# Development server (Vite, hot reload)
npm run dev

# Type check only (tsc --noEmit)
npm run typecheck

# Node test suites (grid topology, dungeon, creatures, units — 89 tests)
npm test

# Headless tuning sweep — step a lever across N values, print telemetry table
npm run sweep enemy.speed 0.6 2.0 5
npm run sweep wave.dripRate 0.1 1.5 4

# Production build
npm run build

# Preview production build locally
npm run preview
```

### Sweep usage

```
npm run sweep <lever-key> <lo> <hi> <steps>
```

Steps the named lever from `lo` to `hi` across `steps` values, runs a fixed
scripted session (6000 ticks at 60 Hz ≈ 100 game-seconds) for each, and prints
a telemetry comparison table. Use it to answer "which of these two settings
is better" with numbers.

Example: `enemy.speed 0.6 → 2.0` shows `heartHits` rising from 0 to 24 and
`kills` falling from 72 to 52 — the entire game's pacing shifts on one lever.

---

## Docs

- `docs/00-TTD-vision.md` — design vision, lever taxonomy, milestones
- `docs/01-M0-tuning-rig-spec.md` — M0 milestone spec
- `docs/02-M0a-brain-notes.md` — M0a build notes: tick order, RNG streams, sweep outputs

---

## Predecessor

`~/Dev/spherical-stalberg-grid` — the PoC that proved the hard parts
(organic quad grid on a sphere, dungeon, dot-cloud creatures, planet tank
combat, tower/economy layer). Kept as a reference implementation; not migrated
in place.
