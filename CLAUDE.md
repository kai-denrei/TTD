# TTD — Tank Tower Defense · working notes for Claude sessions

Successor to `~/Dev/spherical-stalberg-grid` (kept as the PoC it was — reference
and diff target, never migrated in place).

Public: https://kai-denrei.github.io/TTD/ · repo `kai-denrei/TTD`
(Pages deploys from `dist/` via `.github/workflows/pages.yml`, gated on `npm test`.)

## What the game is

> **Passive TD macro strategy + tactical tank battle elements + retro/nostalgia
> story-driven minigames.**

Three layers, three tempos, deliberately different:

| Layer | Tempo | Intensity comes from |
|---|---|---|
| TD macro | slow, deliberate | consequence, not pressure |
| Tank tactical | fast, hands-on | the moment — stress lives here |
| Minigames | a held breath | homage, story, stakes |

This resolves a real tension: do **not** try to make the board itself
relentless. The board poses decisions; the tank supplies adrenaline. When
something "isn't fun", first ask whether the load is on the wrong layer.

## Orient first

- `docs/00-TTD-vision.md` — the umbrella: lever taxonomy, the **posture
  machine** (stalk/muster/avoid/flank as weights on one mind, not N features),
  the tuning rig, difficulty philosophy, milestones. §12 is the inbox for raw
  notes.
- `docs/01-M0-tuning-rig-spec.md` — M0 spec (§4 levers, §5 telemetry, §9 acceptance).
- `docs/02-M0a-brain-notes.md` — tick order, RNG streams, sweep output.
- `docs/03-braille-assets.md` — the ~150 half-dotted models in `~/Dev/Braille`
  (turrets, sentries, tower structures, shields = the force-field mechanic,
  creatures, portals) + the M0 picks and the porting plan.
- `.deban/` — decision log (decisions, **dead ends**, lessons). Read
  `_index.md` first. Gitignored: local working memory, never published. Sync
  via /deban after meaningful sessions.
- `docs/superpowers/plans/` — implementation plans, executed task-by-task.

## Hard rules

- **`src/core/` is a pure headless brain.** Never import three.js, never call
  `Math.random`, never touch the DOM or wall-clock. Time enters as `dt`.
  `src/core/architecture.test.ts` enforces this mechanically — it is not a
  convention, it is a failing test. This is the structural fix for what went
  wrong in the PoC (a 3,870-line tab with sim fused to render).
- **Determinism is a design pillar.** All randomness via `stream(seed, name)`
  from `core/sim/rng.ts`, one **named stream per system**. A shared stream means
  adding a draw in one system silently reshuffles every other, and replays stop
  matching for reasons that look like bugs elsewhere.
- **The tick order in `world.ts` is load-bearing.** Changing it invalidates the
  comparability of saved presets. It is documented at the top of the file.
- **Every lever must be live.** Read levers via `tuning.get(key)` *inside* the
  tick — never captured at construction. A lever needing a rebuild is a bug.
- **`src/core/liveness.test.ts` is the acceptance gate.** For every lever it
  runs two worlds differing only in that lever and asserts the telemetry
  differs, plus an upper-half assertion. Its exclusion sets must justify every
  entry, and the justifications must be re-verified — never add an exclusion to
  silence a failure. If a lever fails, that is a finding.
- `npm run typecheck` **and** `npm test` before every commit. Commits explain
  the why; end with the Co-Authored-By + Claude-Session trailer.
- After editing sources, `./scripts/bust.sh --quiet` bumps the cache-bust token
  (also wired into the Vite build via the `cb-bust` plugin).

## Architecture in one breath

```
src/core/     pure · Node-tested · no three.js
  sphere/     vec3 · grid (hull-as-Delaunay → merge → subdivide → relax → dual)
              dungeon (BFS carve) · cellindex (voxel collision oracle)
  sim/        rng · telemetry · critters · waves · towers · tank · world
  tuning/     schema (the single source of lever truth) · store
src/render/   three.js — board, units, postfx (bloom is foundational, not polish)
src/ui/       HUD, dashboard, modals, minigame host
src/games/    embedded minigames
src/app/      shell, loop, input, cameras
scripts/      sweep.ts — headless lever sweep
```

`makeWorld({seed, tuning})` → `.tick(dt, input)`, fully observable. The renderer
reads it; nothing in `core/` knows the renderer exists.

## Commands

```
npm run dev · build · preview · typecheck · test
npm run sweep -- enemy.speed 0.6 2.0 5      # headless lever comparison
```

