# M0a — The Brain · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A headless, deterministic, fully-tunable TTD simulation — sphere board, waves, critters, towers, tank, telemetry — that can be stepped and measured entirely in Node, before any renderer exists.

**Architecture:** Everything lands under `src/core/`, which is forbidden from importing three.js, calling `Math.random`, or touching the DOM/wall-clock (enforced by `architecture.test.ts`). A `TuningStore` is read **per-tick** by every system so every lever is live by construction. A `World` object owns state and advances via `tick(dt, input)`. `Telemetry` accumulates inside the sim so a headless sweep produces the same numbers as a played session.

**Tech Stack:** TypeScript 5.7 (strict, `noUncheckedIndexedAccess`), Node 24 native type-stripping test runner, no runtime dependencies in `core/`.

**Spec:** `docs/01-M0-tuning-rig-spec.md` (§3 architecture, §4 schema, §5 telemetry, §7 content, §8 testing)

## Global Constraints

- **Do NOT push in any task — commits stay LOCAL; the controller pushes once at the end after the final review.**
- `src/core/` must never import three.js, call `Math.random`, or reference `document`/`window`/`performance.now()`/`Date.now()`. `architecture.test.ts` enforces this — it must stay green.
- **Determinism:** all randomness comes from `stream(seed, name)` in `core/sim/rng.ts`. Every system gets its OWN named stream so adding a draw in one system cannot reshuffle another.
- **Live-by-construction:** a system reads a lever via `tuning.get('key')` *inside* the tick, never captured into a local at construction. A lever that needs a rebuild is a bug.
- `npm test` and `npm run typecheck` must both pass before every commit.
- Commit trailer (exact two lines) on EVERY commit:
  ```
  Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01QH1hQk64Cw4ZwpAi59Pnat
  ```
- Work in `~/Dev/TTD`. Port sources are in `~/Dev/spherical-stalberg-grid/src/` — **port, don't copy**: re-type, redraw APIs, rewrite tests.

---

### Task 1: Port the sphere pipeline

**Files:**
- Create: `src/core/sphere/vec3.ts`, `src/core/sphere/grid.ts`, `src/core/sphere/grid.test.ts`
- Reference: `~/Dev/spherical-stalberg-grid/src/grid.js` (377 lines), `~/Dev/spherical-stalberg-grid/test/smoke.mjs`

**Interfaces:**
- Produces:
  ```ts
  export type Vec3 = readonly [number, number, number];
  export type SphereMesh = {
    verts: Vec3[];            // unit-length positions
    quads: number[][];        // each an array of 4 vertex indices
    centers: Vec3[];          // per-quad centroid, normalized
    normals: Vec3[];          // per-quad outward normal (== normalized centre)
    adj: number[][];          // per-quad edge-adjacent quad indices
  };
  export function generateSphereMesh(opts: {
    seed: number; points: number; relaxIters?: number;
  }): SphereMesh;
  export function squarenessError(mesh: SphereMesh): number;
  export function valences(mesh: SphereMesh): Map<number, number>;
  ```

- [ ] **Step 1: Read the source before porting.** Read `~/Dev/spherical-stalberg-grid/src/grid.js` end to end and `test/smoke.mjs`. The pipeline is: blue-noise sample → convex hull as Delaunay → tri/quad merge → subdivide → tangent-plane relax → dual. Do NOT re-derive the maths; port it. The parts that are hard-won and must be preserved exactly: hull-as-Delaunay (every point on a sphere is extreme, so hull faces = Delaunay), the tangent-plane square fit with the **projected-signed-area check** deciding CW read, and the voxel-hash sampler.

