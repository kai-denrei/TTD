# M0b — Part 2 · First Light through Input (Tasks 4–8)

> Continues `2026-08-26-m0b-rig-visible.md`. Read that file's **Global Constraints** first — they apply to every task here.

---

### Task 4: First light — a bloomed sphere on localhost

**Goal of this task:** `npm run dev` shows the actual generated board, lit and bloomed. Nothing moves yet. This lands early on purpose: every later task is judged against something visible rather than against a promise.

**Files:**
- Create: `src/render/board.ts`
- Create: `src/render/postfx.ts`
- Create: `src/render/scene.ts`
- Rewrite: `src/main.ts`
- Modify: `src/style.css`

**Interfaces:**
- Consumes: `SphereMesh` from `core/sphere/grid.ts`, `Dungeon`/`BLOCKED`/`PATH`/`ROOM` from `core/sphere/dungeon.ts`, `makeRenderTarget`/`readRenderState` from `./bindings.ts` (Task 3).
- Produces:
  ```ts
  // board.ts
  export function makeBoard(mesh: SphereMesh, dungeon: Dungeon): THREE.Group;
  export function cellFromFaceIndex(faceIndex: number): number;
  // postfx.ts
  export type PostFx = {
    composer: EffectComposer;
    setSize(w: number, h: number): void;
    applyBloom(b: { strength: number; radius: number; threshold: number }): void;
    render(): void;
  };
  export function makePostFx(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera): PostFx;
  // scene.ts
  export type Stage = {
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    postfx: PostFx;
    resize(): void;
  };
  export function makeStage(canvas: HTMLCanvasElement): Stage;
  ```

**Background the implementer needs:**

- `SphereMesh` is `{ verts: Vec3[]; quads: number[][]; centers: Vec3[]; normals: Vec3[]; adj: number[][] }`. `quads[i]` holds vertex indices for cell `i`; **cell index === quad index**, which is the identity the whole game runs on (`dungeon.tags[cell]`, `mesh.centers[cell]`, `world.placeTower(cell)`).
- `Dungeon` is `{ tags: CellTag[]; heart: number; spawn: number; distToHeart: number[] }` with `BLOCKED = 0`, `PATH = 1`, `ROOM = 2`.
- Vertices are **shared between adjacent quads**, so per-vertex colouring would bleed one cell's tag into its neighbour. Build the geometry **non-indexed**, duplicating vertices per face, so each triangle carries its own flat colour. At ~2,700 quads that is ~16,200 vertices — trivial.
- Fan-triangulate generically (`v0,v1,v2`, `v0,v2,v3`, …) rather than assuming quads are always 4-sided; the mesh pipeline merges cells and a stray 5-gon must not throw.
- Record a `faceIndex → cell` lookup while building. Three's raycaster reports `intersection.faceIndex`; Task 8 turns that into a cell for tower placement. Building it here, where the triangles are emitted, is the only place the mapping is known for free.
- **Vision §4:** post-processing is foundational, not polish. The PoC deferred bloom and vision §2 blames that deferral for a large part of why HokorobiTawaa feels better. It goes in now, at first light.
- three 0.170 postprocessing imports: `three/examples/jsm/postprocessing/EffectComposer.js`, `.../RenderPass.js`, `.../UnrealBloomPass.js`.

- [ ] **Step 1: Write `src/render/board.ts`**

```ts
// board.ts — the sphere board: one non-indexed mesh plus an edge overlay.
//
// NON-INDEXED ON PURPOSE. Vertices are shared between adjacent quads, so a
// per-vertex colour bleeds one cell's dungeon tag into its neighbours and the
// board turns to mush. Duplicating vertices per face gives every cell a flat,
// exact colour. ~2,700 quads -> ~16,200 verts, which is nothing.
//
// THE EDGE OVERLAY IS NOT DECORATION. Tower placement is per-cell, so a player
// who cannot see where one cell ends cannot aim. Edges are deduplicated by
// sorted vertex-index key so shared borders are drawn once.

import * as THREE from 'three';
import type { SphereMesh } from '../core/sphere/grid.ts';
import type { Dungeon } from '../core/sphere/dungeon.ts';
import { BLOCKED, PATH } from '../core/sphere/dungeon.ts';

const COLOR_BLOCKED = new THREE.Color(0x141b2c);
const COLOR_PATH = new THREE.Color(0x2b4a7a);
const COLOR_ROOM = new THREE.Color(0x3f6ea8);
const COLOR_EDGE = new THREE.Color(0x0a0f1a);

/** faceIndex -> cell index, filled while triangles are emitted. Task 8's
 *  raycast placement resolves a hit face to the cell it belongs to. */
let faceToCell: Int32Array = new Int32Array(0);

export function cellFromFaceIndex(faceIndex: number): number {
  return faceToCell[faceIndex] ?? -1;
}

export function makeBoard(mesh: SphereMesh, dungeon: Dungeon): THREE.Group {
  const positions: number[] = [];
  const colors: number[] = [];
  const faces: number[] = [];

  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined || quad.length < 3) continue;

    const tag = dungeon.tags[cell];
    const c = tag === BLOCKED ? COLOR_BLOCKED : tag === PATH ? COLOR_PATH : COLOR_ROOM;

    // Fan-triangulate: generic over polygon size, because the mesh pipeline
    // merges cells and a stray 5-gon must not throw.
    for (let i = 1; i + 1 < quad.length; i++) {
      const tri = [quad[0]!, quad[i]!, quad[i + 1]!];
      for (const vi of tri) {
        const v = mesh.verts[vi];
        if (v === undefined) continue;
        positions.push(v[0], v[1], v[2]);
        colors.push(c.r, c.g, c.b);
      }
      faces.push(cell);
    }
  }

  faceToCell = Int32Array.from(faces);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
  );

  const group = new THREE.Group();
  group.name = 'board';
  group.add(surface);
  group.add(makeEdges(mesh));
  return group;
}

function makeEdges(mesh: SphereMesh): THREE.LineSegments {
  const seen = new Set<number>();
  const pts: number[] = [];
  for (const quad of mesh.quads) {
    if (quad === undefined) continue;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % quad.length]!;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const va = mesh.verts[a];
      const vb = mesh.verts[b];
      if (va === undefined || vb === undefined) continue;
      pts.push(va[0], va[1], va[2], vb[0], vb[1], vb[2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLOR_EDGE }));
}
```

- [ ] **Step 2: Write `src/render/postfx.ts`**

```ts
// postfx.ts — EffectComposer + UnrealBloom.
//
// Vision §4: post-processing is foundational, not polish. The PoC's decision
// log deferred the "6-module EffectComposer cost until a look earns it", and
// vision §2 blames that deferral for a large part of why HokorobiTawaa feels
// better than the PoC did. It goes in at first light, not at the end.
//
// applyBloom() takes the plain-data shape RenderTarget.bloom produces, so the
// tuning path stays testable in Node (see render/bindings.ts) and this file
// stays the only place that knows what an UnrealBloomPass is.

import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';

export type PostFx = {
  composer: EffectComposer;
  setSize(w: number, h: number): void;
  applyBloom(b: { strength: number; radius: number; threshold: number }): void;
  render(): void;
};

export function makePostFx(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
  const bloom = new UnrealBloomPass(size, 0.8, 0.4, 0.5);
  composer.addPass(bloom);

  return {
    composer,
    setSize(w, h) {
      composer.setSize(w, h);
      bloom.setSize(w, h);
    },
    applyBloom(b) {
      bloom.strength = b.strength;
      bloom.radius = b.radius;
      bloom.threshold = b.threshold;
    },
    render() {
      composer.render();
    },
  };
}
```

- [ ] **Step 3: Write `src/render/scene.ts`**

```ts
// scene.ts — renderer, scene, camera and the post chain, assembled once.
//
// Owns nothing about the game. It is handed a canvas and gives back a Stage
// the shell drives. Keeping this separate from shell.ts means the render
// plumbing can be re-read in one screen.

import * as THREE from 'three';
import { makePostFx } from './postfx.ts';
import type { PostFx } from './postfx.ts';

export type Stage = {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  postfx: PostFx;
  resize(): void;
};

export function makeStage(canvas: HTMLCanvasElement): Stage {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  // Cap DPR at 2: a 3x phone screen triples the bloom chain's fill cost for
  // no visible gain on a dot-cloud look.
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070c);

  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.01, 100);
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);

  const postfx = makePostFx(renderer, scene, camera);

  function resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    postfx.setSize(w, h);
  }

  window.addEventListener('resize', resize);
  return { renderer, scene, camera, postfx, resize };
}
```

- [ ] **Step 4: Rewrite `src/main.ts` to boot first light**