**TTD owns port 5144** (dev) and **5145** (preview), pinned with `strictPort`
in `vite.config.ts`. This machine runs several projects at once and vite's
default 5173 is contested — `blueprint-to-life` holds it. Without a pinned port
you either load a different project's app at the URL you remembered, or vite
walks to 5174/5175 and the URL changes between runs. `strictPort` turns a
collision into an explicit failure rather than a surprise. 5144 pairs with the
8144 that `npm run serve` already uses for the built output.

## State

**M0a (brain), M0b (rig made visible) and M0c-1 (walls & high ground) are
complete** — 265 tests, determinism verified. `npm run dev` on **port 5144**
(pinned; vite's default 5173 is taken by another project) serves a board that
reads as a 3D maze: BLOCKED cells extrude into walls with tops and skirts,
towers build on the high ground overlooking corridors, and the tank steers
correctly.

**M0c is PoC parity in three chunks.** Chunk 1 is done. Next:
- **Chunk 2 — combat made visible.** M0b rendered state but not *events*: the
  sim resolves tower damage, kills and hits every tick and nothing draws any of
  it. Tower shots, tracers, beams, muzzle flashes, hit flashes, death bursts;
  tank aimed fire along its barrel, plus the PoC's laser heat/lockout.
- **Chunk 3 — tower roster & economy.** Types with distinct attacks, cost,
  sell, upgrade, range rings.

Economy and win condition come *after* those. Balancing what you cannot see or
steer is the mistake that started this milestone.

**The dashboard is Admin Mode — internal tooling, never shipped to players.**
Gated by `?admin=1`, backtick, or a five-tap top-left corner; `src/ui/admin/` is
a leaf nothing in `core/` or `render/` imports.

Known state when tuning — full detail in `docs/05-M0c-notes.md`:

- **`survivedFor` is the difficulty signal.** `heartHits` is not: runs truncate
  at heart death, so it saturates at the heart's 20 HP.
- **Tower placement is currently a decision with no consequence.** At default
  stats, a tower overlooking the lane versus one on a distant wall differ by 4%
  (`survivedFor` 48.33 vs 46.35). At `tower.damage=20` the same comparison is
  87.53 vs 46.35. The one-tower baseline is not merely weak — it is weak enough
  that *where you build does not matter*.
- **Three levers' observability is limited by one root cause:** the default
  tower cannot complete a kill (`tower.damage` 3 vs `enemy.hp` 5 needs two hits
  before the critter leaves range). `tower.damage`, `tank.damage` and now
  `tower.rate` all need a companion override to be testable.
- **Terrain stays under the bloom threshold** by design — bloom is for emissive
  things. The board reads by relief, not brightness.
- **Compare is a three-seed mean, not a truth.** Critters share one RNG stream.

## Lessons that must not be relearned

M0a shipped four dead or lying levers before the reviews caught them. The
distilled rules (full versions in `.deban/roles/dev.md`):

- **A parameter is not a lever until something downstream changes.** A
  module-level test can be perfectly correct about arithmetic on a value
  nothing reads (`waves.test.ts` asserted `plan.hp`, which never crossed the
  spawn seam). Only end-to-end assertions catch this.
- **A knob whose effect is an artifact is worse than a dead one** — it moves
  the numbers for the wrong reason. Twice: tower range exceeding the world's
  diameter; tank contact radius scaling with the *speed lever* and `dt` rather
  than actual displacement. Ask what physically changed.
- **Sabotage your own guard.** Break the code a test protects and confirm the
  test fails. A regression test that passes against its own bug certifies it.
- **Measure only the live game.** A sim with no terminal condition accumulates
  telemetry past death; long runs then average a real game with a post-mortem.
- **A determinism check comparing two empty outputs passes vacuously.** Assert
  the artefact is non-trivial before comparing it.

## Conventions

- Deterministic everything; no `Math.random` in sim logic.
- Port proven code, don't copy: re-type, redraw APIs, rewrite tests.
  Donors: the PoC (sphere pipeline, tanks2 for the portal dive), DeepWatch
  (`~/Documents/Dev/centroid-defense` — Web Audio stack, orbital strike, radar),
  `~/Dev/hacking-mini-games` (TRANSFER/TRACE/CONSTELLATION + the `MiniGame`
  contract; same stack, so they embed as native imports).
- Telegram the operator (see `~/CLAUDE.md`) on milestones, not chatter.
