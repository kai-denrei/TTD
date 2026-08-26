# M0b — The Rig Made Visible · design

**Status:** approved 2026-08-26. Parent: `docs/01-M0-tuning-rig-spec.md` §6/§8, vision §11.
**Predecessor:** M0a (the brain) — complete, 151 tests, cross-process replay determinism verified.

> M0a proved the simulation. M0b makes it visible, drivable and tunable —
> without giving up a single invariant that made M0a trustworthy.

---

## 0. The reframe that shaped this design

The tuning dashboard is **Admin Mode** — an internal tool for finding a
compelling set of values. *None of it ships to end users.* Spec §6's
"mobile-legible (the operator plays on a phone)" describes where the tool is
used, not a player-facing surface.

Consequences applied throughout:

- Density over discoverability. No onboarding, no aesthetic budget.
- It must be **gated**, not merely collapsed.
- `src/ui/admin/` is a leaf: nothing in `core/` or `render/` imports it. Delete
  the directory and the game still runs.
- Player-facing HUD is a separate, much smaller surface.

---

## 1. Architecture & module map

The M0a seam does not move. Everything new is either *pure and testable* or
*render-only and thin*.

```
src/core/                       pure, Node-tested, no three.js
  models/     helpers.ts        fibDir · normV · crossV · fitUnit  (ported)
              turret.ts         turretPts()  ~600 pts → the one tower
              mine.ts           minePts()    ~650 pts → the one critter
  sim/        runner.ts    NEW  headless run harness (see §6)

src/render/                     three.js lives here and only here
  points.ts                     dot-cloud renderer (pooled Float32Array + Points)
  board.ts                      quad mesh, tag-colored, edge overlay
  units.ts                      critters · towers · tank · heart · gates
  postfx.ts                     EffectComposer + UnrealBloom
  bindings.ts                   RENDER_BINDINGS table (see §5)

src/app/
  loop.ts                       fixed 1/60 accumulator; rAF drives render only
  input.ts                      keyboard/mouse + touch parity
  cameras/registry.ts           CAMERA_MODES + eased blends
  cameras/modes.ts              birdseye · raked · driftorbit · chase · pov
  shell.ts                      boots everything, owns the admin gate

src/ui/
  hud.ts                        player-facing: heart HP, wave, enemies alive
  admin/  gate.ts               ?admin=1 · 5-tap corner · ` key · localStorage
          dashboard.ts          schema-driven modal panel from LEVERS
          telemetry.ts          always-on readout strip
          presets.ts            localStorage · export/import · ?preset=
          compare.ts            A/B driver + delta table
          worker.ts             runs core/sim/runner.ts off the main thread