```ts
// main.ts — the shell entry point.
//
// Architectural invariant: src/core/ never imports three.js. The brain is
// tested headless; this file and everything under render/ is the thin layer
// that draws it. That separation is the structural fix for the PoC's
// 3,870-line tab where sim and render were fused.

import { makeWorld } from './core/sim/world.ts';
import { makeTuning } from './core/tuning/store.ts';
import { makeStage } from './render/scene.ts';
import { makeBoard } from './render/board.ts';
import { makeRenderTarget, readRenderState } from './render/bindings.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas missing');

const tuning = makeTuning();
const world = makeWorld({ seed: 7, tuning });

const stage = makeStage(canvas);
stage.scene.add(makeBoard(world.mesh, world.dungeon));

const renderTarget = makeRenderTarget();

function frame(): void {
  // LIVENESS: read every render lever through tuning.get() on every frame.
  // Hoisting this out of the loop is the exact bug the rig exists to prevent.
  readRenderState(tuning, renderTarget);
  stage.postfx.applyBloom(renderTarget.bloom);
  stage.postfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 5: Make the canvas fill the viewport**

Append to `src/style.css`:

```css
html, body, #app { height: 100%; margin: 0; background: #05070c; overflow: hidden; }
#scene { display: block; width: 100%; height: 100%; touch-action: none; }
.boot { display: none; }
```

`touch-action: none` is required — without it the browser claims drag and pinch for scroll/zoom and Task 8's touch controls never receive events.

- [ ] **Step 6: Typecheck, then look at it**

Run: `npm run typecheck`
Expected: silent, exit 0.

Run: `npm run dev`
Open the printed localhost URL.
Expected: a dark page with a blue-grey faceted sphere, cell edges visible, a soft bloom glow on the brighter room cells. Console clean.

If the sphere is black, bloom threshold (0.5 default) is above every surface colour — confirm by temporarily setting `bloom.threshold` to 0 in the schema default, then set it back.

- [ ] **Step 7: Commit**

```bash
./scripts/bust.sh --quiet
git add src/render/ src/main.ts src/style.css index.html
git commit -F - <<'EOF'
feat(render): first light — the board on screen with bloom

Lands early on purpose: every later M0b task is now judged against something
visible rather than against a promise.

The board geometry is non-indexed. Vertices are shared between adjacent
quads, so a per-vertex colour bleeds one cell's dungeon tag into its
neighbours; duplicating verts per face gives each cell a flat exact colour
at ~16k verts, which costs nothing. Fan-triangulation is generic over
polygon size rather than assuming 4 sides — the mesh pipeline merges cells
and a stray 5-gon must not throw.

The edge overlay is not decoration: tower placement is per-cell, so a player
who cannot see cell boundaries cannot aim. faceIndex -> cell is recorded
while triangles are emitted, which is the only place that mapping is free;
raycast placement consumes it later.

Bloom goes in now rather than at the end. Vision §4 calls post-processing
foundational and §2 blames the PoC's deferral of it for much of why
HokorobiTawaa feels better. Render levers are read through tuning.get()
inside the frame — never hoisted.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 5: `app/loop.ts` — fixed timestep and the terminal condition

**Files:**
- Create: `src/app/loop.ts`
- Test: `src/app/loop.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks (deliberately decoupled from `World` — see below).
- Produces:
  ```ts
  export type Stepper = { step(dt: number): void; done(): boolean };
  export type Loop = {
    advance(frameSeconds: number): number;  // returns steps actually run
    readonly stepped: number;
    readonly halted: boolean;
  };
  export const FIXED_DT: number;      // 1 / 60
  export const MAX_STEPS_PER_FRAME: number;  // 5
  export function makeLoop(target: Stepper, fixedDt?: number, maxSteps?: number): Loop;
  ```

**Background the implementer needs:**

Determinism is a stated pillar (vision §5.6) and replay-determinism is the keystone test (spec §8). Feeding `requestAnimationFrame`'s variable `dt` straight into `world.tick` would break it: two runs of the same seed and inputs would diverge purely from frame-timing noise. So the loop accumulates real elapsed time and spends it in **fixed 1/60 steps**.

The accumulator is clamped to **5 steps per frame**. A backgrounded tab returns with seconds of accumulated time; without a clamp the loop tries to run hundreds of steps in one frame, which takes longer than a frame, which accumulates more time — the spiral of death. Clamping drops simulated time instead, which is the right trade for a tuning rig.

**Terminal condition.** M0a brain-notes finding #5: a sim with no terminal condition accumulates telemetry past death, so a long run averages a real game with a post-mortem. `Stepper.done()` lets the loop halt. `runner.ts` (Task 2) enforces the same rule headlessly; this is the live-play half.

`Loop` takes a `Stepper` interface rather than a `World` so it is testable in Node with a counting stub — no mesh generation, no three.js.

- [ ] **Step 1: Write the failing test**

Create `src/app/loop.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLoop, FIXED_DT, MAX_STEPS_PER_FRAME } from './loop.ts';

function counter(doneAfter = Infinity) {
  const state = { steps: 0, dts: [] as number[] };
  return {
    state,
    stepper: {
      step(dt: number) { state.steps++; state.dts.push(dt); },
      done() { return state.steps >= doneAfter; },
    },
  };
}

