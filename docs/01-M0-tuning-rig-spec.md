# M0 — The Tuning Rig · spec

**Status:** ready to plan. 2026-08-26.
**Parent:** `00-TTD-vision.md` (§6 levers, §8 rig, §11 milestones)

> The first buildable milestone. Deliberately ugly. Its deliverable is not a
> game — it is **the ability to find the game by evidence**.

---

## 1. Why this first

The PoC's diagnosis was *untunable*, not *unfinished*: the single most
important lever (enemy speed) did not exist, and most knobs required a world
rebuild. You cannot find fun you cannot reach.

M0 ends when you can sit with a board and a slider panel and change how the
game feels **without a reload**, while numbers tell you whether it got better.

**Explicit non-goal:** M0 is not fun, and shouldn't be judged on that. Judging
it on fun would push us to add content instead of instrumentation.

## 2. What M0 contains

A minimum playable board, fully instrumented:

- Sphere + dungeon (ported from the PoC), rendered with the bloom chain
- **One** tower type, **one** critter type — enough to have a fight, few
  enough that nothing hides behind variety
- A tank the player drives (the tactical layer must exist from the start, per
  vision §0 — a rig that only measures the board would measure the wrong thing)
- Waves that spawn, march, and are killable
- **The dashboard**: every lever live
- **Telemetry**: the numbers that adjudicate a tuning change
- **God toggles**: infinite heart / infinite tank, still counting hits
- **Presets**: persist, export, import

## 3. Architecture

```
src/core/                     pure, headless, Node-tested (no three.js)
  sphere/   grid · dungeon · cellindex      (ported from the PoC)
  sim/      rng ✓ · world · waves · critters · towers · tank · telemetry
  tuning/   schema · defaults · presets
src/render/                   three.js: board, units, postfx
src/ui/                       dashboard, HUD
src/app/                      shell, loop, input, camera
```

**The seam:** `core/` exposes a `World` that steps on `tick(dt, input)` and is
fully observable. The renderer reads it; nothing in `core/` knows the renderer
exists. Enforced by `architecture.test.ts` (already green).

**Consequence worth stating:** because `core/` is pure and time enters as
`dt`, the whole simulation can be run headlessly at speed — which is what makes
*automated* tuning sweeps possible later (§9).

## 4. The tuning schema

One declarative schema is the single source of truth. The dashboard, the
presets, the URL hooks and the docs are all generated from it — so a new lever
is one entry, not four edits.

```ts
type Lever = {
  key: string;              // 'enemy.speed'
  group: LeverGroup;        // 'intensity' | 'critters' | ... | 'god'
  label: string;
  min: number; max: number; step: number;
  value: number;
  live: true;               // M0 rule: EVERY lever applies without a rebuild
  help?: string;
};
```

**Rule:** a lever that needs a world rebuild is a design smell. If a value is
consumed inside the sim loop, it must be readable per-tick from the tuning
store rather than captured at construction. (This is exactly what the PoC got
wrong — values baked at build time.)

### Levers in M0

Only what the M0 content can actually exercise. The rest arrive with their
systems in M1–M3.

| Group | Lever | Range | Controls |
|---|---|---|---|
| intensity | `wave.size` | 1–40 | enemies per wave |
| intensity | `wave.dripRate` | 0.1–2.0 s | gap between individual spawns (**burst vs trickle** — the HK finding) |
| intensity | `wave.dripJitter` | 0–1 | randomness on that gap; kills the metronome |
| intensity | `wave.overlap` | 0–1 | 0 = wait for a clear, 1 = never wait |
| intensity | `wave.gap` | 0–20 s | the macro breath between waves |
| intensity | `wave.sizeGrowth` | 0–3 | how counts scale per wave |
| intensity | `wave.hpGrowth` | 1.0–1.3 | per-wave HP multiplier |
| critters | `enemy.speed` | 0.2–3.0 | **global pace — the lever the PoC never had** |
| critters | `enemy.hp` | 1–20 | |
| critters | `enemy.surgeAmp` | 0–0.8 | speed-envelope amplitude (the accel/decel stressor) |
| critters | `enemy.surgeCadence` | 0.2–3.0 s | how often the envelope re-targets |
| critters | `enemy.surgeJitter` | 0–1 | variance on that cadence |
| critters | `enemy.accelOnHit` | 0.5–2.0 | <1 stagger, >1 inverted dominance |
| critters | `enemy.reactionDur` | 0–3 s | how long a hit reaction lasts |
| player | `tower.damage` / `.range` / `.rate` | — | the one tower |
| player | `tank.speed` / `.damage` / `.fireRate` | — | the tactical layer |
| feel | `bloom.strength` / `.radius` / `.threshold` | — | |
| camera | `shake.amount` | 0–2 | |
| god | `god.heartInvulnerable` | bool | **still counts hits** |
| god | `god.tankInvulnerable` | bool | **still counts hits** |
| god | `time.scale` | 0.1–4 | slow-motion inspection / fast-forward |

