# M0b — The Rig Made Visible · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the M0a simulation visible, drivable and tunable in a browser — a dot-cloud sphere board with bloom, a five-mode camera rig, keyboard+touch control, and a gated Admin Mode dashboard that tunes every lever live and adjudicates A/B changes with numbers.

**Architecture:** The M0a seam does not move. Everything new is either *pure and Node-tested* (`core/models/`, `core/sim/runner.ts`, `app/cameras/`, `render/bindings.ts`) or *render-only and thin* (`render/`, `ui/`). `src/ui/admin/` is a leaf — nothing in `core/` or `render/` imports it, so deleting the directory leaves a working game.

**Tech Stack:** Vite 6 · TypeScript 5.7 · three 0.170 (`examples/jsm/postprocessing/*` for EffectComposer + UnrealBloomPass) · `node --test` for the suite.

## Global Constraints

- **`src/core/` stays pure.** No `three` import, no `Math.random`, no `document.`/`window.`/`performance.now(`/`Date.now(`. `src/core/architecture.test.ts` recurses over every `.ts` under `core/` and enforces this — new core files inherit the guard with no test edit.
- **`verbatimModuleSyntax: true`** — type-only imports MUST use `import type { X } from '...'`.
- **`allowImportingTsExtensions: true`** — every relative import ends in `.ts` (e.g. `from './helpers.ts'`).
- **`noUncheckedIndexedAccess: true`** — indexing an array yields `T | undefined`. Fixed-length tuples like `Vec3 = readonly [number, number, number]` are exempt. Guard or `!` every variable-length index.
- **`noUnusedLocals` / `noUnusedParameters: true`** — an unused import or parameter is a compile error.
- **`tsconfig.json` includes only `["src", "vite.config.ts"]`** — `scripts/` is NOT typechecked by `npm run typecheck`.
- **Every lever is read via `tuning.get(key)` inside the frame/tick**, never captured at construction.
- **Determinism:** all randomness via `stream(seed, name)`; one named stream per system.
- Run `npm run typecheck` **and** `npm test` before every commit.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
  ```
- After editing sources, `./scripts/bust.sh --quiet` bumps the cache-bust token.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/core/models/helpers.ts` | `fibDir` · `normV` · `crossV` · `fitUnit` — ported Braille primitives, pure |
| `src/core/models/turret.ts` | `turretPts()` → 590 points, 1 highlight |
| `src/core/models/mine.ts` | `minePts()` → 490 points, 26 highlights |
| `src/core/sim/runner.ts` | `runHeadless(spec)` — the one definition of a comparable run |
| `src/render/bindings.ts` | `RENDER_BINDINGS` table + `readRenderState` — pure, no three |
| `src/render/board.ts` | sphere quad mesh + edge overlay, tag-coloured |
| `src/render/points.ts` | pooled dot-cloud renderer |
| `src/render/units.ts` | critters · towers · tank · heart · gates |
| `src/render/postfx.ts` | EffectComposer + UnrealBloomPass |
| `src/app/cameras/modes.ts` | the five `CameraMode` entries — pure |
| `src/app/cameras/registry.ts` | rig: family switch, cycle, eased blend, shake — pure |
| `src/app/loop.ts` | fixed 1/60 accumulator + terminal condition |
| `src/app/input.ts` | keyboard/mouse + touch parity, tower-placement raycast |
| `src/app/shell.ts` | boots everything, owns the admin gate |
| `src/ui/hud.ts` | player-facing HUD |
| `src/ui/admin/gate.ts` | `?admin=1` · 5-tap corner · backtick · localStorage |
| `src/ui/admin/dashboard.ts` | schema-driven modal panel |
| `src/ui/admin/telemetry.ts` | two-pane readout + run summary |
| `src/ui/admin/presets.ts` | localStorage · export/import · `?preset=` |
| `src/ui/admin/compare.ts` | A/B driver + delta table |
| `src/ui/admin/worker.ts` | runs `runHeadless` off the main thread |

---

### Task 1: Port the Braille models into `core/models/`

**Files:**
- Create: `src/core/models/helpers.ts`
- Create: `src/core/models/turret.ts`
- Create: `src/core/models/mine.ts`
- Test: `src/core/models/models.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  ```ts
  export type ModelPoint = readonly [number, number, number, number]; // x, y, z, hi (0 | 1)
  export function fibDir(i: number, n: number): readonly [number, number, number];
  export function normV(v: readonly [number, number, number]): readonly [number, number, number];
  export function crossV(a: readonly [number, number, number], b: readonly [number, number, number]): readonly [number, number, number];
  export function fitUnit(pts: readonly ModelPoint[]): ModelPoint[];
  export function turretPts(): ModelPoint[];
  export function minePts(): ModelPoint[];
  ```

**Background the implementer needs:** the source is `~/Dev/Braille/fun-shapes/index.html`, ~150 point-cloud generators in vanilla JS. `docs/03-braille-assets.md` picked `turretPts` (tower) and `minePts` (critter) for M0. The library's convention is that a 4th element `=== 1` marks a **highlight dot** — rendered brighter. The port normalises every point to exactly four components (`hi` is `0` or `1`) so downstream buffer writes are uniform. `grep -c "Math.random"` over the source returns `0`, so the port is deterministic by construction and satisfies the `core/` purity guard.

- [ ] **Step 1: Write the failing test**

Create `src/core/models/models.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fibDir, fitUnit, normV, crossV } from './helpers.ts';
import type { ModelPoint } from './helpers.ts';
import { turretPts } from './turret.ts';
import { minePts } from './mine.ts';