describe('fixed-timestep loop', () => {
  test('every step receives exactly FIXED_DT regardless of frame time', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    loop.advance(0.0163);
    loop.advance(0.0211);
    loop.advance(0.0092);
    for (const dt of c.state.dts) assert.equal(dt, FIXED_DT);
  });

  test('accumulates leftover time across frames instead of dropping it', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    // Three frames of 10ms = 30ms = 1.8 steps worth; expect 1 step, remainder kept
    loop.advance(0.01);
    loop.advance(0.01);
    assert.equal(c.state.steps, 1, 'two 10ms frames should yield exactly one 16.67ms step');
    loop.advance(0.01);
    assert.equal(c.state.steps, 1, 'third 10ms frame: 30ms - 16.67ms + 10ms = 23.3ms -> one more step');
  });

  test('one second of frames yields ~60 steps', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    assert.ok(Math.abs(c.state.steps - 60) <= 1, `expected ~60 steps, got ${c.state.steps}`);
  });

  test('clamps a long stall to MAX_STEPS_PER_FRAME — no spiral of death', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    loop.advance(10); // a backgrounded tab returning after 10 seconds
    assert.equal(c.state.steps, MAX_STEPS_PER_FRAME);
    // dropped time must NOT be carried over, or the next frame stalls too
    loop.advance(1 / 60);
    assert.equal(c.state.steps, MAX_STEPS_PER_FRAME + 1);
  });

  test('halts permanently once done() reports true', () => {
    const c = counter(3);
    const loop = makeLoop(c.stepper);
    loop.advance(1);          // would run 5, but done() trips at 3
    assert.equal(c.state.steps, 3);
    assert.equal(loop.halted, true);
    loop.advance(1);
    assert.equal(c.state.steps, 3, 'stepped after halt — the terminal condition leaked');
  });

  test('reports how many steps a frame actually ran', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    assert.equal(loop.advance(0.001), 0);
    assert.equal(loop.advance(0.05), 3);
    assert.equal(loop.stepped, 3);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/app/loop.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './loop.ts'`.

- [ ] **Step 3: Implement `loop.ts`**

```ts
// loop.ts — fixed-timestep accumulator.
//
// WHY NOT rAF's dt. Determinism is a pillar (vision §5.6) and replay
// determinism is the keystone test: same seed + same preset + same inputs must
// produce byte-identical telemetry. Feeding variable frame time into
// world.tick would make two identical runs diverge from frame-timing noise
// alone, and every tuning comparison would be measuring the scheduler.
//
// WHY THE CLAMP. A backgrounded tab returns with seconds of accumulated time.
// Unclamped, the loop tries to run hundreds of steps in one frame, which takes
// longer than a frame, which accumulates more time — the spiral of death. We
// drop simulated time instead. For a tuning rig that is plainly the right
// trade: a stalled tab is not a run worth preserving.
//
// WHY Stepper, NOT World. Taking a two-method interface keeps this module
// Node-testable with a counting stub — no mesh generation, no three.js.

export const FIXED_DT = 1 / 60;
export const MAX_STEPS_PER_FRAME = 5;

export type Stepper = {
  step(dt: number): void;
  /** Terminal condition. M0a finding #5: a sim with no end accumulates
   *  telemetry past death, so a long run averages a real game with a
   *  post-mortem. Once true, the loop never steps again. */
  done(): boolean;
};

export type Loop = {
  advance(frameSeconds: number): number;
  readonly stepped: number;
  readonly halted: boolean;
};

export function makeLoop(
  target: Stepper,
  fixedDt: number = FIXED_DT,
  maxSteps: number = MAX_STEPS_PER_FRAME,
): Loop {
  let acc = 0;
  let stepped = 0;
  let halted = false;

  function advance(frameSeconds: number): number {
    if (halted) return 0;
    acc += frameSeconds;

    let ran = 0;
    while (acc >= fixedDt && ran < maxSteps) {
      target.step(fixedDt);
      acc -= fixedDt;
      ran++;
      stepped++;
      if (target.done()) {
        halted = true;
        acc = 0;
        return ran;
      }
    }

    // Clamped: discard the backlog rather than carrying it into the next
    // frame, which would stall every subsequent frame too.
    if (ran >= maxSteps) acc = 0;
    return ran;
  }

  return {
    advance,
    get stepped() { return stepped; },
    get halted() { return halted; },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/app/loop.test.ts 2>&1 | tail -20`
Expected: PASS, 6 tests.

- [ ] **Step 5: Sabotage the clamp**

Change `if (ran >= maxSteps) acc = 0;` to `if (ran >= maxSteps) { /* keep acc */ }` and re-run.
Expected: FAIL on `clamps a long stall` — the follow-up `advance(1/60)` runs 5 more steps from the retained backlog instead of 1. Restore the line and confirm PASS.

- [ ] **Step 6: Full suite, typecheck, commit**

```bash
npm test 2>&1 | tail -5 && npm run typecheck
git add src/app/loop.ts src/app/loop.test.ts
git commit -F - <<'EOF'
feat(app): fixed-timestep loop with a terminal condition

Feeding rAF's variable dt into world.tick would break replay determinism —
two identical runs would diverge from frame-timing noise, and every tuning
comparison would partly be measuring the scheduler. The loop accumulates
real time and spends it in fixed 1/60 steps.

The 5-step-per-frame clamp exists because a backgrounded tab returns with
seconds of backlog: unclamped, one frame runs hundreds of steps, takes
longer than a frame, and accumulates more — the spiral of death. Dropped
time is discarded rather than carried, since carrying it stalls every
following frame too. For a tuning rig, a stalled tab is not a run worth
preserving.

done() is the live-play half of M0a finding #5 (a sim with no terminal
condition accumulates telemetry past death); runner.ts enforces the same
rule headlessly.

Takes a two-method Stepper rather than a World so it tests against a
counting stub — no mesh generation, no three.js. Clamp verified by
sabotage.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 6: `render/points.ts` + `render/units.ts` — the dot-clouds

**Files:**
- Create: `src/render/points.ts`
- Create: `src/render/units.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `ModelPoint` + `turretPts` + `minePts` (Task 1); `World` from `core/sim/world.ts`.
- Produces:
  ```ts
  // points.ts
  export type Basis = { fwd: Vec3; up: Vec3; side: Vec3 };
  export type PointCloud = {
    object: THREE.Points;
    begin(): void;
    add(pos: Vec3, scale: number, basis: Basis, tint: number): void;
    end(): void;
  };
  export function makePointCloud(model: readonly ModelPoint[], capacity: number, opts: { size: number; color: number; highlight: number }): PointCloud;
  export function basisAt(normal: Vec3, heading: Vec3): Basis;
  // units.ts
  export type Units = { group: THREE.Group; sync(world: World): void };
  export function makeUnits(): Units;
  ```

**Background the implementer needs:**

- Models are **unit radius, +Y up**, with `+X` as the aim direction (the turret's barrel). `basisAt` maps model space onto the sphere: model `+Y` → surface normal, model `+X` → heading tangent, model `+Z` → their cross.
- **Why pooled buffers, not instancing.** Peak load is ~16 concurrent critters × 490 pts + ~10 towers × 590 pts ≈ 13,700 points. At that scale, writing positions into a pre-allocated `Float32Array` each frame and setting `drawRange` is far simpler than an `InstancedBufferGeometry` with a custom shader, and costs nothing measurable. Allocate once at construction; never allocate per frame.
- **Highlights via colour, not size.** `PointsMaterial` has no per-vertex size attribute, and adding a custom shader for it is not worth it in M0b. `p[3] === 1` points get a brighter colour, which pushes them over the bloom threshold and makes them glow. Per-point *size* is noted as a later refinement, not done here.
- `capacity` is a hard ceiling. If more units exist than capacity, extras are skipped rather than growing the buffer mid-frame — a reallocation stall during a wave is worse than a missing dot. Log once when it happens.

- [ ] **Step 1: Write `src/render/points.ts`**

```ts
// points.ts — pooled dot-cloud renderer.
//
// WHY POOLED BUFFERS, NOT INSTANCING. Peak M0 load is ~16 critters x 490 pts
// plus ~10 towers x 590 pts, about 13.7k points. At that scale, writing into a
// pre-allocated Float32Array and setting drawRange is far simpler than an
// InstancedBufferGeometry with a custom shader, and the cost is unmeasurable.
// Allocate once at construction; never allocate in a frame.
//
// HIGHLIGHTS ARE COLOUR, NOT SIZE. PointsMaterial has no per-vertex size
// attribute. p[3] === 1 points get a brighter colour, which pushes them past
// the bloom threshold and makes them glow — the library's "look here" channel
// survives. Per-point size would need a custom shader; that is a later
// refinement, deliberately not done here.

import * as THREE from 'three';
import type { ModelPoint } from '../core/models/helpers.ts';
import type { Vec3 } from '../core/sphere/vec3.ts';

export type Basis = { fwd: Vec3; up: Vec3; side: Vec3 };

/** Orthonormal basis on the sphere surface: model +Y -> normal (up),
 *  model +X -> heading (fwd), model +Z -> side. `heading` need not be exactly
 *  tangent; it is projected onto the tangent plane and renormalised. */
export function basisAt(normal: Vec3, heading: Vec3): Basis {
  const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const up: Vec3 = [normal[0] / nl, normal[1] / nl, normal[2] / nl];

  const d = heading[0] * up[0] + heading[1] * up[1] + heading[2] * up[2];
  let fx = heading[0] - up[0] * d;
  let fy = heading[1] - up[1] * d;
  let fz = heading[2] - up[2] * d;
  let fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-6) {
    // heading was parallel to the normal — pick any stable tangent so the
    // model does not collapse or spin. This is the pole-degeneracy case.
    const ref: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    fx = ref[1] * up[2] - ref[2] * up[1];
    fy = ref[2] * up[0] - ref[0] * up[2];
    fz = ref[0] * up[1] - ref[1] * up[0];
    fl = Math.hypot(fx, fy, fz) || 1;
  }
  const fwd: Vec3 = [fx / fl, fy / fl, fz / fl];
  const side: Vec3 = [
    up[1] * fwd[2] - up[2] * fwd[1],
    up[2] * fwd[0] - up[0] * fwd[2],
    up[0] * fwd[1] - up[1] * fwd[0],
  ];
  return { fwd, up, side };
}

export type PointCloud = {
  object: THREE.Points;
  begin(): void;
  add(pos: Vec3, scale: number, basis: Basis, tint: number): void;
  end(): void;
};

export function makePointCloud(
  model: readonly ModelPoint[],
  capacity: number,
  opts: { size: number; color: number; highlight: number },
): PointCloud {
  const per = model.length;
  const total = per * capacity;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);

  const object = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: opts.size,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  object.frustumCulled = false;

  const base = new THREE.Color(opts.color);
  const hi = new THREE.Color(opts.highlight);
  let cursor = 0;
  let warned = false;

  function begin(): void {
    cursor = 0;
  }

  function add(pos: Vec3, scale: number, basis: Basis, tint: number): void {
    if (cursor >= capacity) {
      if (!warned) {
        console.warn(`[points] capacity ${capacity} exceeded; extra units not drawn`);
        warned = true;
      }
      return;
    }
    const { fwd, up, side } = basis;
    let o = cursor * per * 3;
    for (let i = 0; i < per; i++) {
      const p = model[i]!;
      const px = p[0] * scale;
      const py = p[1] * scale;
      const pz = p[2] * scale;
      positions[o] = pos[0] + px * fwd[0] + py * up[0] + pz * side[0];
      positions[o + 1] = pos[1] + px * fwd[1] + py * up[1] + pz * side[1];
      positions[o + 2] = pos[2] + px * fwd[2] + py * up[2] + pz * side[2];
      const c = p[3] === 1 ? hi : base;
      colors[o] = c.r * tint;
      colors[o + 1] = c.g * tint;
      colors[o + 2] = c.b * tint;
      o += 3;
    }
    cursor++;
  }

  function end(): void {
    geo.setDrawRange(0, cursor * per);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  return { object, begin, add, end };
}
```

- [ ] **Step 2: Write `src/render/units.ts`**

```ts
// units.ts — everything that moves, drawn from world state each frame.
//
// The renderer READS the world and never writes to it. Nothing here calls a
// world method; sync() is a pure projection of state onto buffers. That is the
// seam that keeps core/ headless and testable.
//
// The tank re-uses the turret silhouette, re-tinted. A dedicated tank model is
// M1 work; M0b does not need a third port to answer a tuning question.

import * as THREE from 'three';
import { turretPts } from '../core/models/turret.ts';
import { minePts } from '../core/models/mine.ts';
import { makePointCloud, basisAt } from './points.ts';
import type { World } from '../core/sim/world.ts';
import type { Vec3 } from '../core/sphere/vec3.ts';

const CRITTER_CAP = 200;
const TOWER_CAP = 64;
const CRITTER_SCALE = 0.022;
const TOWER_SCALE = 0.03;
const TANK_SCALE = 0.028;
const HEART_SCALE = 0.06;

export type Units = { group: THREE.Group; sync(world: World): void };

export function makeUnits(): Units {
  const mine = minePts();
  const turret = turretPts();

  const critters = makePointCloud(mine, CRITTER_CAP, { size: 0.006, color: 0xff5a3c, highlight: 0xffd08a });
  const towers = makePointCloud(turret, TOWER_CAP, { size: 0.006, color: 0x64b5ff, highlight: 0xd8f0ff });
  const tank = makePointCloud(turret, 1, { size: 0.007, color: 0x7ee0a8, highlight: 0xe8fff2 });
  const heart = makePointCloud(mine, 1, { size: 0.012, color: 0xff3060, highlight: 0xffc0d0 });

  const group = new THREE.Group();
  group.name = 'units';
  for (const c of [critters, towers, tank, heart]) group.add(c.object);

  function sync(world: World): void {
    const { mesh } = world;

    critters.begin();
    for (const c of world.critters) {
      if (!c.alive) continue;
      const n = normalOf(c.pos);
      // Heading: toward the cell it is walking to, so critters face their path.
      const target = mesh.centers[c.next] ?? c.pos;
      const heading: Vec3 = [target[0] - c.pos[0], target[1] - c.pos[1], target[2] - c.pos[2]];
      critters.add(lift(c.pos, CRITTER_SCALE), CRITTER_SCALE, basisAt(n, heading), 1);
    }
    critters.end();

    towers.begin();
    for (const t of world.towers) {
      const n = normalOf(t.pos);
      towers.add(lift(t.pos, TOWER_SCALE), TOWER_SCALE, basisAt(n, [0, 1, 0]), 1);
    }
    towers.end();

    tank.begin();
    tank.add(lift(world.tank.pos, TANK_SCALE), TANK_SCALE, basisAt(normalOf(world.tank.pos), world.tank.heading), 1);
    tank.end();

    // The heart dims as it takes damage — HK's "you see yourself dying",
    // and we already have the dot renderer that makes it free.
    const hp = Math.max(0, world.heartHp) / 20;
    const heartPos = mesh.centers[world.dungeon.heart] ?? [0, 1, 0];
    heart.begin();
    heart.add(lift(heartPos, HEART_SCALE), HEART_SCALE, basisAt(normalOf(heartPos), [0, 1, 0]), 0.25 + 0.75 * hp);
    heart.end();
  }

  return { group, sync };
}

/** Unit sphere, so a surface position IS its own normal. */
function normalOf(p: Vec3): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  return [p[0] / l, p[1] / l, p[2] / l];
}