```

`architecture.test.ts` recurses over all of `core/`, so `core/models/` and
`core/sim/runner.ts` inherit the purity guards (no three, no `Math.random`, no
DOM, no wall-clock) with no test changes.

---

## 2. Render layer

**Dot-clouds from day one.** The Braille library is the project's visual
identity and `docs/03-braille-assets.md` already picked M0's two models. Both
are pure math — `grep -c "Math.random"` over the source file returns 0 — so
they port into `core/models/` and are Node-testable for point count, bounds and
determinism, exactly as that doc proposes.

| Element | Source | Notes |
|---|---|---|
| Tower | `turretPts()` ~600 pts | pedestal + housing + barrel; barrel gives an aim direction |
| Critter | `minePts()` ~650 pts | spiked sphere; reads as hazard from any angle |
| Tank | `turretPts()` re-tinted | M0b reuses the turret silhouette rather than porting a third model; a dedicated tank model is M1 |
| Heart | point cluster at `dungeon.heart` | brightness scales with `heartHp` — HK's "see yourself dying" |
| Gates | ring of highlight dots at each gate cell | |

`p[3] === 1` marks a **highlight dot** — rendered larger and brighter. It is the
library's only "look here" channel and it is free semantic weight (muzzle,
spike tip, weak point).

**Board:** an indexed `BufferGeometry` built once from `mesh.quads`
(quad → 2 triangles), vertex-colored by `dungeon.tags` (BLOCKED / PATH / ROOM),
with a `LineSegments` edge overlay so individual cells stay readable — cell
legibility matters because tower placement is per-cell.

**Rendering strategy for units:** one `THREE.Points` object per unit *type*,
backed by a pre-allocated `Float32Array` sized to a capacity ceiling. Each frame
the CPU writes live unit positions into the pooled buffer and sets
`drawRange`. At M0's scale (peak ~16 concurrent critters × 650 pts ≈ 10k verts)
this is trivially cheap and avoids custom instancing shaders entirely.
Additive blending, `sizeAttenuation` on, and bloom does the rest.

**Post-processing is foundational, not polish** (vision §4). `EffectComposer` +
`UnrealBloomPass` are wired in this milestone, not deferred. The PoC's decision
log deferred bloom explicitly and vision §2 blames that deferral for a large
part of why HokorobiTawaa feels better.

---

## 3. App shell — loop, cameras, input

### 3.1 Fixed timestep

The loop uses a **fixed-timestep accumulator at 1/60** feeding `world.tick`;
`requestAnimationFrame` drives rendering only. Variable `dt` straight from rAF
would break the replay-determinism keystone test, and determinism is a stated
pillar (vision §5.6). Accumulator is clamped to a max of 5 steps per frame so a
backgrounded tab does not produce a spiral of death on return.

**Terminal condition.** The app stops ticking the world when `world.heartDied`
and shows a run summary. M0a finding #5: a sim with no terminal condition
accumulates telemetry past death, so long runs average a real game with a
post-mortem. The rule is enforced in the shell for live play and in
`runner.ts` for headless runs.

### 3.2 Camera registry

Cameras are declared the way levers are — a mode is **one entry**, not a
refactor:

```ts
type CameraMode = {
  id: string;
  family: 'build' | 'tank';
  label: string;
  frame(world: World, t: number, state: CamState): { pos: Vec3; look: Vec3; up: Vec3 };
};
```

| id | family | framing |
|---|---|---|
| `birdseye` | build | straight down the surface normal above the orbit anchor |
| `raked` | build | 45° off the normal — shows relief and unit silhouettes |
| `driftorbit` | build | slow automatic orbit; the cinematic showcase angle |
| `chase` | tank | 3rd person behind and above the tank — the main tank view |
| `pov` | tank | at the tank, looking along its heading |

`TAB` switches family, `C` cycles within family. **Switching family calls
`world.setMacro()`** — which is what finally makes `macroShare` and
`modeSwitches` non-zero. M0a brain-notes §5.2 records that these read 0 in
every sweep because nothing ever called `setMacro`; the layer-balance pane of
the telemetry has never had data. Vision §0 calls that ratio the headline
number the rig exists to measure.

Transitions between modes are eased (position/target/up slerped over
`modeTransition` seconds) rather than cut, so a switch reads as a beat.

### 3.3 Input — full keyboard/touch parity

| | Build family | Tank family |
|---|---|---|
| Desktop | drag = orbit · wheel = zoom · click = place tower | WASD/arrows = drive · Space = fire |
| Touch | one-finger drag = orbit · pinch = zoom · tap = place tower | left-thumb virtual stick · right-thumb fire button |

Parity is not a nicety: without touch driving, every phone tuning session
reports a tank that never acts — `tankIdleUnderThreat` pinned high and
`playerKillShare` near zero for a reason that is an input gap, not a balance
finding.

**Tower placement** raycasts against the board mesh, resolves the hit triangle
to its source cell, and calls `world.placeTower(cell)`. Rejection (BLOCKED or
occupied) gives a brief visual refusal; the world already refuses correctly and
counts a decision only on success.

---

## 4. Admin Mode

### 4.1 The gate

Admin code ships in every build but is unreachable without deliberate entry:

- `?admin=1` on the URL
- five taps on the top-left corner (phones with no keyboard)
- the `` ` `` key on desktop

Entry persists in `localStorage['ttd.admin']`; `?admin=0` or the same gesture
exits. Build-time stripping was rejected because the phone loads the deployed
Pages build — stripping admin would make it unreachable at exactly the place it
is used.

### 4.2 The panel