describe('model helpers', () => {
  test('fibDir returns unit vectors spread over the sphere', () => {
    for (let i = 0; i < 32; i++) {
      const d = fibDir(i, 32);
      assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9, `fibDir(${i},32) not unit length`);
    }
    // y descends monotonically from near +1 to near -1
    assert.ok(fibDir(0, 32)[1] > 0.9);
    assert.ok(fibDir(31, 32)[1] < -0.9);
  });

  test('normV of a zero vector does not divide by zero', () => {
    const n = normV([0, 0, 0]);
    assert.ok(Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2]));
  });

  test('crossV is perpendicular to both inputs', () => {
    const c = crossV([1, 0, 0], [0, 1, 0]);
    assert.deepEqual(c, [0, 0, 1]);
  });

  test('fitUnit scales the farthest point to radius 1 and preserves the highlight flag', () => {
    const src: ModelPoint[] = [[2, 0, 0, 0], [0, 1, 0, 1]];
    const out = fitUnit(src);
    assert.equal(Math.hypot(out[0]![0], out[0]![1], out[0]![2]), 1);
    assert.equal(out[1]![3], 1, 'highlight flag lost');
  });
});

// Exact counts are derived from the generator structure, not observed from a
// run. turret = 225 pedestal (9 rings x 22, + 27 of 54 dome dots with y >= 0)
// + 294 housing (7x7 grid x 6 faces) + 71 barrel (10 rings x 7, + 1 muzzle).
// mine = 360 shell + 26 spikes x 5 segments.
// If a port produces different numbers, the PORT is wrong, not the test.
const MODELS = [
  { name: 'turret', fn: turretPts, points: 590, highlights: 1 },
  { name: 'mine', fn: minePts, points: 490, highlights: 26 },
] as const;