/** Push a model off the surface by roughly its own radius so it sits ON the
 *  board rather than half-buried in it. */
function lift(p: Vec3, scale: number): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  const k = (l + scale * 0.9) / l;
  return [p[0] * k, p[1] * k, p[2] * k];
}
```

- [ ] **Step 3: Wire units + the loop into `main.ts`**

Replace `src/main.ts` in full:

```ts
// main.ts — the shell entry point.
//
// Architectural invariant: src/core/ never imports three.js. The brain is
// tested headless; this file and everything under render/ is the thin layer
// that draws it.

import { makeWorld } from './core/sim/world.ts';
import { makeTuning } from './core/tuning/store.ts';
import { makeStage } from './render/scene.ts';
import { makeBoard } from './render/board.ts';
import { makeUnits } from './render/units.ts';
import { makeRenderTarget, readRenderState } from './render/bindings.ts';
import { makeLoop } from './app/loop.ts';

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('#scene canvas missing');

const tuning = makeTuning();
const world = makeWorld({ seed: 7, tuning });
world.placeTower(world.dungeon.heart);

const stage = makeStage(canvas);
stage.scene.add(makeBoard(world.mesh, world.dungeon));

const units = makeUnits();
stage.scene.add(units.group);

const loop = makeLoop({
  step: (dt) => world.tick(dt, { forward: 0, turn: 0, fire: false }),
  done: () => world.heartDied,
});

const renderTarget = makeRenderTarget();
let last = performance.now();