## 5. Telemetry

Two panes, because §0 says there are two questions.

**Difficulty** — is it hard enough?
`heart hits · tank hits · leaks · kills/min · TTK (mean, p90) · wave clear time ·
peak concurrent enemies · enemies alive over time`

**Layer balance** — is each layer doing its job? *(the §0 insight)*
- `time in macro vs tactical` — headline ratio
- `mode switches per wave`
- `tank idle-under-threat` — enemies alive and the tank doing nothing; the
  specific failure the design must avoid
- `decisions per macro phase` — towers placed/upgraded/sold per breath
- `player-kills vs tower-kills` — who is actually winning the fight?

That last one is the sharpest single number in M0. If towers do everything,
the tank is decoration; if the tank does everything, the board is wallpaper.

**Design rules:** telemetry lives in `core/sim/telemetry.ts` (pure, so a
headless sweep produces the same numbers as a played session); it is
resettable; god-mode hits count normally. Live readout + a session summary on
demand.

## 6. The dashboard

Its own panel, not folded into world controls. Mobile-legible (the operator
plays on a phone).

- Collapsible groups matching §4; each lever rendered from the schema
- Live readouts (§5) in a pinned pane
- `reset` per group and globally
- **Presets:** save/load named, persist to `localStorage`, **export/import as a
  string** (and accept `?preset=` on the URL) so a good configuration is
  shareable and diffable
- Panel state (open/closed, group) persists — you'll open this hundreds of times

## 7. Content (deliberately thin)

- **Board:** ported sphere + dungeon, one seed, ~1500 cells
- **Heart:** at the pole, damageable, the lose condition
- **Portals:** 2 fixed spawn gates
- **Critter:** one type, dot-cloud, walks the nav graph to the heart, carries
  the speed envelope + hit reaction
- **Tower:** one type, placed on **open (non-BLOCKED) cells**, nearest-target.
  (Corrected in M0b: this said "wall cells", which was the error, not the code.
  A tower on a BLOCKED cell is unreachable by the nav graph and unpickable by
  the raycast, so it could neither shoot nor be placed.)
- **Tank:** drives, shoots, rams
- **Waves:** driven by the §4 intensity levers

No unlock ladder, no economy curve, no tutorial, no minigames, no stealth. All
M1+.

## 8. Testing

**Node (`npm test`) — the pure core:**
- architecture guards (already green)
- rng determinism (already green)
- wave planner: counts/composition from levers; drip schedule; overlap
  behaviour at 0, 0.5, 1
- speed envelope: stays within `[1-amp, 1+amp]`, re-targets on cadence, is
  deterministic per seed
- hit reactions: `accelOnHit` applies for `reactionDur` and expires
- telemetry: counters are exact over a scripted run; god mode counts hits while
  preventing death
- **replay determinism:** the same seed + preset + scripted input produces
  byte-identical telemetry. This is the keystone test — without it, tuning
  comparisons are noise.

**Headless render:** boots, board renders, bloom on, dashboard visible, no
console errors.

## 9. Acceptance

M0 is done when **all** of these hold:

1. Every lever in §4 changes behaviour **without a reload**.
2. `enemy.speed` exists and visibly retimes the game.
3. `wave.dripRate` takes a wave from one lump to a trickle, live.
4. God toggles prevent death while still counting hits.
5. Telemetry reports both panes, including `player-kills vs tower-kills`.
6. A preset round-trips: save → reload the page → identical behaviour; export →
   import → identical.
7. Replay determinism test green.
8. You can run a tuning session and *say which of two settings was better and
   why*, citing a number.

Point 8 is the real acceptance criterion. The rest serve it.

## 10. Risks

- **The rig maps a barren space.** If fun is structural, no slider fixes it —
  open question in `pm.md`. *Mitigation:* M0 is cheap and thin by design, and
  the layer-balance telemetry is aimed squarely at structural questions
  ("towers do everything") rather than only at difficulty.
- **Live-everything constrains the sim.** Reading levers per-tick is a real
  constraint on how systems are written. Accepted deliberately: it's the whole
  point, and retrofitting live-ness is what failed in the PoC.
- **One critter type hides interaction effects.** Accepted; M1 adds variety
  against a rig that can already measure it.
- **Ported geometry drags PoC assumptions in.** *Mitigation:* port, don't copy
  (§ migration policy) — redraw APIs and rewrite tests as they land.

## 11. Out of scope

Tower/critter variety, unlock ladders, economy tuning, tutorial, minigames,
stealth/thermal, radar/orbital strike, the portal dive, achievements,
cinematic cameras, audio (M3 — noted only because it's tempting).