A **fullscreen modal** over the board, plus an always-on telemetry strip that
remains visible when the modal is closed.

- Groups from `LeverGroup` (intensity · critters · player · feel · camera ·
  god), collapsible, rendered entirely from `LEVERS` — a new lever is one
  schema entry and appears with no UI edit.
- Each row: label, live numeric value, range slider (`min`/`max`/`step` from
  schema), `help` on long-press/hover. Booleans (min 0, max 1, step 1) render
  as toggles.
- `reset` per group and globally, straight through to `tuning.reset(group?)`.
- Panel open/closed state and last-open group persist to `localStorage`.

Every write goes to `tuning.set(...)`, so liveness is inherited rather than
re-implemented: systems already read `tuning.get()` inside their tick.

### 4.3 Presets

- Save/load named presets to `localStorage['ttd.presets']`.
- Export/import the compact string `tuning.export()` already produces
  (`key=value;key=value;…`), with import tolerant of unknown keys.
- `?preset=<string>` applied at boot, before the first tick.

### 4.4 Telemetry readout

Live strip: heart HP, wave, enemies alive, kills, player/tower kill share,
elapsed. Full readout in the modal, split into the two panes spec §5 defines —
**difficulty** and **layer balance** — plus a run summary on death.

---

## 5. Render-lever liveness

`liveness.test.ts:8` carries `RENDER_ONLY = {bloom.strength, bloom.radius,
bloom.threshold, shake.amount}` with the note *"These will be confirmed live in
M0b."* This milestone discharges that debt.

Render levers are consumed through a **declared table**, never scattered reads:

```ts
export const RENDER_BINDINGS: readonly RenderBinding[] = [
  { key: 'bloom.strength',  apply: (t, v) => { t.bloom.strength  = v; } },
  { key: 'bloom.radius',    apply: (t, v) => { t.bloom.radius    = v; } },
  { key: 'bloom.threshold', apply: (t, v) => { t.bloom.threshold = v; } },
  { key: 'shake.amount',    apply: (t, v) => { t.camera.shakeGain = v; } },
];
```

Three Node tests, no browser:

1. **Coverage** — every key in `RENDER_ONLY` has exactly one binding, and every
   binding names a real lever in `LEVERS`.
2. **Effect** — applying `min` then `max` to a stub target leaves it in
   different states. A binding that writes nothing fails here.
3. **Per-frame** — the render frame function calls `tuning.get` for every bound
   key on every frame (asserted against a recording stub), so no render lever
   is captured at construction.

`RENDER_ONLY` stops being an exclusion and becomes a differently-tested set.
Residual gap, stated honestly: this proves the value reaches the property, not
that three.js honours it. That is closed once by eye and noted in the M0b
report — a headless pixel-diff harness is deliberately out of scope.

---

## 6. `core/sim/runner.ts` — one definition of "a comparable run"

M0a found sweeps silently measure a dead game: the heart dies at t≈37–98s
depending on settings, yet sweep runs are a flat 100s, so 2–63% of every row is
post-mortem accrual.

```ts
export type RunSpec = {
  seed: number;
  preset: string;          // tuning.export() format
  maxTicks: number;
  dt: number;              // default 1/60
  stopAtDeath: boolean;    // default true
  input?: (tick: number) => TankInput;   // default: idle tank
  towers?: number[];       // cells to place before tick 0
};
export function runHeadless(spec: RunSpec): Record<string, number>;
```

Truncation at heart death is enforced **here**, in one pure tested place,
consumed by both `scripts/sweep.ts` and the in-app compare worker. Neither
re-derives what a run is.

## 7. A/B compare — acceptance §9.8

Spec §9 point 8 is the real acceptance criterion: *"you can run a tuning
session and say which of two settings was better and why, citing a number."*

A **Compare** action in the admin panel runs `runHeadless` in a Web Worker
across a fixed seed set (42, 43, 44) at preset A vs preset B, and renders a
delta table with changed levers highlighted:

```
lever            A       B
wave.dripRate   0.50 → 1.10

metric        A      B      Δ
survivedFor  48.5   82.1   +33.6  ▲
heartHits      44     27    −17   ▼
peakConcurrent 13      9     −4
playerKillShare 0.75  0.37   −0.38 ▼
```