describe('M0 models', () => {
  for (const m of MODELS) {
    test(`${m.name} has exactly ${m.points} points`, () => {
      assert.equal(m.fn().length, m.points);
    });

    test(`${m.name} has exactly ${m.highlights} highlight dots`, () => {
      assert.equal(m.fn().filter((p) => p[3] === 1).length, m.highlights);
    });

    test(`${m.name} fits inside the unit sphere and touches it`, () => {
      let max = 0;
      for (const p of m.fn()) {
        const r = Math.hypot(p[0], p[1], p[2]);
        assert.ok(r <= 1 + 1e-9, `${m.name} point escapes the unit sphere at r=${r}`);
        if (r > max) max = r;
      }
      assert.ok(Math.abs(max - 1) < 1e-9, `${m.name} never reaches r=1; fitUnit did not normalise`);
    });

    test(`${m.name} every point has 4 finite components`, () => {
      for (const p of m.fn()) {
        assert.equal(p.length, 4);
        for (const c of p) assert.ok(Number.isFinite(c));
      }
    });

    test(`${m.name} is deterministic across calls`, () => {
      assert.deepEqual(m.fn(), m.fn());
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './helpers.ts'`.

- [ ] **Step 3: Implement `helpers.ts`**

Create `src/core/models/helpers.ts`:

```ts
// helpers.ts — the shared primitives every Braille point-cloud generator uses.
//
// Ported from ~/Dev/Braille/fun-shapes/index.html (vanilla JS, ~150 generators).
// Port, don't copy: the maths is the asset, the typing is ours. Every point
// carries exactly four components here — the source library used a ragged
// 3-or-4 shape, which forces a length check at every consumer. Normalising to
// [x, y, z, hi] once, at the port boundary, means the renderer can write
// straight into a Float32Array without branching per point.
//
// Pure by construction: no Math.random anywhere in the source library
// (verified: grep -c "Math.random" returns 0), so these satisfy core/'s
// determinism guard without needing a seeded stream.

/** A model point in unit-sphere space. The 4th component is the highlight
 *  flag: 1 = render brighter/larger. It is the library's only "look here"
 *  channel, and it is free semantic weight (a muzzle, a spike tip, an eye). */
export type ModelPoint = readonly [number, number, number, number];

/** Mutable 3-vector used inside generators before the highlight flag is added. */
export type V3 = readonly [number, number, number];

/** The i-th of n directions on a Fibonacci sphere — an even, deterministic
 *  spread with no clustering at the poles. */
export function fibDir(i: number, n: number): V3 {
  const g = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * g;
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

/** Normalise; a zero-length vector yields a finite result rather than NaN. */
export function normV(v: V3): V3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1e-6;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function crossV(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Scale the cloud so its farthest point sits exactly on the unit sphere,
 *  preserving the highlight flag. Every generator ends with this, so all
 *  models share one coordinate convention: unit radius, +Y up. */
export function fitUnit(pts: readonly ModelPoint[]): ModelPoint[] {
  let m = 0;
  for (const p of pts) {
    const r = Math.hypot(p[0], p[1], p[2]);
    if (r > m) m = r;
  }
  const k = m || 1;
  return pts.map((p) => [p[0] / k, p[1] / k, p[2] / k, p[3]] as ModelPoint);
}
```

- [ ] **Step 4: Implement `turret.ts`**

Create `src/core/models/turret.ts`:

```ts
// turret.ts — the M0 tower model: pedestal + boxy housing + one swept barrel.
//
// Chosen in docs/03-braille-assets.md for silhouette legibility at small scale
// on a sphere: it reads as "defensive emplacement" instantly, and the barrel
// gives an obvious aim direction to orient. The muzzle point is the model's
// single highlight dot.
//
// Model convention: +Y is up (the surface normal when placed), +X is the
// barrel/aim direction.

import { fibDir, fitUnit, normV, crossV } from './helpers.ts';
import type { ModelPoint, V3 } from './helpers.ts';

/** Tapered pedestal (9 stacked rings of 22) + a domed top plate (the upper
 *  half of a 54-point Fibonacci sphere). 198 + 27 = 225 points. */
function pedestal(out: ModelPoint[], r: number, yTop: number, yBot: number): void {
  for (let iy = 0; iy <= 8; iy++) {
    const f = iy / 8;
    const y = yBot + (yTop - yBot) * f;
    const rr = r * (0.78 + 0.22 * f);
    for (let a = 0; a < 22; a++) {
      const ang = (a / 22) * 2 * Math.PI;
      out.push([rr * Math.cos(ang), y, rr * Math.sin(ang), 0]);
    }
  }
  for (let i = 0; i < 54; i++) {
    const d = fibDir(i, 54);
    if (d[1] < 0) continue;
    out.push([d[0] * r, yTop + d[1] * 0.05, d[2] * r, 0]);
  }
}

/** Solid-surface box: an (n+1)x(n+1) grid on each of the six faces.
 *  n = 6 gives 49 * 6 = 294 points. */
function box(out: ModelPoint[], c: V3, h: V3, n: number): void {
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const u = (i / n) * 2 - 1;
      const v = (j / n) * 2 - 1;
      out.push([c[0] + u * h[0], c[1] + v * h[1], c[2] - h[2], 0]);
      out.push([c[0] + u * h[0], c[1] + v * h[1], c[2] + h[2], 0]);
      out.push([c[0] - h[0], c[1] + v * h[1], c[2] + u * h[2], 0]);
      out.push([c[0] + h[0], c[1] + v * h[1], c[2] + u * h[2], 0]);
      out.push([c[0] + u * h[0], c[1] - h[1], c[2] + v * h[2], 0]);
      out.push([c[0] + u * h[0], c[1] + h[1], c[2] + v * h[2], 0]);
    }
  }
}

/** Swept cylinder of `steps + 1` rings of 7, plus a bright muzzle bore dot.
 *  len 0.72 / r 0.06 gives steps = 9, so 70 + 1 = 71 points. */
function barrel(out: ModelPoint[], base: V3, dir: V3, len: number, r: number): void {
  const T = normV(dir);
  const steps = Math.max(6, Math.round(len / 0.08));
  let n1 = normV(crossV(T, [0, 1, 0.011]));
  if (!(n1[0] || n1[1] || n1[2])) n1 = [1, 0, 0];
  const n2 = crossV(T, n1);
  for (let i = 0; i <= steps; i++) {
    const f = i / steps;
    const cx = base[0] + T[0] * len * f;
    const cy = base[1] + T[1] * len * f;
    const cz = base[2] + T[2] * len * f;
    for (let m = 0; m < 7; m++) {
      const a = (m / 7) * 2 * Math.PI;
      const cs = Math.cos(a);
      const sn = Math.sin(a);
      out.push([
        cx + r * (cs * n1[0] + sn * n2[0]),
        cy + r * (cs * n1[1] + sn * n2[1]),
        cz + r * (cs * n1[2] + sn * n2[2]),
        0,
      ]);
    }
  }
  out.push([base[0] + T[0] * len, base[1] + T[1] * len, base[2] + T[2] * len, 1]);
}

/** The M0 tower. 225 + 294 + 71 = 590 points, 1 highlight (the muzzle). */
export function turretPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  pedestal(pts, 0.42, -0.4, -0.95);
  box(pts, [0, -0.12, 0], [0.32, 0.22, 0.3], 6);
  barrel(pts, [0.28, -0.05, 0], [1, 0, 0.02], 0.72, 0.06);
  return fitUnit(pts);
}
```

- [ ] **Step 5: Implement `mine.ts`**

Create `src/core/models/mine.ts`:

```ts
// mine.ts — the M0 critter model: a spiked sphere.
//
// Chosen in docs/03-braille-assets.md because it reads as *hazard* at any size
// and from any angle — which matters on a sphere, where units are seen from
// arbitrary orientations. Its highlight dots are the spike tips, so it stays
// legible when small. (ufoPts was the runner-up; its disc silhouette collapses
// edge-on.)

import { fibDir, fitUnit } from './helpers.ts';
import type { ModelPoint } from './helpers.ts';

/** The M0 critter. 360 shell + 26 spikes x 5 segments = 490 points,
 *  26 highlights (the spike tips). */
export function minePts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const R = 0.62;
  for (let i = 0; i < 360; i++) {
    const d = fibDir(i, 360);
    pts.push([d[0] * R, d[1] * R, d[2] * R, 0]);
  }
  const spikes = 26;
  for (let k = 0; k < spikes; k++) {
    const d = fibDir(k, spikes);
    for (let s = 1; s <= 5; s++) {
      const r = R + (s / 5) * 0.36;
      pts.push([d[0] * r, d[1] * r, d[2] * r, s === 5 ? 1 : 0]);
    }
  }
  return fitUnit(pts);
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npm test 2>&1 | tail -20`
Expected: PASS — the suite grows from 151 to 165 tests, `fail 0`.

If a count assertion fails, **fix the port, not the test** — recount against the generator structure documented in the test's comment.

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: no output, exit 0.

- [ ] **Step 8: Commit**

```bash
git add src/core/models/
git commit -F - <<'EOF'
feat(models): port turretPts and minePts into core/models

The Braille library is the project's visual identity, and 03-braille-assets.md
already picked M0's two models. Both are pure math — grep -c "Math.random"
over the source file returns 0 — so they satisfy core/'s determinism guard
without a seeded stream, and architecture.test.ts covers them for free by
recursing over core/.

Port, don't copy: the source uses a ragged 3-or-4 element point shape, which
forces a length check at every consumer. Normalising to [x, y, z, hi] once at
the port boundary lets the renderer write straight into a Float32Array with no
per-point branch.

Point counts are asserted exactly (turret 590, mine 490) and derived from
generator structure rather than observed from a run, so a silent change to a
ring count or grid resolution fails rather than drifts. Highlight counts are
asserted too: they are the library's only "look here" channel.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 2: `core/sim/runner.ts` — one definition of a comparable run

**Files:**
- Create: `src/core/sim/runner.ts`
- Test: `src/core/sim/runner.test.ts`
- Modify: `scripts/sweep.ts` (replace its inline loop with `runHeadless`)

**Interfaces:**
- Consumes: `makeWorld` from `./world.ts`, `makeTuning` from `../tuning/store.ts`.
- Produces:
  ```ts
  export type RunInput = 'idle' | 'patrol';
  export type RunTowers = 'heart' | 'none' | readonly number[];
  export type RunSpec = {
    seed: number;
    preset?: string;          // tuning.export() format; omitted = schema defaults
    maxTicks?: number;        // default 6000 (100 s at 1/60)
    dt?: number;              // default 1/60
    stopAtDeath?: boolean;    // default true
    input?: RunInput;         // default 'idle'
    towers?: RunTowers;       // default 'heart'
  };
  export type RunResult = {
    summary: Record<string, number>;
    ticksRun: number;
    stoppedEarly: boolean;
  };
  export function runHeadless(spec: RunSpec): RunResult;
  export function meanSummaries(rs: readonly RunResult[]): Record<string, number>;
  ```

**Background the implementer needs:** M0a's brain notes record finding #5 — *the sim never ends*. At default tuning the heart dies between t≈37 s and t≈98 s, but sweeps run a flat 100 s, so **2–63 % of every sweep row is post-mortem accrual**: telemetry accumulating on a dead game. Comparing a setting that died at t=37 against one that died at t=62 is only valid if you normalise. This module makes truncation-at-death a property of "a run" rather than something each consumer re-derives.

`RunSpec` must be **structured-clone serialisable** — the Admin Mode compare feature posts it to a Web Worker. That is why `input` and `towers` are string unions rather than callbacks.

The `'patrol'` input reproduces the exact scripted session `scripts/sweep.ts` and `liveness.test.ts` already use, so existing sweep numbers stay comparable across this refactor.

- [ ] **Step 1: Write the failing test**

Create `src/core/sim/runner.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { runHeadless, meanSummaries } from './runner.ts';

describe('runHeadless', () => {
  test('truncates at heart death by default', () => {
    const r = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000 });
    assert.equal(r.stoppedEarly, true, 'heart should die within 6000 ticks at default tuning');
    assert.ok(r.ticksRun < 6000, `ran ${r.ticksRun} ticks; expected truncation`);
    // survivedFor is stamped at death, so elapsed must not exceed it
    assert.ok(
      r.summary['elapsed']! <= r.summary['survivedFor']! + 1e-6,
      'telemetry accrued past the heart death — truncation did not take effect',
    );
  });

  test('runs the full budget when stopAtDeath is false', () => {
    const r = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000, stopAtDeath: false });
    assert.equal(r.ticksRun, 6000);
    assert.equal(r.stoppedEarly, false);
    // this is the post-mortem case the truncating default exists to avoid
    assert.ok(r.summary['elapsed']! > r.summary['survivedFor']! + 1);
  });

  test('is deterministic — same spec, identical summary', () => {
    const a = runHeadless({ seed: 42, input: 'patrol', maxTicks: 1200 });
    const b = runHeadless({ seed: 42, input: 'patrol', maxTicks: 1200 });
    assert.deepEqual(a.summary, b.summary);
    assert.equal(a.ticksRun, b.ticksRun);
  });

  test('a preset string changes the outcome', () => {
    const slow = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000, preset: 'enemy.speed=0.3' });
    const fast = runHeadless({ seed: 42, input: 'patrol', maxTicks: 6000, preset: 'enemy.speed=3.0' });
    assert.notDeepEqual(slow.summary, fast.summary);
    assert.ok(
      slow.summary['survivedFor']! > fast.summary['survivedFor']!,
      'slower enemies should keep the heart alive longer',
    );
  });

  test('towers:none leaves the heart undefended', () => {
    const none = runHeadless({ seed: 42, input: 'idle', maxTicks: 6000, towers: 'none' });
    const heart = runHeadless({ seed: 42, input: 'idle', maxTicks: 6000, towers: 'heart' });
    assert.equal(none.summary['killsByTower'], 0);
    assert.ok(heart.summary['killsByTower']! > 0);
  });

  test('an explicit tower cell list is honoured', () => {
    const r = runHeadless({ seed: 42, input: 'idle', maxTicks: 600, towers: [0, 1, 2] });
    assert.ok(r.ticksRun > 0);
  });

  test('meanSummaries averages matching keys across runs', () => {
    const mean = meanSummaries([
      { summary: { a: 2, b: 10 }, ticksRun: 1, stoppedEarly: false },
      { summary: { a: 4, b: 20 }, ticksRun: 1, stoppedEarly: false },
    ]);
    assert.deepEqual(mean, { a: 3, b: 15 });
  });

  test('meanSummaries of an empty list is an empty record', () => {
    assert.deepEqual(meanSummaries([]), {});
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/core/sim/runner.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './runner.ts'`.

- [ ] **Step 3: Implement `runner.ts`**

Create `src/core/sim/runner.ts`:

```ts
// runner.ts — the single definition of "a comparable run".
//
// WHY THIS EXISTS. M0a's brain notes, finding #5: the sim has no terminal
// condition. At default tuning the heart dies between t~37s and t~98s
// depending on settings, but sweeps ran a flat 100s — so 2-63% of every row
// was post-mortem accrual, telemetry piling up on a dead game. A row that died
// at t=37 and a row that died at t=62 are not comparable without normalising.
//
// Rather than fix that at each call site (the sweep script, the Admin Mode
// compare worker, any future auto-tuner), truncation-at-death is a property of
// a run, enforced here once and consumed everywhere.
//
// SERIALISABILITY IS A REQUIREMENT, NOT A STYLE CHOICE. RunSpec is posted to a
// Web Worker via structuredClone, so every field must be plain data. That is
// why `input` and `towers` are string unions rather than the callbacks they
// would naturally be.

import { makeWorld } from './world.ts';
import { makeTuning } from '../tuning/store.ts';
import type { TankInput } from './tank.ts';

export type RunInput = 'idle' | 'patrol';
export type RunTowers = 'heart' | 'none' | readonly number[];

export type RunSpec = {
  seed: number;
  /** tuning.export() format: 'key=value;key=value'. Omitted = schema defaults. */
  preset?: string;
  /** Tick budget. Default 6000 = 100 s at 1/60. */
  maxTicks?: number;
  dt?: number;
  /** Stop the moment the heart dies. Default true — see the note above. */
  stopAtDeath?: boolean;
  input?: RunInput;
  towers?: RunTowers;
};

export type RunResult = {
  summary: Record<string, number>;
  ticksRun: number;
  /** True when the run ended on heart death rather than exhausting maxTicks. */
  stoppedEarly: boolean;
};

const IDLE: TankInput = { forward: 0, turn: 0, fire: false };

/** The scripted session scripts/sweep.ts and liveness.test.ts already use.
 *  Reproduced exactly so numbers stay comparable across this refactor. */
function patrolInput(k: number): TankInput {
  return { forward: k % 120 < 60 ? 1 : -1, turn: Math.sin(k / 30), fire: k % 5 === 0 };
}

export function runHeadless(spec: RunSpec): RunResult {
  const dt = spec.dt ?? 1 / 60;
  const maxTicks = spec.maxTicks ?? 6000;
  const stopAtDeath = spec.stopAtDeath ?? true;
  const inputMode: RunInput = spec.input ?? 'idle';

  const tuning = makeTuning();
  if (spec.preset !== undefined && spec.preset !== '') tuning.import(spec.preset);

  const world = makeWorld({ seed: spec.seed, tuning });

  const towers = spec.towers ?? 'heart';
  if (towers === 'heart') {
    world.placeTower(world.dungeon.heart);
  } else if (towers !== 'none') {
    for (const cell of towers) world.placeTower(cell);
  }

  let ticksRun = 0;
  let stoppedEarly = false;
  for (let k = 0; k < maxTicks; k++) {
    world.tick(dt, inputMode === 'patrol' ? patrolInput(k) : IDLE);
    ticksRun = k + 1;
    if (stopAtDeath && world.heartDied) {
      stoppedEarly = true;
      break;
    }
  }

  return { summary: world.telemetry.summary(), ticksRun, stoppedEarly };
}

/** Element-wise mean over runs. Used to average a seed set, because a single
 *  seed is not evidence: M0a's brain notes flag that all critters share one RNG
 *  stream, so changing a combat lever shifts every later critter's envelope
 *  draws. Multi-seed averaging is a mitigation, not a fix. */
export function meanSummaries(rs: readonly RunResult[]): Record<string, number> {
  if (rs.length === 0) return {};
  const out: Record<string, number> = {};
  const first = rs[0]!.summary;
  for (const key of Object.keys(first)) {
    let sum = 0;
    for (const r of rs) sum += r.summary[key] ?? 0;
    out[key] = sum / rs.length;
  }
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/core/sim/runner.test.ts 2>&1 | tail -20`
Expected: PASS, 8 tests.

If `truncates at heart death by default` fails with `stoppedEarly === false`, the heart survived 6000 ticks at defaults — check that `towers` defaulted to `'heart'` and that `world.heartDied` is being read (it is a getter over `telemetry.data.heartDeathAt !== null`).

- [ ] **Step 5: Refactor `scripts/sweep.ts` onto the runner**

Replace the body of the `for` loop in `scripts/sweep.ts`. The file currently builds a world inline; it now delegates. Replace lines from `const t = makeTuning();` through `rows.push(...)` with:

```ts
  const preset = `${key}=${v}`;
  const r = runHeadless({ seed: 42, preset, maxTicks: 6000, input: 'patrol', towers: 'heart' });
  rows.push({ [key]: +v.toFixed(3), ...r.summary });
```

And replace the imports at the top of the file:

```ts
import { runHeadless } from '../src/core/sim/runner.ts';
import { LEVERS } from '../src/core/tuning/schema.ts';
```

Then update the trailing comment to reflect the new behaviour — replace the two comment lines above `console.table(rows)` with:

```ts
// Runs truncate at heart death (runner.ts default), so every row measures a
// live game only. survivedFor is therefore the run length, not a warning flag.
```

- [ ] **Step 6: Verify the sweep still runs and now truncates**

Run: `npm run sweep -- enemy.speed 0.6 2.0 3`
Expected: a 3-row table. `survivedFor` and `elapsed` are now equal in each row (previously `elapsed` was pinned at 100.0 while `survivedFor` was 37–98).

- [ ] **Step 7: Run the full suite and typecheck**

Run: `npm test 2>&1 | tail -5 && npm run typecheck`
Expected: `fail 0`, and typecheck silent. (`scripts/` is outside tsconfig's `include`, so the sweep edit is not typechecked — the sweep run in Step 6 is its check.)

- [ ] **Step 8: Commit**

```bash
git add src/core/sim/runner.ts src/core/sim/runner.test.ts scripts/sweep.ts
git commit -F - <<'EOF'
feat(sim): runHeadless — one definition of a comparable run

M0a brain-notes finding #5: the sim has no terminal condition, so sweeps
measured a dead game. At default tuning the heart dies at t~37-98s while
sweeps ran a flat 100s — 2-63% of every row was post-mortem accrual, and
rows that died at different times were never directly comparable.

Fixing that per call site would mean re-deriving "a run" in the sweep
script, in the Admin Mode compare worker, and in anything built later.
Truncation-at-death is now a property of the run itself, enforced once.

RunSpec is deliberately plain data — string unions for input and towers
rather than the callbacks they would naturally be — because the compare
feature posts it to a Web Worker via structuredClone.

'patrol' reproduces the scripted session sweep.ts and liveness.test.ts
already used, so existing numbers stay comparable across the refactor.
meanSummaries exists because one seed is not evidence: critters share an
RNG stream, so a combat lever shifts every later envelope draw.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 3: `render/bindings.ts` — discharge the render-lever debt

**Files:**
- Create: `src/render/bindings.ts`
- Test: `src/render/bindings.test.ts`
- Modify: `src/core/liveness.test.ts:7-14` (update the `RENDER_ONLY` comment)

**Interfaces:**
- Consumes: `TuningStore` type from `../core/tuning/store.ts`.
- Produces:
  ```ts
  export type RenderTarget = {
    bloom: { strength: number; radius: number; threshold: number };
    camera: { shakeGain: number };
  };
  export type RenderBinding = { key: string; apply(t: RenderTarget, v: number): void };
  export const RENDER_BINDINGS: readonly RenderBinding[];
  export const RENDER_ONLY_KEYS: readonly string[];
  export function makeRenderTarget(): RenderTarget;
  export function readRenderState(tuning: TuningStore, target: RenderTarget): void;
  ```

**Background the implementer needs:** `src/core/liveness.test.ts:7` currently reads:

```ts
// Render-only levers: never read by sim, by design.
// These will be confirmed live in M0b (render layer).
const RENDER_ONLY = new Set(['bloom.strength', 'bloom.radius', 'bloom.threshold', 'shake.amount']);
```

`CLAUDE.md` is explicit: *"Its exclusion sets must justify every entry, and the justifications must be re-verified — never add an exclusion to silence a failure."* These four are excluded from the telemetry-diff gate for a sound reason — they cannot move sim telemetry — but "will be confirmed in M0b" is a promissory note, and this task is where it comes due.

The trick that makes this testable without a browser: render levers are consumed through a **declared table** operating on a plain data `RenderTarget`, so `bindings.ts` imports nothing from three and runs under `node --test`. The three.js side later copies `RenderTarget` values onto the real `UnrealBloomPass` and camera.

**Be honest about the residual gap:** this proves the lever value reaches the property, not that three.js honours it. That last step is closed once by eye and recorded. Do not claim more than the test proves.

- [ ] **Step 1: Write the failing test**

Create `src/render/bindings.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_BINDINGS, RENDER_ONLY_KEYS, makeRenderTarget, readRenderState } from './bindings.ts';
import { makeTuning, LEVERS } from '../core/tuning/store.ts';

describe('render bindings — coverage', () => {
  test('every render-only lever has exactly one binding', () => {
    for (const key of RENDER_ONLY_KEYS) {
      const hits = RENDER_BINDINGS.filter((b) => b.key === key);
      assert.equal(hits.length, 1, `${key} has ${hits.length} bindings; expected exactly 1`);
    }
  });

  test('every binding names a lever that exists in the schema', () => {
    for (const b of RENDER_BINDINGS) {
      assert.ok(LEVERS.some((l) => l.key === b.key), `binding "${b.key}" is not a lever in LEVERS`);
    }
  });

  test('no binding is declared twice', () => {
    const keys = RENDER_BINDINGS.map((b) => b.key);
    assert.equal(new Set(keys).size, keys.length, 'duplicate binding keys');
  });
});

describe('render bindings — effect', () => {
  test('applying min and max leaves the target in different states', () => {
    for (const b of RENDER_BINDINGS) {
      const lever = LEVERS.find((l) => l.key === b.key)!;
      const lo = makeRenderTarget();
      const hi = makeRenderTarget();
      b.apply(lo, lever.min);
      b.apply(hi, lever.max);
      assert.notDeepEqual(lo, hi, `binding "${b.key}" is DEAD — target identical at min and max`);
    }
  });
});

describe('render bindings — read per frame, never cached', () => {
  test('readRenderState reflects a value changed between calls', () => {
    const tuning = makeTuning();
    const target = makeRenderTarget();

    for (const b of RENDER_BINDINGS) {
      const lever = LEVERS.find((l) => l.key === b.key)!;
      tuning.set(b.key, lever.min);
      readRenderState(tuning, target);
      const atMin = JSON.stringify(target);

      tuning.set(b.key, lever.max);
      readRenderState(tuning, target);
      const atMax = JSON.stringify(target);

      assert.notEqual(atMin, atMax, `"${b.key}" did not update on the second read — it is cached`);
    }
  });

  test('readRenderState reads every bound key on every call', () => {
    const real = makeTuning();
    const seen: string[] = [];
    const recording = {
      ...real,
      get(key: string): number {
        seen.push(key);
        return real.get(key);
      },
    };
    readRenderState(recording, makeRenderTarget());
    for (const b of RENDER_BINDINGS) {
      assert.ok(seen.includes(b.key), `readRenderState never read "${b.key}"`);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/render/bindings.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './bindings.ts'`.

- [ ] **Step 3: Implement `bindings.ts`**

Create `src/render/bindings.ts`:

```ts
// bindings.ts — how render-only levers reach the renderer, and how we prove it.
//
// THE PROBLEM. liveness.test.ts diffs telemetry at a lever's min and max to
// prove the lever is live. bloom.* and shake.amount can never move sim
// telemetry — they are render-only by design — so that gate cannot judge them,
// and they sat in a RENDER_ONLY exclusion set with the note "will be confirmed
// live in M0b". CLAUDE.md forbids unjustified exclusions; this is where the
// note comes due.
//
// THE FIX. Render levers are consumed through a declared table operating on a
// plain-data RenderTarget. Because the table is data and the target is a plain
// object, this module imports nothing from three.js and its tests run under
// node --test: no browser, no pixel diff, and it gates every commit alongside
// the rest of the suite. RENDER_ONLY stops being an exclusion and becomes a
// differently-tested set.
//
// WHAT THIS DOES NOT PROVE. That three.js honours the property once written.
// Nothing here can. That step is verified once by eye and recorded in the M0b
// report — stated rather than papered over.
//
// LIVENESS RULE. readRenderState() is called every frame and reads through
// tuning.get() every time. Never hoist a get() out of it: a render lever
// captured at construction is exactly the bug the whole rig exists to prevent.

import type { TuningStore } from '../core/tuning/store.ts';

/** Plain-data mirror of the render state a frame needs. The three.js layer
 *  copies these onto the real UnrealBloomPass and camera rig. Plain data is
 *  what makes this Node-testable. */
export type RenderTarget = {
  bloom: { strength: number; radius: number; threshold: number };
  camera: { shakeGain: number };
};

export type RenderBinding = {
  key: string;
  apply(target: RenderTarget, value: number): void;
};

/** Must match liveness.test.ts's RENDER_ONLY set exactly. */
export const RENDER_ONLY_KEYS: readonly string[] = [
  'bloom.strength',
  'bloom.radius',
  'bloom.threshold',
  'shake.amount',
];

export const RENDER_BINDINGS: readonly RenderBinding[] = [
  { key: 'bloom.strength', apply: (t, v) => { t.bloom.strength = v; } },
  { key: 'bloom.radius', apply: (t, v) => { t.bloom.radius = v; } },
  { key: 'bloom.threshold', apply: (t, v) => { t.bloom.threshold = v; } },
  { key: 'shake.amount', apply: (t, v) => { t.camera.shakeGain = v; } },
];

export function makeRenderTarget(): RenderTarget {
  return {
    bloom: { strength: 0, radius: 0, threshold: 0 },
    camera: { shakeGain: 0 },
  };
}

/** Refresh `target` from the live tuning store. Call once per frame. */
export function readRenderState(tuning: Pick<TuningStore, 'get'>, target: RenderTarget): void {
  for (const b of RENDER_BINDINGS) b.apply(target, tuning.get(b.key));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/render/bindings.test.ts 2>&1 | tail -20`
Expected: PASS, 6 tests.

- [ ] **Step 5: Update the `RENDER_ONLY` justification in `liveness.test.ts`**

Replace lines 7–14 of `src/core/liveness.test.ts`:

```ts
// Render-only levers: they cannot move sim telemetry by design, so the
// diff-the-telemetry gate below cannot judge them. They are NOT untested —
// src/render/bindings.test.ts gates them instead, asserting that each has
// exactly one declared binding, that min and max leave the render target in
// different states, and that readRenderState re-reads every key each frame
// (never caching). Keep this set in sync with RENDER_ONLY_KEYS in
// src/render/bindings.ts; the coverage test there fails if one drifts.
//
// Residual gap, stated rather than hidden: bindings.test.ts proves the value
// reaches the property, not that three.js honours it. That is verified by eye.
const RENDER_ONLY = new Set([
  'bloom.strength',
  'bloom.radius',
  'bloom.threshold',
  'shake.amount',
]);
```

- [ ] **Step 6: Sabotage the guard, then restore it**

`CLAUDE.md`: *"Sabotage your own guard. Break the code a test protects and confirm the test fails."*

Temporarily change the `bloom.radius` binding in `src/render/bindings.ts` to a no-op:

```ts
  { key: 'bloom.radius', apply: () => { /* sabotage */ } },
```

Run: `node --test src/render/bindings.test.ts 2>&1 | tail -20`
Expected: FAIL with `binding "bloom.radius" is DEAD — target identical at min and max` **and** `"bloom.radius" did not update on the second read`.

Now restore the real binding and re-run — expected PASS. A regression test that passes against its own bug certifies the bug.

- [ ] **Step 7: Full suite and typecheck**

Run: `npm test 2>&1 | tail -5 && npm run typecheck`
Expected: `fail 0`, typecheck silent.

- [ ] **Step 8: Commit**

```bash
git add src/render/bindings.ts src/render/bindings.test.ts src/core/liveness.test.ts
git commit -F - <<'EOF'
feat(render): declarative render-lever bindings; discharge the RENDER_ONLY debt

liveness.test.ts carried four levers in a RENDER_ONLY exclusion set with the
note "will be confirmed live in M0b". CLAUDE.md forbids unjustified
exclusions, so the note came due.

bloom.* and shake.amount genuinely cannot move sim telemetry, so the
diff-the-telemetry gate cannot judge them. Rather than leave them untested or
reach for a browser, render levers now flow through a declared table over a
plain-data RenderTarget. The table is data and the target is a plain object,
so this module imports nothing from three and its tests run under node --test
— gating every commit rather than an occasional manual pass.

RENDER_ONLY is no longer an exclusion; it is a differently-tested set, and a
coverage test fails if the two lists drift apart.

Verified by sabotage: making the bloom.radius binding a no-op fails both the
effect assertion and the per-frame-read assertion, then passes on restore.

Residual gap stated in the source rather than papered over: this proves the
value reaches the property, not that three.js honours it.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

*Tasks 4–13 continue in `2026-08-26-m0b-rig-visible-part2.md` — first light (board + bloom on screen), the fixed-timestep loop, unit rendering, the camera rig, input, HUD, and Admin Mode.*