function frame(now: number): void {
  loop.advance(Math.min((now - last) / 1000, 1));
  last = now;

  units.sync(world);

  // LIVENESS: read every render lever through tuning.get() on every frame.
  readRenderState(tuning, renderTarget);
  stage.postfx.applyBloom(renderTarget.bloom);
  stage.postfx.render();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
```

- [ ] **Step 4: Typecheck and look at it**

Run: `npm run typecheck && npm run dev`
Expected: red spiked critters spawn at a gate and crawl toward a glowing red heart; a blue turret sits at the heart and kills some; the heart visibly dims as it takes hits; everything stops when the heart dies.

- [ ] **Step 5: Commit**

```bash
./scripts/bust.sh --quiet
git add src/render/points.ts src/render/units.ts src/main.ts index.html
git commit -F - <<'EOF'
feat(render): dot-cloud units — critters, towers, tank, heart

Pooled Float32Array + drawRange rather than instancing: peak M0 load is
~13.7k points, where writing into a pre-allocated buffer each frame is far
simpler than an InstancedBufferGeometry with a custom shader and costs
nothing measurable. Allocated once; nothing allocates in a frame. Capacity
is a hard ceiling — a reallocation stall mid-wave is worse than a missing
dot.

Highlights are rendered as brighter colour rather than larger points:
PointsMaterial has no per-vertex size attribute, and brightness pushes them
past the bloom threshold so the library's "look here" channel survives
without a custom shader.

basisAt handles the pole degeneracy explicitly — when heading is parallel
to the surface normal the tangent is undefined, and picking a stable
reference vector is the difference between a model that sits still and one
that spins.

The heart dims with its HP: HokorobiTawaa renders remaining life as dot
density so you watch yourself dying, and we already own the dot renderer.

The renderer reads world state and never writes it — sync() is a pure
projection onto buffers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 7: `app/cameras/` — the mode registry

**Files:**
- Create: `src/app/cameras/modes.ts`
- Create: `src/app/cameras/registry.ts`
- Test: `src/app/cameras/cameras.test.ts`
- Modify: `src/main.ts`

**Interfaces:**
- Consumes: `Vec3` from `core/sphere/vec3.ts`. **Imports nothing from three** — that is what makes it testable.
- Produces:
  ```ts
  // modes.ts
  export type CamFamily = 'build' | 'tank';
  export type CamContext = { anchor: Vec3; normal: Vec3; heading: Vec3; t: number; zoom: number; orbitYaw: number; orbitPitch: number };
  export type CamFrame = { pos: Vec3; look: Vec3; up: Vec3 };
  export type CameraMode = { id: string; family: CamFamily; label: string; frame(ctx: CamContext): CamFrame };
  export const CAMERA_MODES: readonly CameraMode[];
  // registry.ts
  export type CameraRig = {
    update(dt: number, ctx: CamContext, shakeGain: number): CamFrame;
    setFamily(f: CamFamily): boolean;   // true if it actually changed
    toggleFamily(): CamFamily;
    cycle(): CameraMode;
    addTrauma(amount: number): void;
    readonly family: CamFamily;
    readonly mode: CameraMode;
  };
  export function makeCameraRig(transitionSeconds?: number): CameraRig;
  ```

**Background the implementer needs:**

The operator asked for a **camera system**, not two viewpoints: bird's-eye and cinematic angles for BUILD, third-person plus POV for TANK. Declaring modes the way `LEVERS` declares levers means adding `tanktopdown` or a beat camera later is **one entry**, not a refactor. Vision §6.6 already lists `beatCameras`, `modeTransition` and `intensityFraming` as camera levers; this is the structure they will hang off.

**The load-bearing part:** switching family calls `world.setMacro()`. M0a's brain notes §5.2 record that `modeSwitches` and `macroShare` read **0 in every sweep** because nothing ever called `setMacro`. The layer-balance pane of the telemetry — which vision §0 calls the headline measurement the whole rig exists for — has never had data. This task is what finally gives it some.

**Pole degeneracy** is the real trap. Framing off a surface normal has a singularity where `up` aligns with the view direction, producing a camera that spins wildly. The test asserts it directly.

Shake must stay deterministic — **no `Math.random`**. Use a sine-sum over time.

- [ ] **Step 1: Write the failing test**

Create `src/app/cameras/cameras.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { CAMERA_MODES } from './modes.ts';
import type { CamContext } from './modes.ts';
import { makeCameraRig } from './registry.ts';

function ctxAt(anchor: [number, number, number], heading: [number, number, number] = [0, 1, 0]): CamContext {
  const l = Math.hypot(...anchor) || 1;
  return {
    anchor,
    normal: [anchor[0] / l, anchor[1] / l, anchor[2] / l],
    heading,
    t: 3.5,
    zoom: 1,
    orbitYaw: 0.7,
    orbitPitch: 0.3,
  };
}

// The north pole is the degenerate case: a naive [0,1,0] up-vector is parallel
// to the view direction there, and the camera spins.
const PLACES: Array<[number, number, number]> = [
  [0, 1, 0], [0, -1, 0], [1, 0, 0], [0, 0, 1], [0.577, 0.577, 0.577],
];

describe('camera modes', () => {
  test('there are five modes across two families', () => {
    assert.equal(CAMERA_MODES.length, 5);
    assert.equal(CAMERA_MODES.filter((m) => m.family === 'build').length, 3);
    assert.equal(CAMERA_MODES.filter((m) => m.family === 'tank').length, 2);
  });

  test('mode ids are unique', () => {
    const ids = CAMERA_MODES.map((m) => m.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  for (const mode of CAMERA_MODES) {
    test(`${mode.id} produces finite vectors everywhere, including the poles`, () => {
      for (const place of PLACES) {
        const f = mode.frame(ctxAt(place));
        for (const v of [f.pos, f.look, f.up]) {
          for (const c of v) assert.ok(Number.isFinite(c), `${mode.id} at ${place}: non-finite component`);
        }
      }
    });

    test(`${mode.id} never returns an up-vector parallel to the view direction`, () => {
      for (const place of PLACES) {
        const f = mode.frame(ctxAt(place));
        const dir = [f.look[0] - f.pos[0], f.look[1] - f.pos[1], f.look[2] - f.pos[2]];
        const dl = Math.hypot(...dir) || 1;
        const ul = Math.hypot(...f.up) || 1;
        const cos = Math.abs((dir[0] * f.up[0] + dir[1] * f.up[1] + dir[2] * f.up[2]) / (dl * ul));
        assert.ok(cos < 0.999, `${mode.id} at ${place}: up is parallel to view (cos=${cos}) — camera will spin`);
      }
    });

    test(`${mode.id} places the camera off the anchor`, () => {
      const f = mode.frame(ctxAt([0, 1, 0]));
      const d = Math.hypot(f.pos[0] - 0, f.pos[1] - 1, f.pos[2] - 0);
      assert.ok(d > 0.01, `${mode.id}: camera sits on top of its subject`);
    });
  }
});

describe('camera rig', () => {
  test('starts in the build family', () => {
    assert.equal(makeCameraRig().family, 'build');
  });

  test('toggleFamily alternates and reports the new family', () => {
    const rig = makeCameraRig();
    assert.equal(rig.toggleFamily(), 'tank');
    assert.equal(rig.family, 'tank');
    assert.equal(rig.toggleFamily(), 'build');
  });

  test('setFamily reports whether it actually changed', () => {
    const rig = makeCameraRig();
    assert.equal(rig.setFamily('build'), false, 'no-op switch must report false');
    assert.equal(rig.setFamily('tank'), true);
    assert.equal(rig.setFamily('tank'), false);
  });

  test('cycle stays inside the current family and wraps', () => {
    const rig = makeCameraRig();
    const seen = new Set<string>();
    for (let i = 0; i < 3; i++) seen.add(rig.cycle().id);
    for (const id of seen) {
      assert.equal(CAMERA_MODES.find((m) => m.id === id)!.family, 'build');
    }
    assert.equal(seen.size, 3, 'cycling 3 times in a 3-mode family should visit all 3');
  });

  test('switching family switches the active mode too', () => {
    const rig = makeCameraRig();
    rig.setFamily('tank');
    assert.equal(rig.mode.family, 'tank');
  });

  test('transitions ease rather than cut', () => {
    const rig = makeCameraRig(0.5);
    const ctx = ctxAt([0, 1, 0]);
    const before = rig.update(1 / 60, ctx, 0);
    rig.setFamily('tank');
    const during = rig.update(1 / 60, ctx, 0);
    const target = rig.mode.frame(ctx);
    const dBefore = Math.hypot(during.pos[0] - before.pos[0], during.pos[1] - before.pos[1], during.pos[2] - before.pos[2]);
    const dTarget = Math.hypot(during.pos[0] - target.pos[0], during.pos[1] - target.pos[1], during.pos[2] - target.pos[2]);
    assert.ok(dBefore > 0, 'camera did not move at all');
    assert.ok(dTarget > 1e-6, 'camera cut straight to the target instead of easing');
  });

  test('shake is deterministic and scales with gain', () => {
    const a = makeCameraRig();
    const b = makeCameraRig();
    const ctx = ctxAt([0, 1, 0]);
    a.addTrauma(1);
    b.addTrauma(1);
    assert.deepEqual(a.update(1 / 60, ctx, 1), b.update(1 / 60, ctx, 1));

    const quiet = makeCameraRig();
    const loud = makeCameraRig();
    quiet.addTrauma(1);
    loud.addTrauma(1);
    const q = quiet.update(1 / 60, ctx, 0);
    const l = loud.update(1 / 60, ctx, 2);
    assert.notDeepEqual(q.pos, l.pos, 'shakeGain had no effect');
  });

  test('trauma decays to nothing', () => {
    const rig = makeCameraRig();
    const ctx = ctxAt([0, 1, 0]);
    rig.addTrauma(1);
    for (let i = 0; i < 600; i++) rig.update(1 / 60, ctx, 1);
    const settled = rig.update(1 / 60, ctx, 1);
    const clean = makeCameraRig();
    for (let i = 0; i < 600; i++) clean.update(1 / 60, ctx, 1);
    const ref = clean.update(1 / 60, ctx, 1);
    for (let i = 0; i < 3; i++) {
      assert.ok(Math.abs(settled.pos[i]! - ref.pos[i]!) < 1e-6, 'trauma never decayed');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/app/cameras/cameras.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './modes.ts'`.

- [ ] **Step 3: Implement `modes.ts`**

```ts
// modes.ts — the camera roster, declared the way LEVERS declares levers.
//
// WHY A REGISTRY. The operator asked for a camera *system*: bird's-eye and
// cinematic angles for building, third-person and POV for the tank. Declaring
// modes as data means adding a top-down-over-tank or a scripted beat camera
// later is ONE entry, not a refactor. Vision §6.6 already lists beatCameras,
// modeTransition and intensityFraming as camera levers; this is the structure
// they hang off.
//
// PURE ON PURPOSE. Nothing here imports three.js. A mode is a function from
// context to {pos, look, up}, so every mode is Node-testable — including the
// pole degeneracy that would otherwise only show up as a camera spinning on
// screen at 3am.
//
// MODEL CONVENTION. The board is a unit sphere, so a surface point is its own
// normal. Distances below are in sphere radii.

import type { Vec3 } from '../../core/sphere/vec3.ts';

export type CamFamily = 'build' | 'tank';

export type CamContext = {
  /** The point of interest on the surface — the tank, or the build cursor. */
  anchor: Vec3;
  /** Unit surface normal at the anchor. */
  normal: Vec3;
  /** Tank heading (build modes use it only as a tangent reference). */
  heading: Vec3;
  /** Elapsed seconds — drives driftorbit. */
  t: number;
  /** User zoom multiplier. */
  zoom: number;
  /** User orbit, radians. Build modes only. */
  orbitYaw: number;
  orbitPitch: number;
};

export type CamFrame = { pos: Vec3; look: Vec3; up: Vec3 };

export type CameraMode = {
  id: string;
  family: CamFamily;
  label: string;
  frame(ctx: CamContext): CamFrame;
};

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A tangent at `n`, stable everywhere including the poles. Preferring
 *  `hint` keeps the view oriented with the tank; the fallback only engages
 *  when hint is parallel to n, which is exactly the degenerate case. */
function tangent(n: Vec3, hint: Vec3): Vec3 {
  const d = hint[0] * n[0] + hint[1] * n[1] + hint[2] * n[2];
  const t: Vec3 = [hint[0] - n[0] * d, hint[1] - n[1] * d, hint[2] - n[2] * d];
  if (Math.hypot(t[0], t[1], t[2]) > 1e-6) return norm(t);
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(ref, n));
}

function at(n: Vec3, h: number): Vec3 {
  return [n[0] * h, n[1] * h, n[2] * h];
}

export const CAMERA_MODES: readonly CameraMode[] = [
  {
    id: 'birdseye',
    family: 'build',
    label: "Bird's eye",
    frame(ctx) {
      const n = norm(ctx.normal);
      const up = tangent(n, ctx.heading);
      return { pos: at(n, 1 + 1.15 * ctx.zoom), look: ctx.anchor, up };
    },
  },
  {
    id: 'raked',
    family: 'build',
    label: 'Raked',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      const side = cross(n, fwd);
      // 45 degrees off the normal, rotated by the user's orbit yaw.
      const c = Math.cos(ctx.orbitYaw);
      const s = Math.sin(ctx.orbitYaw);
      const lat: Vec3 = [fwd[0] * c + side[0] * s, fwd[1] * c + side[1] * s, fwd[2] * c + side[2] * s];
      const h = 1 + 0.9 * ctx.zoom;
      const pos: Vec3 = [
        n[0] * h + lat[0] * 0.85 * ctx.zoom,
        n[1] * h + lat[1] * 0.85 * ctx.zoom,
        n[2] * h + lat[2] * 0.85 * ctx.zoom,
      ];
      return { pos, look: ctx.anchor, up: n };
    },
  },
  {
    id: 'driftorbit',
    family: 'build',
    label: 'Drift orbit',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      const side = cross(n, fwd);
      // Slow automatic orbit: the showcase angle. 0.08 rad/s is roughly one
      // revolution every 78 seconds — movement you notice without tracking.
      const a = ctx.t * 0.08;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const lat: Vec3 = [fwd[0] * c + side[0] * s, fwd[1] * c + side[1] * s, fwd[2] * c + side[2] * s];
      const h = 1 + 0.55 * ctx.zoom;
      const pos: Vec3 = [
        n[0] * h + lat[0] * 1.15 * ctx.zoom,
        n[1] * h + lat[1] * 1.15 * ctx.zoom,
        n[2] * h + lat[2] * 1.15 * ctx.zoom,
      ];
      return { pos, look: ctx.anchor, up: n };
    },
  },
  {
    id: 'chase',
    family: 'tank',
    label: 'Chase',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      // Behind and above: the main tank view.
      const back = 0.16 * ctx.zoom;
      const up = 0.075 * ctx.zoom;
      const pos: Vec3 = [
        ctx.anchor[0] - fwd[0] * back + n[0] * up,
        ctx.anchor[1] - fwd[1] * back + n[1] * up,
        ctx.anchor[2] - fwd[2] * back + n[2] * up,
      ];
      const look: Vec3 = [
        ctx.anchor[0] + fwd[0] * 0.1,
        ctx.anchor[1] + fwd[1] * 0.1,
        ctx.anchor[2] + fwd[2] * 0.1,
      ];
      return { pos, look, up: n };
    },
  },
  {
    id: 'pov',
    family: 'tank',
    label: 'POV',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      const pos: Vec3 = [
        ctx.anchor[0] + n[0] * 0.012,
        ctx.anchor[1] + n[1] * 0.012,
        ctx.anchor[2] + n[2] * 0.012,
      ];
      const look: Vec3 = [
        pos[0] + fwd[0] * 0.2,
        pos[1] + fwd[1] * 0.2,
        pos[2] + fwd[2] * 0.2,
      ];
      return { pos, look, up: n };
    },
  },
];
```

- [ ] **Step 4: Implement `registry.ts`**

```ts
// registry.ts — the rig: which mode is active, how switches ease, and shake.
//
// THE LOAD-BEARING PART. Switching family is what the shell turns into a
// world.setMacro() call. M0a's brain notes §5.2 record that modeSwitches and
// macroShare read 0 in every sweep because nothing ever called setMacro — the
// layer-balance pane of the telemetry, which vision §0 calls the headline
// measurement the rig exists for, has never had data. This is where it starts
// getting some.
//
// SHAKE IS DETERMINISTIC. No Math.random: a sine-sum over elapsed time. Two
// rigs given the same trauma at the same time produce identical output, so a
// replay stays a replay.

import { CAMERA_MODES } from './modes.ts';
import type { CamContext, CamFamily, CamFrame, CameraMode } from './modes.ts';
import type { Vec3 } from '../../core/sphere/vec3.ts';

export type CameraRig = {
  update(dt: number, ctx: CamContext, shakeGain: number): CamFrame;
  setFamily(f: CamFamily): boolean;
  toggleFamily(): CamFamily;
  cycle(): CameraMode;
  addTrauma(amount: number): void;
  readonly family: CamFamily;
  readonly mode: CameraMode;
};

const TRAUMA_DECAY = 1.4; // per second

export function makeCameraRig(transitionSeconds = 0.55): CameraRig {
  let family: CamFamily = 'build';
  let mode: CameraMode = CAMERA_MODES.find((m) => m.family === 'build')!;
  let blend = 1; // 1 = fully settled on `mode`
  let from: CamFrame | null = null;
  let current: CamFrame | null = null;
  let trauma = 0;
  let clock = 0;

  function inFamily(): CameraMode[] {
    return CAMERA_MODES.filter((m) => m.family === family);
  }

  function beginTransition(next: CameraMode): void {
    if (current !== null) {
      from = current;
      blend = 0;
    }
    mode = next;
  }

  function setFamily(f: CamFamily): boolean {
    if (f === family) return false;
    family = f;
    beginTransition(inFamily()[0]!);
    return true;
  }

  function toggleFamily(): CamFamily {
    setFamily(family === 'build' ? 'tank' : 'build');
    return family;
  }

  function cycle(): CameraMode {
    const list = inFamily();
    const i = list.findIndex((m) => m.id === mode.id);
    beginTransition(list[(i + 1) % list.length]!);
    return mode;
  }

  function update(dt: number, ctx: CamContext, shakeGain: number): CamFrame {
    clock += dt;
    trauma = Math.max(0, trauma - TRAUMA_DECAY * dt);

    const target = mode.frame(ctx);

    if (blend < 1 && from !== null) {
      blend = Math.min(1, blend + dt / Math.max(1e-6, transitionSeconds));
      // smoothstep so a switch reads as a beat rather than a linear slide
      const k = blend * blend * (3 - 2 * blend);
      current = {
        pos: mix(from.pos, target.pos, k),
        look: mix(from.look, target.look, k),
        up: mix(from.up, target.up, k),
      };
    } else {
      from = null;
      current = target;
    }

    if (trauma > 0 && shakeGain > 0) {
      // Squared trauma: a small knock barely registers, a big one is felt.
      const a = trauma * trauma * shakeGain * 0.03;
      current = {
        pos: [
          current.pos[0] + a * Math.sin(clock * 47.3),
          current.pos[1] + a * Math.sin(clock * 53.7 + 1.7),
          current.pos[2] + a * Math.sin(clock * 61.1 + 3.1),
        ],
        look: current.look,
        up: current.up,
      };
    }

    return current;
  }

  return {
    update,
    setFamily,
    toggleFamily,
    cycle,
    addTrauma(amount: number) { trauma = Math.min(1, trauma + amount); },
    get family() { return family; },
    get mode() { return mode; },
  };
}

function mix(a: Vec3, b: Vec3, k: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test src/app/cameras/cameras.test.ts 2>&1 | tail -30`
Expected: PASS, 24 tests.

- [ ] **Step 6: Sabotage the pole guard**

In `modes.ts`, replace the body of `tangent` with `return norm([hint[0], hint[1], hint[2]]);` and re-run.
Expected: FAIL on `never returns an up-vector parallel to the view direction` for `birdseye` at `[0,1,0]` — the exact spinning-camera bug. Restore and confirm PASS.

- [ ] **Step 7: Wire the rig into `main.ts`**

In `src/main.ts`, add imports:

```ts
import { makeCameraRig } from './app/cameras/registry.ts';
```

After `const units = makeUnits();` add:

```ts
const rig = makeCameraRig();
const camState = { zoom: 1, orbitYaw: 0.6, orbitPitch: 0.35 };

// TAB switches family, C cycles within it. Family IS the macro/tactical split:
// build = macro, tank = tactical. This is the call that finally gives
// macroShare and modeSwitches data — they have read 0 in every sweep.
window.addEventListener('keydown', (e) => {
  if (e.code === 'Tab') {
    e.preventDefault();
    world.setMacro(rig.toggleFamily() === 'build');
  } else if (e.code === 'KeyC') {
    rig.cycle();
  }
});
world.setMacro(true); // start in build family
```

Inside `frame()`, replace the `units.sync(world);` line with:

```ts
  units.sync(world);

  const tp = world.tank.pos;
  const tl = Math.hypot(tp[0], tp[1], tp[2]) || 1;
  const cam = rig.update(
    Math.min((now - last) / 1000, 0.1),
    {
      anchor: tp,
      normal: [tp[0] / tl, tp[1] / tl, tp[2] / tl],
      heading: world.tank.heading,
      t: world.elapsed,
      zoom: camState.zoom,
      orbitYaw: camState.orbitYaw,
      orbitPitch: camState.orbitPitch,
    },
    renderTarget.camera.shakeGain,
  );
  stage.camera.position.set(cam.pos[0], cam.pos[1], cam.pos[2]);
  stage.camera.up.set(cam.up[0], cam.up[1], cam.up[2]);
  stage.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
```

Move `readRenderState(tuning, renderTarget);` **above** `units.sync(world);` so `renderTarget.camera.shakeGain` is current when the rig reads it.

- [ ] **Step 8: Verify, then commit**

Run: `npm run typecheck && npm test 2>&1 | tail -5`
Expected: typecheck silent, `fail 0`.

Run: `npm run dev` — press `Tab` and `C`; the camera should ease between five distinct framings, never spin.

```bash
./scripts/bust.sh --quiet
git add src/app/cameras/ src/main.ts index.html
git commit -F - <<'EOF'
feat(app): camera mode registry — five modes, eased transitions

The operator asked for a camera system, not two viewpoints. Modes are
declared as data the way LEVERS declares levers, so adding a
top-down-over-tank or a scripted beat camera later is one entry rather than
a refactor — vision §6.6 already lists beatCameras and intensityFraming as
camera levers, and this is the structure they hang off.

Nothing here imports three.js, so every mode is Node-testable. That matters
most for the pole degeneracy: framing off a surface normal has a
singularity where up aligns with the view direction, and the failure mode
is a camera that spins. Asserted directly at five positions including both
poles, and verified by sabotage — replacing the stable-tangent fallback
fails birdseye at [0,1,0].

Family switching is the load-bearing part: it calls world.setMacro().
M0a brain-notes §5.2 records that modeSwitches and macroShare read 0 in
every sweep because nothing ever called it, so the layer-balance pane —
which vision §0 calls the headline measurement the rig exists for — has
never had data.

Shake is a sine-sum over elapsed time rather than Math.random, so a replay
stays a replay. Trauma is squared so a small knock barely registers.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 8: `app/input.ts` — keyboard and touch parity

**Files:**
- Create: `src/app/input.ts`
- Test: `src/app/input.test.ts`
- Modify: `src/main.ts`, `src/style.css`

**Interfaces:**
- Consumes: `TankInput` from `core/sim/tank.ts`; `cellFromFaceIndex` from `render/board.ts`.
- Produces:
  ```ts
  export type InputState = {
    tank: TankInput;
    zoom: number;
    orbitYaw: number;
    orbitPitch: number;
    /** Cells tapped since the last drain, in order. */
    drainTaps(): { x: number; y: number }[];
    toggleFamily: boolean;   // consumed and cleared by the shell
    cycleCamera: boolean;
  };
  export type InputOpts = { isBuildFamily(): boolean };
  export function makeInput(canvas: HTMLCanvasElement, opts: InputOpts): InputState;
  export function applyStick(dx: number, dy: number, deadzone?: number): { forward: number; turn: number };
  export function clampZoom(z: number): number;
  ```

**Background the implementer needs:**

Touch parity is not a nicety. The operator tunes on a phone against the deployed Pages build. Without touch driving, **every phone session reports a tank that never acts** — `tankIdleUnderThreat` pinned high and `playerKillShare` near zero for a reason that is an input gap, not a balance finding. The rig would be lying about the exact ratio vision §0 calls its headline number.

| | Build family | Tank family |
|---|---|---|
| Desktop | drag = orbit · wheel = zoom · click = place | WASD/arrows = drive · Space = fire |
| Touch | drag = orbit · pinch = zoom · tap = place | left-half stick · right-half fire |

`applyStick` and `clampZoom` are pulled out as pure functions so the fiddly parts — deadzone, normalisation, clamping — are Node-tested without a DOM. The event plumbing itself is verified by hand in Step 6.

`src/style.css` already sets `touch-action: none` on `#scene` (Task 4). Without it the browser claims drag and pinch for scroll and zoom, and none of this receives events.

- [ ] **Step 1: Write the failing test**

Create `src/app/input.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStick, clampZoom } from './input.ts';

describe('virtual stick', () => {
  test('centre is dead — no drift', () => {
    assert.deepEqual(applyStick(0, 0), { forward: 0, turn: 0 });
  });

  test('inside the deadzone produces no movement', () => {
    const r = applyStick(0.05, 0.05, 0.2);
    assert.equal(r.forward, 0);
    assert.equal(r.turn, 0);
  });

  test('pushing up drives forward, pushing down reverses', () => {
    // screen y grows downward, so up is negative dy
    assert.ok(applyStick(0, -1).forward > 0.9);
    assert.ok(applyStick(0, 1).forward < -0.9);
  });

  test('pushing right turns right', () => {
    assert.ok(applyStick(1, 0).turn > 0.9);
    assert.ok(applyStick(-1, 0).turn < -0.9);
  });

  test('output is clamped to -1..1 however far the finger travels', () => {
    const r = applyStick(50, -50);
    assert.ok(r.forward <= 1 && r.forward >= -1);
    assert.ok(r.turn <= 1 && r.turn >= -1);
  });
});

describe('zoom clamp', () => {
  test('stays inside sane bounds', () => {
    assert.ok(clampZoom(0.0001) >= 0.35);
    assert.ok(clampZoom(1000) <= 3);
    assert.equal(clampZoom(1), 1);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/app/input.test.ts 2>&1 | tail -20`
Expected: FAIL — `Cannot find module './input.ts'`.

- [ ] **Step 3: Implement `input.ts`**

```ts
// input.ts — keyboard/mouse and touch, at parity.
//
// WHY PARITY IS NOT A NICETY. The operator tunes on a phone, against the
// deployed build. Without touch driving, every phone session reports a tank
// that never acts: tankIdleUnderThreat pinned high, playerKillShare near zero
// — for a reason that is an input gap, not a balance finding. The rig would be
// lying about the exact ratio vision §0 calls its headline number.
//
// The fiddly maths (deadzone, normalisation, clamping) is exported as pure
// functions so it is Node-tested without a DOM; the event plumbing is verified
// by hand.
//
// #scene sets touch-action: none. Without it the browser claims drag and pinch
// for scroll and zoom, and none of this ever fires.

import type { TankInput } from '../core/sim/tank.ts';

const STICK_RADIUS = 60; // px to full deflection

/** Map a stick offset in pixels to tank input. Screen y grows downward, so
 *  pushing up (negative dy) must drive forward. */
export function applyStick(dx: number, dy: number, deadzone = 0.15): { forward: number; turn: number } {
  const nx = dx / STICK_RADIUS;
  const ny = dy / STICK_RADIUS;
  const mag = Math.hypot(nx, ny);
  if (mag < deadzone) return { forward: 0, turn: 0 };
  return {
    forward: Math.max(-1, Math.min(1, -ny)),
    turn: Math.max(-1, Math.min(1, nx)),
  };
}

export function clampZoom(z: number): number {
  return Math.max(0.35, Math.min(3, z));
}

export type InputState = {
  tank: TankInput;
  zoom: number;
  orbitYaw: number;
  orbitPitch: number;
  drainTaps(): { x: number; y: number }[];
  toggleFamily: boolean;
  cycleCamera: boolean;
};

export type InputOpts = { isBuildFamily(): boolean };

export function makeInput(canvas: HTMLCanvasElement, opts: InputOpts): InputState {
  const state: InputState = {
    tank: { forward: 0, turn: 0, fire: false },
    zoom: 1,
    orbitYaw: 0.6,
    orbitPitch: 0.35,
    drainTaps: () => {
      const out = taps.slice();
      taps.length = 0;
      return out;
    },
    toggleFamily: false,
    cycleCamera: false,
  };

  const taps: { x: number; y: number }[] = [];
  const keys = new Set<string>();

  // ── keyboard ────────────────────────────────────────────────────────────
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Tab') { e.preventDefault(); state.toggleFamily = true; return; }
    if (e.code === 'KeyC') { state.cycleCamera = true; return; }
    keys.add(e.code);
    if (e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));

  function readKeys(): void {
    const up = keys.has('KeyW') || keys.has('ArrowUp');
    const down = keys.has('KeyS') || keys.has('ArrowDown');
    const left = keys.has('KeyA') || keys.has('ArrowLeft');
    const right = keys.has('KeyD') || keys.has('ArrowRight');
    state.tank.forward = (up ? 1 : 0) + (down ? -1 : 0);
    state.tank.turn = (right ? 1 : 0) + (left ? -1 : 0);
    state.tank.fire = keys.has('Space');
  }

  // ── mouse: drag orbits (build), click places (build) ─────────────────────
  let dragging = false;
  let lastX = 0;
  let lastY = 0;
  let moved = 0;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'touch') return; // touch handled below
    dragging = true;
    moved = 0;
    lastX = e.clientX;
    lastY = e.clientY;
    canvas.setPointerCapture(e.pointerId);
  });

  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'touch' || !dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    moved += Math.abs(dx) + Math.abs(dy);
    if (opts.isBuildFamily()) {
      state.orbitYaw += dx * 0.005;
      state.orbitPitch = Math.max(-1.4, Math.min(1.4, state.orbitPitch + dy * 0.005));
    }
  });

  canvas.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'touch') return;
    dragging = false;
    // A click is a tap only if the pointer barely moved — otherwise the user
    // was orbiting and would place a tower by accident on every drag release.
    if (moved < 6 && opts.isBuildFamily()) taps.push({ x: e.clientX, y: e.clientY });
  });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    state.zoom = clampZoom(state.zoom * (1 + Math.sign(e.deltaY) * 0.1));
  }, { passive: false });

  // ── touch ────────────────────────────────────────────────────────────────
  // Build family: one finger orbits, two pinch, a stationary tap places.
  // Tank family: left half is a virtual stick, right half fires.
  const touches = new Map<number, { x: number; y: number; x0: number; y0: number; left: boolean }>();
  let pinchStart = 0;
  let pinchZoom0 = 1;

  canvas.addEventListener('touchstart', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const left = t.clientX < window.innerWidth / 2;
      touches.set(t.identifier, { x: t.clientX, y: t.clientY, x0: t.clientX, y0: t.clientY, left });
      if (!opts.isBuildFamily() && !left) state.tank.fire = true;
    }
    if (touches.size === 2 && opts.isBuildFamily()) {
      pinchStart = pinchDistance();
      pinchZoom0 = state.zoom;
    }
  }, { passive: false });

  canvas.addEventListener('touchmove', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const rec = touches.get(t.identifier);
      if (!rec) continue;
      const dx = t.clientX - rec.x;
      const dy = t.clientY - rec.y;
      rec.x = t.clientX;
      rec.y = t.clientY;
      if (opts.isBuildFamily() && touches.size === 1) {
        state.orbitYaw += dx * 0.005;
        state.orbitPitch = Math.max(-1.4, Math.min(1.4, state.orbitPitch + dy * 0.005));
      }
    }
    if (touches.size === 2 && opts.isBuildFamily() && pinchStart > 0) {
      state.zoom = clampZoom(pinchZoom0 * (pinchStart / Math.max(1, pinchDistance())));
    }
  }, { passive: false });

  canvas.addEventListener('touchend', (e) => {
    e.preventDefault();
    for (const t of Array.from(e.changedTouches)) {
      const rec = touches.get(t.identifier);
      touches.delete(t.identifier);
      if (!rec) continue;
      const travel = Math.hypot(t.clientX - rec.x0, t.clientY - rec.y0);
      if (opts.isBuildFamily() && travel < 10 && touches.size === 0) {
        taps.push({ x: t.clientX, y: t.clientY });
      }
      if (!opts.isBuildFamily() && !rec.left) state.tank.fire = false;
    }
    if (touches.size < 2) pinchStart = 0;
  }, { passive: false });

  function pinchDistance(): number {
    const pts = Array.from(touches.values());
    const a = pts[0];
    const b = pts[1];
    if (!a || !b) return 0;
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  // Poll: keyboard wins when present; otherwise the left-half stick drives.
  const originalTank = state.tank;
  Object.defineProperty(state, 'tank', {
    get(): TankInput {
      readKeys();
      if (originalTank.forward === 0 && originalTank.turn === 0 && !opts.isBuildFamily()) {
        for (const rec of touches.values()) {
          if (!rec.left) continue;
          const s = applyStick(rec.x - rec.x0, rec.y - rec.y0);
          originalTank.forward = s.forward;
          originalTank.turn = s.turn;
          break;
        }
      }
      return originalTank;
    },
  });

  return state;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/app/input.test.ts 2>&1 | tail -20`
Expected: PASS, 7 tests.

- [ ] **Step 5: Wire input + raycast tower placement into `main.ts`**

Replace the ad-hoc keydown block added in Task 7 with the input module. Add imports:

```ts
import * as THREE from 'three';
import { makeInput } from './app/input.ts';
import { cellFromFaceIndex } from './render/board.ts';
```

Capture the board group so it can be raycast — change `stage.scene.add(makeBoard(...))` to:

```ts
const board = makeBoard(world.mesh, world.dungeon);
stage.scene.add(board);
```

Replace the Task 7 keydown listener and `world.setMacro(true)` with:

```ts
const input = makeInput(canvas, { isBuildFamily: () => rig.family === 'build' });
const raycaster = new THREE.Raycaster();
world.setMacro(true); // build family is macro

function placeFromTap(tap: { x: number; y: number }): void {
  const ndc = new THREE.Vector2(
    (tap.x / window.innerWidth) * 2 - 1,
    -(tap.y / window.innerHeight) * 2 + 1,
  );
  raycaster.setFromCamera(ndc, stage.camera);
  const hit = raycaster.intersectObject(board, true)[0];
  if (!hit || hit.faceIndex === undefined) return;
  const cell = cellFromFaceIndex(hit.faceIndex);
  if (cell < 0) return;
  // world.placeTower already refuses BLOCKED and occupied cells, and counts a
  // decision only on success — do not duplicate that rule here.
  if (!world.placeTower(cell)) rig.addTrauma(0.12); // a small refusal nudge
}
```

Inside `frame()`, before `loop.advance(...)`, add:

```ts
  if (input.toggleFamily) {
    input.toggleFamily = false;
    world.setMacro(rig.toggleFamily() === 'build');
  }
  if (input.cycleCamera) {
    input.cycleCamera = false;
    rig.cycle();
  }
  for (const tap of input.drainTaps()) placeFromTap(tap);
```

Change the loop's step to consume real input — replace the `makeLoop({...})` call with:

```ts
const loop = makeLoop({
  step: (dt) => world.tick(dt, input.tank),
  done: () => world.heartDied,
});
```

And replace `camState` usage in the rig update with `input.zoom` / `input.orbitYaw` / `input.orbitPitch`, deleting the now-unused `camState` const (`noUnusedLocals` will otherwise fail the build).

- [ ] **Step 6: Verify by hand**

Run: `npm run typecheck && npm test 2>&1 | tail -5 && npm run dev`

Check each:
- `Tab` toggles between build and tank framing.
- In build: drag orbits, wheel zooms, a click on an open cell adds a turret; a click on a BLOCKED cell adds nothing.
- Press `Tab`, then WASD drives the tank and Space fires.
- Open devtools' device toolbar (or load on the phone): drag orbits, pinch zooms, tap places; in tank family the left half steers and the right half fires.

- [ ] **Step 7: Commit**

```bash
./scripts/bust.sh --quiet
git add src/app/input.ts src/app/input.test.ts src/main.ts index.html
git commit -F - <<'EOF'
feat(app): keyboard and touch input at parity, with raycast tower placement

Touch parity is load-bearing, not polish. The operator tunes on a phone
against the deployed build; without touch driving, every phone session
would report a tank that never acts — tankIdleUnderThreat pinned high and
playerKillShare near zero — for a reason that is an input gap rather than a
balance finding. The rig would be lying about the exact ratio vision §0
calls its headline number.

The fiddly parts (deadzone, normalisation, zoom clamping) are pure exported
functions so they are Node-tested without a DOM; event plumbing is checked
by hand.

A click counts as a tap only when the pointer barely moved, otherwise every
orbit-drag release would place a tower. Placement raycasts the board and
resolves faceIndex through the mapping built when the geometry was emitted;
world.placeTower keeps sole ownership of the BLOCKED/occupied rules rather
than having them restated at the call site.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

*Tasks 9–13 continue in `2026-08-26-m0b-rig-visible-part3.md` — the player HUD and Admin Mode (gate, dashboard, presets, telemetry readout, A/B compare), then the acceptance pass.*