Headless rather than snapshot-of-played-sessions on purpose: two played runs
differ in how the tank was driven as much as in the lever under test, which is
precisely the noise the sweep exists to avoid. The worker keeps the main thread
at frame rate; `core/` is pure TypeScript already in the bundle, so the worker
needs no three.js.

**Known comparability hazard, carried forward from M0a brain-notes §2:** all
critters share one RNG stream, so changing a combat lever changes survivor
composition and shifts every later critter's envelope draws. Multi-seed
averaging is the mitigation, not a fix; the compare UI labels results as a
three-seed mean, never a single-run truth.

---

## 8. Testing

**Node (`npm test`) — extends the existing suite:**

- `core/models/*.test.ts` — point counts within expected bounds, all points
  inside the unit sphere after `fitUnit`, highlight-flag channel preserved,
  byte-identical output across two calls (determinism).
- `core/sim/runner.test.ts` — truncates at heart death when `stopAtDeath`;
  runs the full `maxTicks` when false; identical `RunSpec` yields identical
  summary; a preset string round-trips into the run.
- `render/bindings.test.ts` — the three assertions in §5. No three.js import;
  the table is data and the target is a stub.
- `app/cameras/registry.test.ts` — every `CameraMode` returns finite vectors
  for a synthetic world state; `up` is never parallel to the view direction
  (the degenerate case that produces a spinning camera at the poles); family
  switching toggles exactly once per switch.
- `ui/admin/presets.test.ts` — save → load → identical; export → import →
  identical; unknown keys ignored; `?preset=` parsing.

**Unchanged and still gating:** `architecture.test.ts`, `liveness.test.ts`,
replay determinism, `scripts/verify-determinism.sh`.

**Manual acceptance (the part tests cannot make):** board renders with bloom;
all five cameras frame sanely; a slider visibly retimes the game; the admin
gate opens and closes; a preset survives reload.

---

## 9. Acceptance

M0b is done when:

1. `npm run dev` serves a rendered sphere board with dungeon tags legible.
2. Critters and towers render as dot-clouds with bloom; the heart dims as it
   takes damage.
3. All five camera modes work; `TAB`/`C` switch and cycle with eased blends.
4. The tank drives and fires from both keyboard and touch.
5. Towers place by click/tap on a cell; refusals are visible.
6. The admin gate opens the dashboard; every lever in `LEVERS` renders and
   applies live.
7. `macroShare` and `modeSwitches` are **non-zero** in a played session — the
   first time this telemetry has had data.
8. A preset round-trips: save → reload → identical; export → import →
   identical.
9. Compare produces a delta table over three seeds with truncation at death.
10. `npm test` and `npm run typecheck` green; render-lever bindings tested.

---

## 10. Out of scope

Deliberately deferred, with the milestone that owns each:

- Model treatments — spin, breathe, twinkle, sway (M3, feel)
- Audio (M3) · hit feedback, hitstop, death bursts (M3)
- Beat cameras and `intensityFraming` (M3) — they need sim events that do not
  exist yet
- A second tower or critter type (M1)
- Headless pixel-diff test harness (deferred; §5 states the residual gap)
- A dedicated tank model (M1) — M0b re-tints the turret

---

## 11. Risks

- **Dot-cloud cost on a phone.** Peak ~16 critters × 650 pts plus a ~2,700-quad
  board plus bloom. *Mitigation:* pooled buffers with `drawRange`, one Points
  object per type, and a capacity ceiling; bloom resolution is already a lever
  if it needs backing off.
- **Camera degeneracy at the poles.** Framing off a surface normal has a
  singularity when `up` aligns with the view direction. *Mitigation:* an
  explicit test (§8) and a stable reference-vector fallback.
- **Admin panel scope creep.** It is a tool, and tools invite polish.
  *Mitigation:* the memory note is explicit — density over discoverability, no
  aesthetic budget.
- **The rig maps a barren space** (carried from M0 §10). Still open, and still
  the reason M0b keeps the layer-balance telemetry central rather than
  measuring difficulty alone.