- [ ] **Step 2: Extract `vec3.ts` first.** The PoC has vector helpers inline. Give them a real module with a `Vec3` type: `add`, `sub`, `scale`, `dot`, `cross`, `norm`, `len`, `dist`, `lerp`, `normalize`. Pure functions over `readonly [number,number,number]`. Write `vec3.test.ts` covering each (including that `normalize` of a zero vector doesn't produce `NaN` — return a fallback axis).

- [ ] **Step 3: Write the failing invariant test** (`src/core/sphere/grid.test.ts`), porting and strengthening `smoke.mjs`:
  ```ts
  import { test } from 'node:test';
  import assert from 'node:assert/strict';
  import { generateSphereMesh, squarenessError, valences } from './grid.ts';

  const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 60 });

  test('every face is a quad', () => {
    assert.ok(MESH.quads.length > 0);
    for (const q of MESH.quads) assert.equal(q.length, 4, 'non-quad face');
  });

  test('all vertices are on the unit sphere', () => {
    for (const v of MESH.verts) {
      const r = Math.hypot(v[0], v[1], v[2]);
      assert.ok(Math.abs(r - 1) < 1e-6, `vertex off sphere: r=${r}`);
    }
  });

  test('adjacency is symmetric and self-free', () => {
    MESH.adj.forEach((nbrs, i) => {
      for (const n of nbrs) {
        assert.notEqual(n, i, 'cell adjacent to itself');
        assert.ok(MESH.adj[n]?.includes(i), `adjacency not symmetric: ${i}<->${n}`);
      }
    });
  });

  test('centers and normals align per quad', () => {
    assert.equal(MESH.centers.length, MESH.quads.length);
    assert.equal(MESH.normals.length, MESH.quads.length);
  });

  test('generation is deterministic for a seed', () => {
    const a = generateSphereMesh({ seed: 11, points: 400, relaxIters: 20 });
    const b = generateSphereMesh({ seed: 11, points: 400, relaxIters: 20 });
    assert.deepEqual(a.centers, b.centers);
  });

  test('different seeds differ', () => {
    const a = generateSphereMesh({ seed: 11, points: 400, relaxIters: 20 });
    const b = generateSphereMesh({ seed: 12, points: 400, relaxIters: 20 });
    assert.notDeepEqual(a.centers, b.centers);
  });

  test('relaxation improves squareness and never produces NaN', () => {
    const raw = generateSphereMesh({ seed: 5, points: 400, relaxIters: 0 });
    const done = generateSphereMesh({ seed: 5, points: 400, relaxIters: 80 });
    const e0 = squarenessError(raw);
    const e1 = squarenessError(done);
    assert.ok(Number.isFinite(e0) && Number.isFinite(e1), 'NaN squareness');
    assert.ok(e1 < e0, `relax made it worse: ${e0} -> ${e1}`);
  });

  test('valence distribution is sane (mostly 4)', () => {
    const v = valences(MESH);
    const total = [...v.values()].reduce((a, b) => a + b, 0);
    const four = v.get(4) ?? 0;
    assert.ok(four / total > 0.6, `too few regular vertices: ${four}/${total}`);
  });
  ```

- [ ] **Step 4: Run it and watch it fail.** `npm test` → fails, `grid.ts` doesn't exist.

- [ ] **Step 5: Port `grid.ts` until the tests pass.** Keep function boundaries but give them types and named options objects. Seeded via `stream(seed, 'grid')`. No `Math.random`.

- [ ] **Step 6: Verify.** `npm run typecheck && npm test` → all green, including `architecture.test.ts`.

- [ ] **Step 7: Commit (LOCAL).**
  ```bash
  git add -A && git commit -m "core/sphere: port the Stalberg sphere pipeline to TS"
  ```

---

### Task 2: Port dungeon + cell index

**Files:**
- Create: `src/core/sphere/dungeon.ts`, `src/core/sphere/dungeon.test.ts`, `src/core/sphere/cellindex.ts`, `src/core/sphere/cellindex.test.ts`
- Reference: `~/Dev/spherical-stalberg-grid/src/dungeon.js`, `src/cellindex.js`, `test/maze.mjs`

**Interfaces:**
- Consumes: `SphereMesh`, `Vec3` (Task 1).
- Produces:
  ```ts
  export const BLOCKED = 0, PATH = 1, ROOM = 2;
  export type CellTag = typeof BLOCKED | typeof PATH | typeof ROOM;
  export type Dungeon = {
    tags: CellTag[];
    heart: number;            // cell index of the heart
    spawn: number;            // far endpoint
    distToHeart: number[];    // BFS field; -1 where unreachable
  };
  export function generateDungeon(mesh: SphereMesh, opts: {
    seed: number; rooms: number; roomRadius: number;
    extraCorridors: number; corridorWidth: number; obstacles: number;
  }): Dungeon;
  export function bfsDist(adj: number[][], sources: number[], passable?: (i: number) => boolean): number[];
  export function openNeighbors(d: Dungeon, mesh: SphereMesh, cell: number): number[];

  export function makeCellIndex(centers: readonly Vec3[], cellSize: number): (p: Vec3) => number;
  ```

- [ ] **Step 1: Write the failing dungeon invariants**, porting `maze.mjs` and adding the ones the PoC learned the hard way:
  ```ts
  const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
  const D = generateDungeon(MESH, { seed: 7, rooms: 12, roomRadius: 4,
    extraCorridors: 6, corridorWidth: 1, obstacles: 0.2 });

  test('tags cover every cell', () => assert.equal(D.tags.length, MESH.quads.length));

  test('the open subgraph is fully connected', () => {
    const open = (i: number) => D.tags[i] !== BLOCKED;
    const first = D.tags.findIndex((t) => t !== BLOCKED);
    const dist = bfsDist(MESH.adj, [first], open);
    const unreachable = D.tags.filter((t, i) => t !== BLOCKED && dist[i] === -1);
    assert.equal(unreachable.length, 0, 'open cells stranded from the rest');
  });

  test('heart and spawn are open and distinct', () => {
    assert.notEqual(D.heart, D.spawn);
    assert.notEqual(D.tags[D.heart], BLOCKED);
    assert.notEqual(D.tags[D.spawn], BLOCKED);
  });

  test('distToHeart is 0 at the heart and -1 only where blocked/unreachable', () => {
    assert.equal(D.distToHeart[D.heart], 0);
    D.distToHeart.forEach((d, i) => {
      if (D.tags[i] !== BLOCKED) assert.ok(d >= 0, `open cell ${i} has no path to the heart`);
    });
  });

  test('the journey is non-trivial', () => {
    assert.ok((D.distToHeart[D.spawn] ?? 0) > 10, 'spawn is too close to the heart');
  });

  test('deterministic for a seed', () => {
    const a = generateDungeon(MESH, { seed: 3, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1, obstacles: 0.2 });
    const b = generateDungeon(MESH, { seed: 3, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1, obstacles: 0.2 });
    assert.deepEqual(a.tags, b.tags);
  });

  test('openNeighbors returns only open, adjacent cells', () => {
    for (const c of [D.heart, D.spawn]) {
      for (const n of openNeighbors(D, MESH, c)) {
        assert.ok(MESH.adj[c]?.includes(n), 'not adjacent');
        assert.notEqual(D.tags[n], BLOCKED, 'not open');
      }
    }
  });
  ```

- [ ] **Step 2: Write the failing cell-index test.** The voxel hash answers "which cell contains this world point" — it is the collision oracle, so it must never return a wrong cell for a point that IS a centre:
  ```ts
  test('a cell centre resolves to its own cell', () => {
    const idx = makeCellIndex(MESH.centers, 0.05);
    MESH.centers.forEach((c, i) => assert.equal(idx(c), i, `centre of ${i} resolved elsewhere`));
  });

  test('a nudged point resolves to a nearby cell', () => {
    const idx = makeCellIndex(MESH.centers, 0.05);
    const i = 10;
    const c = MESH.centers[i]!;
    const near = idx([c[0] + 1e-4, c[1], c[2]] as Vec3);
    assert.ok(near === i || MESH.adj[i]?.includes(near), 'nudge jumped far away');
  });
  ```

- [ ] **Step 3: Run and watch both fail.** `npm test`.

- [ ] **Step 4: Port both modules** until green. `generateDungeon` uses `stream(seed, 'dungeon')` — a *different* stream from the grid, so changing terrain generation cannot reshuffle the dungeon.

- [ ] **Step 5: Verify + commit (LOCAL).**
  ```bash
  npm run typecheck && npm test
  git add -A && git commit -m "core/sphere: port dungeon carve + voxel cell index to TS"
  ```

---

### Task 3: The tuning store

**Files:**
- Create: `src/core/tuning/schema.ts`, `src/core/tuning/store.ts`, `src/core/tuning/store.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type LeverGroup = 'intensity' | 'critters' | 'player' | 'feel' | 'camera' | 'god';
  export type Lever = {
    key: string; group: LeverGroup; label: string;
    min: number; max: number; step: number; value: number; help?: string;
  };
  export const LEVERS: readonly Lever[];              // schema.ts — the single source of truth
  export type TuningStore = {
    get(key: string): number;                          // numeric value
    flag(key: string): boolean;                        // value !== 0, for bool levers
    set(key: string, value: number): void;             // clamped to [min,max]
    all(): Lever[];
    reset(group?: LeverGroup): void;
    export(): string;                                  // compact preset string
    import(text: string): void;                        // tolerant of unknown/missing keys
    onChange(fn: (key: string, value: number) => void): () => void;
  };
  export function makeTuning(overrides?: Record<string, number>): TuningStore;
  ```

- [ ] **Step 1: Write `schema.ts`** with the M0 levers exactly as specced in `01-M0-tuning-rig-spec.md` §4. Booleans are levers with `min:0, max:1, step:1`. Every entry needs a `help` string — the dashboard shows it and it is the only documentation these will ever get.

- [ ] **Step 2: Write the failing store test:**
  ```ts
  test('defaults come from the schema', () => {
    const t = makeTuning();
    for (const l of LEVERS) assert.equal(t.get(l.key), l.value);
  });

  test('set clamps to range', () => {
    const t = makeTuning();
    t.set('enemy.speed', 999);
    assert.equal(t.get('enemy.speed'), 3.0);
    t.set('enemy.speed', -5);
    assert.equal(t.get('enemy.speed'), 0.2);
  });

  test('get on an unknown key throws (a typo must not silently read 0)', () => {
    const t = makeTuning();
    assert.throws(() => t.get('enemy.speeed'), /unknown lever/);
  });

  test('flag reads booleans', () => {
    const t = makeTuning();
    t.set('god.heartInvulnerable', 1);
    assert.equal(t.flag('god.heartInvulnerable'), true);
  });

  test('export/import round-trips exactly', () => {
    const a = makeTuning();
    a.set('enemy.speed', 1.7);
    a.set('wave.dripRate', 0.35);
    const b = makeTuning();
    b.import(a.export());
    assert.deepEqual(b.all(), a.all());
  });

  test('import ignores unknown keys and keeps defaults for missing ones', () => {
    const t = makeTuning();
    t.import('enemy.speed=1.5;bogus.key=9');
    assert.equal(t.get('enemy.speed'), 1.5);
    assert.equal(t.get('wave.size'), LEVERS.find((l) => l.key === 'wave.size')!.value);
  });

  test('reset restores defaults, optionally by group', () => {
    const t = makeTuning();
    t.set('enemy.speed', 2); t.set('wave.size', 30);
    t.reset('critters');
    assert.equal(t.get('enemy.speed'), LEVERS.find((l) => l.key === 'enemy.speed')!.value);
    assert.equal(t.get('wave.size'), 30, 'other groups untouched');
  });

  test('onChange fires and unsubscribes', () => {
    const t = makeTuning();
    const seen: string[] = [];
    const off = t.onChange((k) => seen.push(k));
    t.set('enemy.speed', 1.2);
    off();
    t.set('enemy.speed', 1.3);
    assert.deepEqual(seen, ['enemy.speed']);
  });
  ```

- [ ] **Step 3: Run, fail, implement, pass.** `npm test`.

- [ ] **Step 4: Commit (LOCAL).**
  ```bash
  git add -A && git commit -m "core/tuning: lever schema + live store with presets"
  ```

---

### Task 4: Telemetry

**Files:**
- Create: `src/core/sim/telemetry.ts`, `src/core/sim/telemetry.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type Telemetry = {
    // difficulty
    heartHits: number; tankHits: number; leaks: number;
    kills: number; killsByTower: number; killsByPlayer: number;
    ttk: number[];                         // seconds per kill
    waveClearTimes: number[];
    peakConcurrent: number;
    // layer balance (spec §5)
    timeMacro: number; timeTactical: number;
    modeSwitches: number;
    tankIdleUnderThreat: number;
    decisionsThisPhase: number;
    elapsed: number;
  };
  export function makeTelemetry(): {
    data: Telemetry;
    tick(dt: number, ctx: { macro: boolean; enemiesAlive: number; tankActing: boolean }): void;
    kill(by: 'tower' | 'player', ageSeconds: number): void;
    heartHit(): void; tankHit(): void; leak(): void;
    decision(): void; waveCleared(seconds: number): void;
    summary(): Record<string, number>;     // derived: ratios, means, p90
    reset(): void;
  };
  ```

- [ ] **Step 1: Write the failing test.** These are exact-count assertions over a scripted run — telemetry that is even slightly wrong makes every tuning comparison a lie:
  ```ts
  test('counters are exact over a scripted run', () => {
    const t = makeTelemetry();
    t.heartHit(); t.heartHit(); t.tankHit(); t.leak();
    t.kill('tower', 2); t.kill('player', 4); t.kill('player', 6);
    assert.equal(t.data.heartHits, 2);
    assert.equal(t.data.tankHits, 1);
    assert.equal(t.data.leaks, 1);
    assert.equal(t.data.kills, 3);
    assert.equal(t.data.killsByTower, 1);
    assert.equal(t.data.killsByPlayer, 2);
  });

  test('macro/tactical time splits by mode', () => {
    const t = makeTelemetry();
    for (let i = 0; i < 10; i++) t.tick(0.1, { macro: true, enemiesAlive: 0, tankActing: false });
    for (let i = 0; i < 30; i++) t.tick(0.1, { macro: false, enemiesAlive: 2, tankActing: true });
    assert.ok(Math.abs(t.data.timeMacro - 1) < 1e-6);
    assert.ok(Math.abs(t.data.timeTactical - 3) < 1e-6);
  });

  test('mode switches counted on transitions only', () => {
    const t = makeTelemetry();
    const seq = [true, true, false, false, true];
    for (const macro of seq) t.tick(0.1, { macro, enemiesAlive: 0, tankActing: false });
    assert.equal(t.data.modeSwitches, 2);
  });

  test('tank idle-under-threat only accrues with enemies alive and tank idle', () => {
    const t = makeTelemetry();
    t.tick(1, { macro: false, enemiesAlive: 0, tankActing: false });  // no threat
    t.tick(1, { macro: false, enemiesAlive: 3, tankActing: true });   // acting
    t.tick(1, { macro: false, enemiesAlive: 3, tankActing: false });  // counts
    assert.ok(Math.abs(t.data.tankIdleUnderThreat - 1) < 1e-6);
  });

  test('peak concurrency is a high-water mark', () => {
    const t = makeTelemetry();
    for (const n of [1, 5, 3, 9, 2]) t.tick(0.1, { macro: false, enemiesAlive: n, tankActing: false });
    assert.equal(t.data.peakConcurrent, 9);
  });

  test('summary derives the balance ratios', () => {
    const t = makeTelemetry();
    for (let i = 0; i < 10; i++) t.tick(0.1, { macro: true, enemiesAlive: 0, tankActing: false });
    for (let i = 0; i < 10; i++) t.tick(0.1, { macro: false, enemiesAlive: 0, tankActing: false });
    t.kill('tower', 1); t.kill('player', 1); t.kill('player', 1);
    const s = t.summary();
    assert.ok(Math.abs(s['macroShare']! - 0.5) < 1e-6);
    assert.ok(Math.abs(s['playerKillShare']! - 2 / 3) < 1e-6);
  });

  test('reset clears everything', () => {
    const t = makeTelemetry();
    t.heartHit(); t.tick(1, { macro: true, enemiesAlive: 1, tankActing: false });
    t.reset();
    assert.equal(t.data.heartHits, 0);
    assert.equal(t.data.elapsed, 0);
  });
  ```

- [ ] **Step 2: Run, fail, implement, pass, commit (LOCAL).**
  ```bash
  npm run typecheck && npm test
  git add -A && git commit -m "core/sim: telemetry — difficulty + layer-balance counters"
  ```

---

### Task 5: Critters — motion, speed envelope, hit reactions

**Files:**
- Create: `src/core/sim/critters.ts`, `src/core/sim/critters.test.ts`

**Interfaces:**
- Consumes: `Dungeon`, `SphereMesh`, `openNeighbors`, `TuningStore`, `Rng`.
- Produces:
  ```ts
  export type Critter = {
    id: number; alive: boolean; hp: number;
    cur: number; next: number; prog: number;   // graph traversal
    pos: Vec3;
    envPhase: number; envValue: number; envTarget: number; envLeft: number;
    reactMult: number; reactLeft: number;
    bornAt: number;
  };
  export function spawnCritter(id: number, cell: number, tuning: TuningStore, rng: Rng, now: number): Critter;
  /** Advance one critter. Returns 'arrived' when it reaches the heart. */
  export function stepCritter(c: Critter, dt: number, ctx: {
    mesh: SphereMesh; dungeon: Dungeon; tuning: TuningStore; rng: Rng;
  }): 'moving' | 'arrived';
  export function effectiveSpeed(c: Critter, tuning: TuningStore): number;
  export function hitCritter(c: Critter, damage: number, tuning: TuningStore): boolean; // true if killed
  ```

**The speed envelope** is the stressor the operator singled out. It re-targets on a cadence rather than following a smooth curve — the PoC's predictable sine is exactly why it doesn't bite:
```
every (surgeCadence ± surgeJitter) seconds:
  envTarget = 1 + (rng()*2 - 1) * surgeAmp
envValue eases toward envTarget
effectiveSpeed = enemy.speed * envValue * reactMult
```

- [ ] **Step 1: Write the failing tests:**
  ```ts
  test('speed envelope stays within [1-amp, 1+amp]', () => {
    const t = makeTuning(); t.set('enemy.surgeAmp', 0.5);
    const c = spawnCritter(0, D.spawn, t, stream(1, 'x'), 0);
    for (let i = 0; i < 3000; i++) {
      stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng: stream(1, 'x') });
      assert.ok(c.envValue >= 0.5 - 1e-6 && c.envValue <= 1.5 + 1e-6, `envelope escaped: ${c.envValue}`);
    }
  });

  test('zero amplitude means constant speed', () => {
    const t = makeTuning(); t.set('enemy.surgeAmp', 0);
    const c = spawnCritter(0, D.spawn, t, stream(1, 'x'), 0);
    for (let i = 0; i < 200; i++) stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng: stream(1, 'x') });
    assert.ok(Math.abs(c.envValue - 1) < 1e-6);
  });

  test('the envelope actually varies when amplitude is high', () => {
    const t = makeTuning(); t.set('enemy.surgeAmp', 0.6); t.set('enemy.surgeCadence', 0.3);
    const rng = stream(2, 'env');
    const c = spawnCritter(0, D.spawn, t, rng, 0);
    const seen = new Set<string>();
    for (let i = 0; i < 600; i++) {
      stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng });
      seen.add(c.envValue.toFixed(2));
    }
    assert.ok(seen.size > 5, 'envelope is not varying');
  });

  test('enemy.speed is read live — changing it mid-flight changes pace', () => {
    const t = makeTuning();
    t.set('enemy.surgeAmp', 0);
    const c = spawnCritter(0, D.spawn, t, stream(3, 'x'), 0);
    t.set('enemy.speed', 1.0);
    const slow = effectiveSpeed(c, t);
    t.set('enemy.speed', 2.0);
    const fast = effectiveSpeed(c, t);
    assert.ok(Math.abs(fast - slow * 2) < 1e-9, 'lever was captured, not read live');
  });

  test('accelOnHit applies for reactionDur then expires', () => {
    const t = makeTuning();
    t.set('enemy.surgeAmp', 0); t.set('enemy.accelOnHit', 2); t.set('enemy.reactionDur', 1); t.set('enemy.hp', 10);
    const c = spawnCritter(0, D.spawn, t, stream(4, 'x'), 0);
    hitCritter(c, 1, t);
    assert.equal(c.reactMult, 2);
    for (let i = 0; i < 40; i++) stepCritter(c, 0.05, { mesh: MESH, dungeon: D, tuning: t, rng: stream(4, 'x') });
    assert.equal(c.reactMult, 1, 'reaction never expired');
  });

  test('a critter walks downhill to the heart and arrives', () => {
    const t = makeTuning(); t.set('enemy.speed', 3); t.set('enemy.surgeAmp', 0);
    const rng = stream(5, 'walk');
    const c = spawnCritter(0, D.spawn, t, rng, 0);
    let result: string = 'moving';
    for (let i = 0; i < 20000 && result === 'moving'; i++) {
      result = stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng });
    }
    assert.equal(result, 'arrived', 'critter never reached the heart');
  });

  test('a critter never enters a blocked cell', () => {
    const t = makeTuning(); t.set('enemy.speed', 3);
    const rng = stream(6, 'walk');
    const c = spawnCritter(0, D.spawn, t, rng, 0);
    for (let i = 0; i < 5000; i++) {
      if (stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng }) === 'arrived') break;
      assert.notEqual(D.tags[c.cur], BLOCKED, 'walked into a wall');
    }
  });

  test('hitCritter returns true exactly when hp runs out', () => {
    const t = makeTuning(); t.set('enemy.hp', 3);
    const c = spawnCritter(0, D.spawn, t, stream(7, 'x'), 0);
    assert.equal(hitCritter(c, 1, t), false);
    assert.equal(hitCritter(c, 1, t), false);
    assert.equal(hitCritter(c, 1, t), true);
    assert.equal(c.alive, false);
  });
  ```

- [ ] **Step 2: Run, fail, implement, pass.** Movement follows `distToHeart` downhill (the nav field from Task 2), advancing `prog` by `speed*dt / segmentLength` and carrying leftover distance across arrivals so pace doesn't lurch across cells of different sizes.

- [ ] **Step 3: Commit (LOCAL).**
  ```bash
  git add -A && git commit -m "core/sim: critters — nav-graph march, live speed envelope, hit reactions"
  ```

---

### Task 6: The wave engine

**Files:**
- Create: `src/core/sim/waves.ts`, `src/core/sim/waves.test.ts`

**Interfaces:**
- Consumes: `TuningStore`, `Rng`.
- Produces:
  ```ts
  export type SpawnEvent = { at: number; gate: number };   // seconds from wave start
  export type WavePlan = { wave: number; count: number; hp: number; events: SpawnEvent[] };
  export function planWave(wave: number, tuning: TuningStore, rng: Rng, gates: number[]): WavePlan;
  export type WaveState = 'idle' | 'spawning' | 'engaged' | 'breathing';
  export type WaveEngine = {
    state: WaveState; wave: number;
    tick(dt: number, ctx: { enemiesAlive: number; onSpawn: (gate: number) => void }): void;
    plan(): WavePlan | null;
    timeToNext(): number;
  };
  export function makeWaveEngine(tuning: TuningStore, rng: Rng, gates: number[]): WaveEngine;
  ```

**The drip** is the HK finding — spawns are spread over time, not dumped:
```
events[i].at = i * dripRate * (1 ± dripJitter)   round-robin across gates
```
**Overlap** decides when the next wave may begin: `0` waits for a full clear plus `wave.gap`; `1` starts as soon as this wave has finished spawning; between, it starts once `enemiesAlive <= (1-overlap) * count`.

- [ ] **Step 1: Write the failing tests:**
  ```ts
  test('plan count follows wave.size and sizeGrowth', () => {
    const t = makeTuning(); t.set('wave.size', 10); t.set('wave.sizeGrowth', 1);
    assert.equal(planWave(1, t, stream(1, 'w'), [0, 1]).count, 10);
    assert.equal(planWave(3, t, stream(1, 'w'), [0, 1]).count, 12);
  });

  test('drip spreads spawns over time and is ordered', () => {
    const t = makeTuning(); t.set('wave.size', 8); t.set('wave.dripRate', 0.5); t.set('wave.dripJitter', 0);
    const p = planWave(1, t, stream(1, 'w'), [0, 1]);
    assert.equal(p.events.length, 8);
    const times = p.events.map((e) => e.at);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'events out of order');
    assert.ok(Math.abs(times[7]! - 3.5) < 1e-6, `last spawn at ${times[7]}, expected 3.5`);
  });

  test('dripRate 0.1 vs 2.0 is the difference between a burst and a trickle', () => {
    const t = makeTuning(); t.set('wave.size', 10); t.set('wave.dripJitter', 0);
    t.set('wave.dripRate', 0.1);
    const burst = planWave(1, t, stream(1, 'w'), [0]);
    t.set('wave.dripRate', 2.0);
    const trickle = planWave(1, t, stream(1, 'w'), [0]);
    assert.ok(trickle.events[9]!.at > burst.events[9]!.at * 10);
  });

  test('jitter perturbs but keeps order and non-negativity', () => {
    const t = makeTuning(); t.set('wave.size', 20); t.set('wave.dripRate', 0.5); t.set('wave.dripJitter', 0.9);
    const p = planWave(1, t, stream(9, 'w'), [0]);
    const times = p.events.map((e) => e.at);
    assert.ok(times.every((x) => x >= 0));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  test('spawns round-robin across gates', () => {
    const t = makeTuning(); t.set('wave.size', 6);
    const p = planWave(1, t, stream(1, 'w'), [10, 20]);
    assert.deepEqual(p.events.map((e) => e.gate), [10, 20, 10, 20, 10, 20]);
  });

  test('hp follows hpGrowth compounding per wave', () => {
    const t = makeTuning(); t.set('enemy.hp', 10); t.set('wave.hpGrowth', 1.1);
    assert.ok(Math.abs(planWave(1, t, stream(1, 'w'), [0]).hp - 10) < 1e-9);
    assert.ok(Math.abs(planWave(3, t, stream(1, 'w'), [0]).hp - 12.1) < 1e-6);
  });

  test('overlap 0 waits for a clear before the next wave', () => {
    const t = makeTuning();
    t.set('wave.size', 3); t.set('wave.dripRate', 0.1); t.set('wave.overlap', 0); t.set('wave.gap', 2);
    const e = makeWaveEngine(t, stream(1, 'w'), [0]);
    let spawned = 0;
    for (let i = 0; i < 100; i++) e.tick(0.1, { enemiesAlive: 3, onSpawn: () => spawned++ });
    assert.equal(e.wave, 1, 'started wave 2 while the field was full');
  });

  test('overlap 1 does not wait for a clear', () => {
    const t = makeTuning();
    t.set('wave.size', 3); t.set('wave.dripRate', 0.1); t.set('wave.overlap', 1); t.set('wave.gap', 0);
    const e = makeWaveEngine(t, stream(1, 'w'), [0]);
    for (let i = 0; i < 200; i++) e.tick(0.1, { enemiesAlive: 99, onSpawn: () => {} });
    assert.ok(e.wave > 1, 'never advanced despite overlap=1');
  });

  test('the engine emits exactly count spawns per wave', () => {
    const t = makeTuning();
    t.set('wave.size', 7); t.set('wave.dripRate', 0.2); t.set('wave.overlap', 0); t.set('wave.gap', 1);
    const e = makeWaveEngine(t, stream(1, 'w'), [0]);
    let spawned = 0;
    for (let i = 0; i < 100; i++) e.tick(0.05, { enemiesAlive: 1, onSpawn: () => spawned++ });
    assert.equal(spawned, 7);
  });
  ```

- [ ] **Step 2: Run, fail, implement, pass, commit (LOCAL).**
  ```bash
  npm run typecheck && npm test
  git add -A && git commit -m "core/sim: wave engine — drip schedule, jitter, overlap, growth"
  ```

---

### Task 7: Towers, tank, and the World

**Files:**
- Create: `src/core/sim/towers.ts`, `src/core/sim/tank.ts`, `src/core/sim/world.ts`, `src/core/sim/world.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  ```ts
  export type Tower = { id: number; cell: number; pos: Vec3; cooldown: number; kills: number };
  export type Tank = { pos: Vec3; cell: number; heading: Vec3; cooldown: number; hp: number; hits: number };
  export type TankInput = { forward: number; turn: number; fire: boolean };  // -1..1
  export type World = {
    mesh: SphereMesh; dungeon: Dungeon;
    critters: Critter[]; towers: Tower[]; tank: Tank;
    heartHp: number; macro: boolean;
    tuning: TuningStore; telemetry: ReturnType<typeof makeTelemetry>;
    waves: WaveEngine; elapsed: number;
    tick(dt: number, input: TankInput): void;
    placeTower(cell: number): boolean;    // false if illegal; counts a decision
    setMacro(on: boolean): void;
  };
  export function makeWorld(opts: { seed: number; tuning: TuningStore }): World;
  ```

- [ ] **Step 1: Write the failing world tests — including the keystone.**
  ```ts
  const scripted = (w: World, steps: number) => {
    for (let i = 0; i < steps; i++) {
      w.tick(1 / 60, { forward: (i % 120) < 60 ? 1 : -1, turn: Math.sin(i / 30), fire: i % 45 === 0 });
    }
  };

  test('REPLAY DETERMINISM: same seed + preset + input => identical telemetry', () => {
    const mk = () => {
      const t = makeTuning(); t.import('enemy.speed=1.4;wave.size=8;wave.dripRate=0.4');
      const w = makeWorld({ seed: 42, tuning: t });
      w.placeTower(w.dungeon.heart);
      return w;
    };
    const a = mk(); const b = mk();
    scripted(a, 4000); scripted(b, 4000);
    assert.deepEqual(a.telemetry.summary(), b.telemetry.summary());
    assert.equal(a.critters.length, b.critters.length);
    assert.equal(a.heartHp, b.heartHp);
  });

  test('towers kill critters and it is attributed to the tower', () => {
    const t = makeTuning();
    t.set('tower.damage', 100); t.set('tower.range', 5); t.set('tower.rate', 10); t.set('enemy.speed', 2);
    const w = makeWorld({ seed: 1, tuning: t });
    w.placeTower(w.dungeon.spawn);
    scripted(w, 3000);
    assert.ok(w.telemetry.data.killsByTower > 0, 'tower never killed anything');
  });

  test('god mode prevents heart death but still counts hits', () => {
    const t = makeTuning();
    t.set('god.heartInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
    const w = makeWorld({ seed: 2, tuning: t });
    const hp0 = w.heartHp;
    scripted(w, 8000);
    assert.ok(w.telemetry.data.heartHits > 0, 'nothing ever reached the heart');
    assert.equal(w.heartHp, hp0, 'heart lost hp despite god mode');
  });

  test('placeTower rejects blocked cells and counts decisions', () => {
    const w = makeWorld({ seed: 3, tuning: makeTuning() });
    const blocked = w.dungeon.tags.findIndex((x) => x === BLOCKED);
    assert.equal(w.placeTower(blocked), false);
    const open = w.dungeon.heart;
    assert.equal(w.placeTower(open), true);
    assert.equal(w.telemetry.data.decisionsThisPhase, 1, 'a rejected placement must not count');
  });

  test('macro mode routes time to the macro counter', () => {
    const w = makeWorld({ seed: 4, tuning: makeTuning() });
    w.setMacro(true);
    for (let i = 0; i < 60; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
    assert.ok(w.telemetry.data.timeMacro > 0.9);
    assert.equal(w.telemetry.data.timeTactical, 0);
  });

  test('time.scale multiplies the step', () => {
    const t = makeTuning(); t.set('time.scale', 2);
    const w = makeWorld({ seed: 5, tuning: t });
    w.tick(1, { forward: 0, turn: 0, fire: false });
    assert.ok(Math.abs(w.elapsed - 2) < 1e-9);
  });

  test('a headless run produces a non-degenerate session', () => {
    const t = makeTuning(); t.set('enemy.speed', 1.5);
    const w = makeWorld({ seed: 6, tuning: t });
    w.placeTower(w.dungeon.heart);
    scripted(w, 6000);
    const s = w.telemetry.summary();
    assert.ok((s['elapsed'] ?? 0) > 90, 'sim did not advance');
    assert.ok(w.telemetry.data.kills > 0, 'nothing died in 100 seconds');
  });
  ```

- [ ] **Step 2: Run, fail, implement.** `world.tick` order matters and must be fixed: `dt *= time.scale` → waves → spawn → critters → towers → tank → resolve damage → telemetry. Fixing the order makes replays reproducible; changing it later invalidates saved presets' comparability.

- [ ] **Step 3: Verify + commit (LOCAL).**
  ```bash
  npm run typecheck && npm test
  git add -A && git commit -m "core/sim: towers, tank and the World tick — replay-deterministic"
  ```

---

### Task 8: The headless harness + docs

**Files:**
- Create: `scripts/sweep.ts`, `docs/02-M0a-brain-notes.md`
- Modify: `README.md`

**Interfaces:**
- Consumes: `makeWorld`, `makeTuning`.

- [ ] **Step 1: Write `scripts/sweep.ts`** — the payoff of a pure core. Runs the sim headlessly across a lever range and prints a comparison table:
  ```ts
  // Usage: node scripts/sweep.ts enemy.speed 0.6 2.0 5
  // Steps a lever across N values, runs a fixed scripted session for each,
  // and prints the telemetry so two settings can be compared by number.
  import { makeWorld } from '../src/core/sim/world.ts';
  import { makeTuning } from '../src/core/tuning/store.ts';

  const [key, lo, hi, steps] = [process.argv[2]!, +process.argv[3]!, +process.argv[4]!, +process.argv[5]!];
  const rows: Record<string, number>[] = [];
  for (let i = 0; i < steps; i++) {
    const v = lo + (hi - lo) * (steps === 1 ? 0 : i / (steps - 1));
    const t = makeTuning(); t.set(key, v);
    const w = makeWorld({ seed: 42, tuning: t });
    w.placeTower(w.dungeon.heart);
    for (let k = 0; k < 6000; k++) {
      w.tick(1 / 60, { forward: (k % 120) < 60 ? 1 : -1, turn: Math.sin(k / 30), fire: k % 45 === 0 });
    }
    rows.push({ [key]: +v.toFixed(3), ...w.telemetry.summary() });
  }
  console.table(rows);
  ```

- [ ] **Step 2: Run a real sweep and paste the output into the notes doc.**
  ```bash
  node scripts/sweep.ts enemy.speed 0.6 2.0 5
  ```
  Expected: a five-row table where heart hits rise and kills/min or TTK shift with speed. **If the rows are identical, a lever is being captured instead of read live — that is a bug, not a tuning result.**

- [ ] **Step 3: Write `docs/02-M0a-brain-notes.md`** recording: the fixed tick order and why it's load-bearing; which named RNG streams exist; the sweep output from Step 2; and anything the port surfaced that the vision doc got wrong.

- [ ] **Step 4: Update `README.md`** with what TTD is (the §0 three-layer identity), the `core/` purity rule, and how to run `dev` / `test` / `typecheck` / `sweep`.

- [ ] **Step 5: Commit (LOCAL).**
  ```bash
  git add -A && git commit -m "core: headless sweep harness + M0a notes"
  ```

---

## Final acceptance checklist

- [ ] `npm run typecheck` and `npm test` both green; `architecture.test.ts` still passing (core imports no three.js, no `Math.random`, no DOM, no wall-clock).
- [ ] Sphere pipeline ported with invariants: all-quad, on-sphere, symmetric adjacency, deterministic, relax improves squareness.
- [ ] Dungeon ported: open subgraph connected, heart reachable from every open cell, deterministic.
- [ ] Cell index resolves every centre to its own cell.
- [ ] Tuning store: clamps, throws on unknown keys, round-trips presets, resets by group.
- [ ] Telemetry: exact counters, macro/tactical split, mode switches, idle-under-threat, `playerKillShare`.
- [ ] Critters: envelope bounded by amplitude, re-targets on cadence, reactions expire, never enter walls, reach the heart.
- [ ] Waves: drip spreads spawns, jitter keeps order, overlap 0 waits and 1 doesn't, exact spawn counts.
- [ ] World: **replay determinism test green** — same seed + preset + input ⇒ identical telemetry.
- [ ] God mode prevents death while counting hits.
- [ ] `node scripts/sweep.ts enemy.speed 0.6 2.0 5` produces rows that visibly differ.
