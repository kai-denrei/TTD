# M0c-1 — Walls & High Ground · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the board its third dimension — BLOCKED cells become extruded walls with tops and skirts — move towers onto the high ground, and fix the two tank bugs that make the tactical layer unsteerable and its telemetry untrue.

**Architecture:** The extrusion is a **pure function** in `render/geometry.ts` returning plain typed arrays; `board.ts` shrinks to uploading them. Placement flips to BLOCKED-only in `core/sim/world.ts`, backed by a new pure `nearestFrontierWall` helper in `core/sphere/dungeon.ts`. The simulation stays 2D-on-sphere: elevation is spatial, never mechanical.

**Tech Stack:** Vite 6 · TypeScript 5.7 · three 0.170 · `node --test`.

## Global Constraints

- **`src/core/` stays pure.** No `three` import, no `Math.random`, no `document.`/`window.`/`performance.now(`/`Date.now(`. `src/core/architecture.test.ts` enforces this by recursing over `core/`.
- **`render/geometry.ts` and `render/bindings.ts` must stay three-free** so they remain Node-testable. Task 1 extends `architecture.test.ts` to enforce this rather than leave it as convention.
- **`verbatimModuleSyntax: true`** — type-only imports MUST use `import type`.
- **`allowImportingTsExtensions: true`** — every relative import ends in `.ts`.
- **`noUncheckedIndexedAccess: true`** — indexing a variable-length array yields `T | undefined`; guard or `!` it. Fixed-length tuples (`Vec3 = readonly [number, number, number]`) are exempt.
- **`noUnusedLocals` / `noUnusedParameters: true`** — an unused import or parameter is a compile error.
- **`wallHeight = 0.03`** — the PoC's value (`td-tab.js:47`). Mean chord on this mesh is 0.068, so a wall stands ≈0.44 of a cell.
- **Mesh facts, measured, not assumed:** all 2662 cells are quads; every edge is shared by exactly 2 quads; ~73% of cells are BLOCKED.
- Run `npm run typecheck` **and** `npm test` before every commit.
- Commit trailer on every commit:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
  ```
- After editing sources, `./scripts/bust.sh --quiet`.
- **TTD dev server is port 5144** (`npm run dev`), preview 5145. Check ports with `curl localhost:5144` — vite binds IPv6 only, so a `127.0.0.1` probe falsely reports the server down.

---

## File Structure

| File | Responsibility |
|---|---|
| `src/render/geometry.ts` | **new** · `buildBoardGeometry` — pure extrusion to plain arrays |
| `src/render/geometry.test.ts` | **new** · surfaces, radii, skirt filtering, winding, faceCell |
| `src/core/sphere/dungeon.ts` | **modify** · add `nearestFrontierWall`, `isFrontierWall` |
| `src/core/sim/world.ts` | **modify** · placement flips to BLOCKED + frontier |
| `src/core/sim/runner.ts` | **modify** · `towers: 'heart'` resolves to the frontier wall |
| `src/core/liveness.test.ts` | **modify** · baseline tower moves to the frontier wall |
| `src/core/sim/tank.ts` | **modify** · turn negation, `acting` includes turn |
| `src/core/architecture.test.ts` | **modify** · guard pure render modules |
| `src/render/board.ts` | **modify** · consume `buildBoardGeometry`; pick floor + walls |
| `src/render/units.ts` | **modify** · towers sit on wall tops |
| `docs/01-M0-tuning-rig-spec.md` | **modify** · §7 reverted to wall cells |
| `docs/05-M0c-notes.md` | **new** · findings + the baseline break |
| `CLAUDE.md` | **modify** · State + known-state note |

---

### Task 1: `render/geometry.ts` — the pure extrusion

**Files:**
- Create: `src/render/geometry.ts`
- Test: `src/render/geometry.test.ts`
- Modify: `src/core/architecture.test.ts`

**Interfaces:**
- Consumes: `SphereMesh` from `core/sphere/grid.ts`; `Dungeon`, `BLOCKED`, `PATH` from `core/sphere/dungeon.ts`.
- Produces:
  ```ts
  export const WALL_HEIGHT: number;                 // 0.03
  export type BoardGeometry = {
    positions: Float32Array;  // xyz per vertex, non-indexed
    colors: Float32Array;     // rgb per vertex
    faceCell: Int32Array;     // triangle index -> source cell
    counts: { floor: number; wallTop: number; skirt: number };  // triangles per surface
  };
  export function buildBoardGeometry(
    mesh: SphereMesh, dungeon: Dungeon, opts?: { wallHeight?: number },
  ): BoardGeometry;
  ```

**Background the implementer needs:**

Three surfaces from one cell graph: **floor** (open cells at r=1), **wall tops** (BLOCKED cells at r=1+wallHeight), **skirts** (the vertical face on each BLOCKED↔open edge).

**Skirts are filtered, and the filter is the point.** An edge between two BLOCKED cells is interior to a wall mass; its skirt would be invisible geometry inside solid rock. With ~73% of cells BLOCKED, naive skirting emits several times the necessary triangles.

**Finding the cell across an edge:** the mesh is a clean quad manifold — every edge is shared by exactly 2 quads (measured). Build a map from a sorted vertex-pair key to its two owning cells; the neighbour across an edge is the owner that is not the current cell.

**Winding matters and fails silently.** A backwards-wound skirt is invisible from outside and reads as a hole in the wall, not as an error. Floor and wall-top triangles inherit `mesh.quads` winding, which is already outward (M0b renders correctly with `FrontSide`). Skirts are built fresh, so their winding must be computed: the skirt faces the **open** cell, so its normal must have a positive dot with `(openCenter − wallCenter)`. Compute the normal, flip the triangle if it points the wrong way.

**Colours** (no lights — the board uses `MeshBasicMaterial`, so relief comes from authored colour):
floor PATH `0x2b4a7a`, floor ROOM `0x3f6ea8`, wall top `0x223052`, skirt `0x101a2e`.

- [ ] **Step 1: Write the failing test**

Create `src/render/geometry.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardGeometry, WALL_HEIGHT } from './geometry.ts';
import { generateSphereMesh } from '../core/sphere/grid.ts';
import { generateDungeon, BLOCKED } from '../core/sphere/dungeon.ts';

const mesh = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
const dungeon = generateDungeon(mesh, {
  seed: 7, rooms: 12, roomRadius: 4, extraCorridors: 6, corridorWidth: 1,
});
const geo = buildBoardGeometry(mesh, dungeon);

function tri(i: number): Array<[number, number, number]> {
  const p = geo.positions;
  const o = i * 9;
  return [
    [p[o]!, p[o + 1]!, p[o + 2]!],
    [p[o + 3]!, p[o + 4]!, p[o + 5]!],
    [p[o + 6]!, p[o + 7]!, p[o + 8]!],
  ];
}
function radius(v: [number, number, number]): number {
  return Math.hypot(v[0], v[1], v[2]);
}
function normalOf(t: Array<[number, number, number]>): [number, number, number] {
  const [a, b, c] = [t[0]!, t[1]!, t[2]!];
  const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [
    u[1]! * w[2]! - u[2]! * w[1]!,
    u[2]! * w[0]! - u[0]! * w[2]!,
    u[0]! * w[1]! - u[1]! * w[0]!,
  ];
}

const TOTAL = geo.counts.floor + geo.counts.wallTop + geo.counts.skirt;

describe('board geometry — structure', () => {
  test('arrays are consistent with the triangle count', () => {
    assert.equal(geo.positions.length, TOTAL * 9);
    assert.equal(geo.colors.length, TOTAL * 9);
    assert.equal(geo.faceCell.length, TOTAL);
  });

  test('every triangle names a real cell', () => {
    for (let i = 0; i < TOTAL; i++) {
      const cell = geo.faceCell[i]!;
      assert.ok(cell >= 0 && cell < mesh.quads.length, `triangle ${i} -> cell ${cell}`);
    }
  });

  test('is deterministic — two builds are byte-identical', () => {
    const again = buildBoardGeometry(mesh, dungeon);
    assert.deepEqual(Array.from(again.positions), Array.from(geo.positions));
    assert.deepEqual(Array.from(again.faceCell), Array.from(geo.faceCell));
  });
});

describe('board geometry — surfaces sit at the right radius', () => {
  test('floor triangles are on the unit sphere and belong to open cells', () => {
    for (let i = 0; i < geo.counts.floor; i++) {
      assert.notEqual(dungeon.tags[geo.faceCell[i]!], BLOCKED, `floor tri ${i} on a BLOCKED cell`);
      for (const v of tri(i)) assert.ok(Math.abs(radius(v) - 1) < 1e-9, `floor r=${radius(v)}`);
    }
  });

  test('wall tops are lifted by exactly WALL_HEIGHT and belong to BLOCKED cells', () => {
    const start = geo.counts.floor;
    for (let i = start; i < start + geo.counts.wallTop; i++) {
      assert.equal(dungeon.tags[geo.faceCell[i]!], BLOCKED, `wall tri ${i} on an open cell`);
      for (const v of tri(i)) {
        assert.ok(Math.abs(radius(v) - (1 + WALL_HEIGHT)) < 1e-9, `wall top r=${radius(v)}`);
      }
    }
  });

  test('skirt vertices sit at exactly one of the two radii, never between', () => {
    const start = geo.counts.floor + geo.counts.wallTop;
    for (let i = start; i < TOTAL; i++) {
      for (const v of tri(i)) {
        const r = radius(v);
        const onFloor = Math.abs(r - 1) < 1e-9;
        const onTop = Math.abs(r - (1 + WALL_HEIGHT)) < 1e-9;
        assert.ok(onFloor || onTop, `skirt vertex at r=${r} is neither floor nor top`);
      }
    }
  });
});

describe('board geometry — the skirt filter', () => {
  // Derived from the dungeon, NOT observed from the build: a skirt exists for
  // every BLOCKED-open edge and for no BLOCKED-BLOCKED edge. Two triangles each.
  test('emits exactly two triangles per BLOCKED-open edge and none elsewhere', () => {
    const owners = new Map<string, number[]>();
    mesh.quads.forEach((q, ci) => {
      for (let i = 0; i < q.length; i++) {
        const a = q[i]!;
        const b = q[(i + 1) % q.length]!;
        const k = a < b ? `${a}:${b}` : `${b}:${a}`;
        const list = owners.get(k);
        if (list === undefined) owners.set(k, [ci]);
        else list.push(ci);
      }
    });
    let expected = 0;
    for (const cells of owners.values()) {
      const [x, y] = [cells[0]!, cells[1]!];
      const bx = dungeon.tags[x] === BLOCKED;
      const by = dungeon.tags[y] === BLOCKED;
      if (bx !== by) expected += 1; // exactly one side is wall
    }
    assert.ok(expected > 0, 'the test fixture has no wall-open boundary at all');
    assert.equal(geo.counts.skirt, expected * 2, 'skirt triangle count does not match the boundary');
  });

  test('every skirt triangle is attributed to its BLOCKED cell, not the open one', () => {
    const start = geo.counts.floor + geo.counts.wallTop;
    for (let i = start; i < TOTAL; i++) {
      assert.equal(dungeon.tags[geo.faceCell[i]!], BLOCKED, `skirt tri ${i} attributed to an open cell`);
    }
  });
});

describe('board geometry — winding', () => {
  test('floor and wall-top triangles face outward from the sphere', () => {
    for (let i = 0; i < geo.counts.floor + geo.counts.wallTop; i++) {
      const t = tri(i);
      const n = normalOf(t);
      const c: [number, number, number] = [
        (t[0]![0] + t[1]![0] + t[2]![0]) / 3,
        (t[0]![1] + t[1]![1] + t[2]![1]) / 3,
        (t[0]![2] + t[1]![2] + t[2]![2]) / 3,
      ];
      assert.ok(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0, `triangle ${i} faces inward`);
    }
  });

  test('skirt triangles face away from their wall cell', () => {
    // A backwards skirt is invisible from outside and reads as a hole, not an error.
    const start = geo.counts.floor + geo.counts.wallTop;
    for (let i = start; i < TOTAL; i++) {
      const t = tri(i);
      const n = normalOf(t);
      const wc = mesh.centers[geo.faceCell[i]!]!;
      const c: [number, number, number] = [
        (t[0]![0] + t[1]![0] + t[2]![0]) / 3,
        (t[0]![1] + t[1]![1] + t[2]![1]) / 3,
        (t[0]![2] + t[1]![2] + t[2]![2]) / 3,
      ];
      const away = [c[0] - wc[0], c[1] - wc[1], c[2] - wc[2]];
      assert.ok(
        n[0] * away[0]! + n[1] * away[1]! + n[2] * away[2]! > 0,
        `skirt ${i} faces into its own wall — invisible from outside`,
      );
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `node --test src/render/geometry.test.ts 2>&1 | tail -5`
Expected: FAIL — `Cannot find module './geometry.ts'`.

- [ ] **Step 3: Implement `geometry.ts`**

```ts
// geometry.ts — the board's third dimension, as plain arrays.
//
// WHY THIS IS PURE. Skirt classification is exactly the kind of logic that
// fails silently: a skirt on the wrong edge, wound backwards so it is
// invisible from outside, or a faceCell entry off by one that makes clicking a
// wall select its neighbour. None of those look broken on screen. M0b already
// shipped one bug of that shape — a decorative edge overlay that swallowed
// every tower placement, invisible until the app was driven and the live world
// read back. So the extrusion imports nothing from three and is Node-tested;
// board.ts shrinks to uploading these arrays.
//
// THE SKIRT FILTER IS THE POINT. An edge between two BLOCKED cells is interior
// to a wall mass and its skirt would be geometry buried inside solid rock. On
// this board ~73% of cells are BLOCKED, so skirting every wall edge would emit
// several times the triangles for nothing visible.
//
// NON-INDEXED, like M0b: vertices are shared between adjacent quads, so a
// per-vertex colour bleeds one cell's dungeon tag into its neighbours.

import type { SphereMesh } from '../core/sphere/grid.ts';
import type { Dungeon } from '../core/sphere/dungeon.ts';
import { BLOCKED, PATH } from '../core/sphere/dungeon.ts';

/** The PoC's value (td-tab.js:47). Mean chord here is 0.068, so a wall stands
 *  ~0.44 of a cell: enough relief to read, low enough to see over. */
export const WALL_HEIGHT = 0.03;

const C_PATH: readonly [number, number, number] = [0x2b / 255, 0x4a / 255, 0x7a / 255];
const C_ROOM: readonly [number, number, number] = [0x3f / 255, 0x6e / 255, 0xa8 / 255];
const C_WALLTOP: readonly [number, number, number] = [0x22 / 255, 0x30 / 255, 0x52 / 255];
const C_SKIRT: readonly [number, number, number] = [0x10 / 255, 0x1a / 255, 0x2e / 255];

export type BoardGeometry = {
  positions: Float32Array;
  colors: Float32Array;
  faceCell: Int32Array;
  counts: { floor: number; wallTop: number; skirt: number };
};

type Vec = [number, number, number];

export function buildBoardGeometry(
  mesh: SphereMesh,
  dungeon: Dungeon,
  opts?: { wallHeight?: number },
): BoardGeometry {
  const h = opts?.wallHeight ?? WALL_HEIGHT;
  const positions: number[] = [];
  const colors: number[] = [];
  const faceCell: number[] = [];

  const isWall = (c: number): boolean => dungeon.tags[c] === BLOCKED;

  function emit(a: Vec, b: Vec, c: Vec, col: readonly [number, number, number], cell: number): void {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) colors.push(col[0], col[1], col[2]);
    faceCell.push(cell);
  }

  function at(vi: number, radius: number): Vec {
    const v = mesh.verts[vi]!;
    return [v[0] * radius, v[1] * radius, v[2] * radius];
  }

  // ── floor + wall tops ────────────────────────────────────────────────────
  // Fan-triangulated from mesh.quads, whose winding is already outward (M0b
  // renders correctly with FrontSide), so these inherit correct facing.
  let floorTris = 0;
  let wallTris = 0;
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined || quad.length < 3) continue;
    const wall = isWall(cell);
    const r = wall ? 1 + h : 1;
    const col = wall ? C_WALLTOP : dungeon.tags[cell] === PATH ? C_PATH : C_ROOM;
    for (let i = 1; i + 1 < quad.length; i++) {
      emit(at(quad[0]!, r), at(quad[i]!, r), at(quad[i + 1]!, r), col, cell);
      if (wall) wallTris++; else floorTris++;
    }
  }

  // Floor and wall triangles are interleaved above but the tests (and the
  // renderer's draw ranges) want them grouped. Rebuild in two passes instead of
  // sorting after the fact — clearer, and the cost is one extra iteration.
  // (Implemented below by construction; see the grouped emit order.)

  // ── skirts ───────────────────────────────────────────────────────────────
  // The mesh is a clean quad manifold: every edge is shared by exactly two
  // quads (measured), so the cell across an edge is unambiguous.
  const owners = new Map<number, number[]>();
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined) continue;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % quad.length]!;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      const list = owners.get(key);
      if (list === undefined) owners.set(key, [cell]);
      else list.push(cell);
    }
  }

  let skirtTris = 0;
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined || !isWall(cell)) continue;
    const wc = mesh.centers[cell]!;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % quad.length]!;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      const pair = owners.get(key);
      if (pair === undefined) continue;
      const other = pair[0] === cell ? pair[1] : pair[0];
      if (other === undefined || isWall(other)) continue; // interior wall edge

      const aTop = at(a, 1 + h);
      const bTop = at(b, 1 + h);
      const aBot = at(a, 1);
      const bBot = at(b, 1);

      // Face the open cell. A backwards skirt is invisible from outside and
      // reads as a hole in the wall rather than as an error, so the winding is
      // computed rather than assumed.
      const oc = mesh.centers[other]!;
      const away: Vec = [oc[0] - wc[0], oc[1] - wc[1], oc[2] - wc[2]];
      const flip = dot(normal(aBot, bBot, bTop), away) < 0;

      if (flip) {
        emit(bBot, aBot, aTop, C_SKIRT, cell);
        emit(bBot, aTop, bTop, C_SKIRT, cell);
      } else {
        emit(aBot, bBot, bTop, C_SKIRT, cell);
        emit(aBot, bTop, aTop, C_SKIRT, cell);
      }
      skirtTris += 2;
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    faceCell: Int32Array.from(faceCell),
    counts: { floor: floorTris, wallTop: wallTris, skirt: skirtTris },
  };
}

function normal(a: Vec, b: Vec, c: Vec): Vec {
  const u: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: Vec = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
```

**Note for the implementer:** the tests index triangles by surface as
`[0, floor) [floor, floor+wallTop) [.., +skirt)`, so floor and wall-top
triangles must be **grouped, not interleaved**. Emit them in two separate loops
over the cells — floor cells first, then wall cells — rather than the single
combined loop sketched above. Keep skirts last.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `node --test src/render/geometry.test.ts 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: PASS, 10 tests.

- [ ] **Step 5: Sabotage the skirt filter**

Change `if (other === undefined || isWall(other)) continue;` to
`if (other === undefined) continue;` — skirting every wall edge, including
interior ones.

Run: `node --test src/render/geometry.test.ts 2>&1 | grep -E "skirt|^. (pass|fail)"`
Expected: FAIL on `emits exactly two triangles per BLOCKED-open edge`.
Restore and confirm PASS. A guard that passes against its own bug certifies the bug.

- [ ] **Step 6: Extend `architecture.test.ts` to guard pure render modules**

Append to `src/core/architecture.test.ts`:

```ts
// Modules under render/ that MUST stay three-free so they remain Node-testable.
// Their correctness is asserted by node --test; importing three would silently
// end that, and the erosion would look like an ordinary refactor.
const PURE_RENDER = ['bindings.ts', 'geometry.ts'];

test('pure render modules never import three.js', () => {
  const renderDir = fileURLToPath(new URL('../render/', import.meta.url));
  for (const name of PURE_RENDER) {
    const code = stripComments(readFileSync(join(renderDir, name), 'utf8'));
    assert.ok(
      !/from\s+['"]three['"]/.test(code) && !/from\s+['"]three\//.test(code),
      `render/${name} imports three.js but is on the pure list; either keep it pure or remove it from PURE_RENDER and drop its Node tests`,
    );
  }
});
```

- [ ] **Step 7: Full suite, typecheck, commit**

```bash
npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"
git add src/render/geometry.ts src/render/geometry.test.ts src/core/architecture.test.ts
git commit -F - <<'EOF'
feat(render): pure board extrusion — floor, wall tops, skirts

Skirt classification fails silently: a skirt on the wrong edge, wound
backwards so it is invisible from outside, or a faceCell off by one that
makes clicking a wall select its neighbour all look fine on screen. M0b
already shipped exactly that shape of bug. So the extrusion imports nothing
from three and is Node-tested; board.ts shrinks to uploading arrays.

Skirts are emitted only on BLOCKED-open edges. An edge between two walls is
interior to a wall mass, and with ~73% of cells BLOCKED, skirting every wall
edge would emit several times the triangles for nothing visible. The
expected count is derived from the dungeon rather than observed from the
build, so a filter regression fails rather than drifts.

Winding is computed, not assumed: the skirt must face the open cell, and a
backwards one reads as a hole in the wall rather than as an error.

architecture.test.ts now guards render/bindings.ts and render/geometry.ts
against importing three. Both are pure so they can be Node-tested; that was
convention until now, and convention is what erodes.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 2: `nearestFrontierWall` — where a tower may stand

**Files:**
- Modify: `src/core/sphere/dungeon.ts`
- Test: `src/core/sphere/dungeon.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export function isFrontierWall(mesh: SphereMesh, d: Dungeon, cell: number): boolean;
  export function nearestFrontierWall(mesh: SphereMesh, d: Dungeon, from: number): number;
  ```

**Background:** a **frontier wall** is a BLOCKED cell bordering at least one open cell — the PoC's *"beyond the frontier"* rule. A wall buried inside a wall mass overlooks nothing and can shoot nothing; with ~73% of the board BLOCKED, most wall cells are buried, so without this rule most legal placements would be useless. BFS ties break by lowest cell index so the result is deterministic. Returns `-1` when no frontier wall exists.

- [ ] **Step 1: Write the failing test** — append to `src/core/sphere/dungeon.test.ts`:

```ts
import { isFrontierWall, nearestFrontierWall } from './dungeon.ts';

describe('frontier walls', () => {
  const mesh = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
  const d = generateDungeon(mesh, {
    seed: 7, rooms: 12, roomRadius: 4, extraCorridors: 6, corridorWidth: 1,
  });

  test('a frontier wall is BLOCKED and borders at least one open cell', () => {
    const cell = nearestFrontierWall(mesh, d, d.heart);
    assert.notEqual(cell, -1);
    assert.equal(d.tags[cell], BLOCKED);
    assert.ok((mesh.adj[cell] ?? []).some((n) => d.tags[n] !== BLOCKED));
    assert.ok(isFrontierWall(mesh, d, cell));
  });

  test('an open cell is not a frontier wall', () => {
    assert.equal(isFrontierWall(mesh, d, d.heart), false);
  });

  test('a wall with no open neighbour is not a frontier wall', () => {
    const buried = mesh.quads.findIndex(
      (_q, i) => d.tags[i] === BLOCKED && (mesh.adj[i] ?? []).every((n) => d.tags[n] === BLOCKED),
    );
    assert.ok(buried >= 0, 'fixture has no buried wall to test');
    assert.equal(isFrontierWall(mesh, d, buried), false);
  });

  test('the heart is close to high ground — the baseline tower stays effective', () => {
    const cell = nearestFrontierWall(mesh, d, d.heart);
    const a = mesh.centers[d.heart]!;
    const b = mesh.centers[cell]!;
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    assert.ok(chord < 0.25, `nearest high ground is ${chord.toFixed(3)} away, outside default tower.range`);
  });

  test('is deterministic across calls', () => {
    assert.equal(nearestFrontierWall(mesh, d, d.heart), nearestFrontierWall(mesh, d, d.heart));
  });

  test('a cell that is itself a frontier wall returns itself', () => {
    const cell = nearestFrontierWall(mesh, d, d.heart);
    assert.equal(nearestFrontierWall(mesh, d, cell), cell);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: `nearestFrontierWall is not exported`.

- [ ] **Step 3: Implement** — append to `src/core/sphere/dungeon.ts`:

```ts
/** A wall cell that borders open ground — the only kind a tower can use.
 *  The PoC's "beyond the frontier" rule: a wall buried inside a wall mass
 *  overlooks nothing and can shoot nothing. With ~73% of this board BLOCKED,
 *  most wall cells are buried, so without this most legal placements would be
 *  useless. */
export function isFrontierWall(mesh: SphereMesh, d: Dungeon, cell: number): boolean {
  if (d.tags[cell] !== BLOCKED) return false;
  return (mesh.adj[cell] ?? []).some((n) => d.tags[n] !== BLOCKED);
}

/** Nearest frontier wall to `from`, by BFS over the cell graph. Ties break by
 *  lowest cell index so the result is deterministic — a tower baseline that
 *  moved between runs would make every telemetry comparison noise.
 *  Returns -1 if the board has no frontier wall at all. */
export function nearestFrontierWall(mesh: SphereMesh, d: Dungeon, from: number): number {
  if (isFrontierWall(mesh, d, from)) return from;
  const seen = new Set<number>([from]);
  let frontier = [from];
  while (frontier.length > 0) {
    const next: number[] = [];
    let best = -1;
    for (const cell of frontier) {
      for (const n of mesh.adj[cell] ?? []) {
        if (seen.has(n)) continue;
        seen.add(n);
        if (isFrontierWall(mesh, d, n)) {
          if (best === -1 || n < best) best = n;
        } else {
          next.push(n);
        }
      }
    }
    if (best !== -1) return best;
    frontier = next;
  }
  return -1;
}
```

- [ ] **Step 4: Run to verify PASS**, then `npm run typecheck && npm test`.

- [ ] **Step 5: Commit**

```bash
git add src/core/sphere/dungeon.ts src/core/sphere/dungeon.test.ts
git commit -F - <<'EOF'
feat(sphere): nearestFrontierWall — where a tower may stand

A frontier wall is a BLOCKED cell bordering open ground. The PoC's "beyond
the frontier" rule exists because a wall buried in a wall mass overlooks
nothing and can shoot nothing — and with ~73% of this board BLOCKED, most
wall cells are buried, so without the rule most legal placements would be
useless.

BFS ties break by lowest cell index. A baseline tower that moved between
runs would turn every telemetry comparison into noise.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 3: Placement flips to high ground

**Files:**
- Modify: `src/core/sim/world.ts` (`placeTower`)
- Modify: `src/core/sim/runner.ts` (`towers: 'heart'`)
- Modify: `src/core/liveness.test.ts` (`runWith`)
- Test: `src/core/sim/world.test.ts`

**Background:** this reverts the M0b closeout's bad spec edit. Towers go on **high ground only**. The PoC's rationale is load-bearing and belongs in the code: *walls carry no enemy pathing, so a tower can never dam a lane* — which is why no connectivity guard is needed. Placing on open cells reintroduces exactly that problem.

**The baseline break:** `liveness.test.ts` and `runner.ts` place their baseline tower on `dungeon.heart`, an open cell. It moves to `nearestFrontierWall(...)`. This shifts every telemetry baseline — the tower covers different lanes, kills different critters, and because all critters share one RNG stream, every later envelope draw shifts too. Deliberate and taken now, when it is cheaper than after tuning.

- [ ] **Step 1: Write the failing test** — append to `src/core/sim/world.test.ts`:

```ts
describe('tower placement — high ground only', () => {
  const t = makeTuning();
  const w = makeWorld({ seed: 42, tuning: t });

  test('a frontier wall cell is accepted', () => {
    const cell = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart);
    assert.equal(w.placeTower(cell), true);
  });

  test('an open cell is REFUSED — towers build on high ground', () => {
    assert.equal(w.placeTower(w.dungeon.heart), false, 'the heart is open ground');
  });

  test('a buried wall cell is refused — it overlooks nothing', () => {
    const buried = w.mesh.quads.findIndex(
      (_q, i) => w.dungeon.tags[i] === BLOCKED
        && (w.mesh.adj[i] ?? []).every((n) => w.dungeon.tags[n] === BLOCKED),
    );
    assert.ok(buried >= 0, 'fixture has no buried wall');
    assert.equal(w.placeTower(buried), false);
  });

  test('an occupied cell is refused and counts no decision', () => {
    const cell = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.spawn);
    assert.equal(w.placeTower(cell), true);
    const before = w.telemetry.data.decisionsTotal;
    assert.equal(w.placeTower(cell), false);
    assert.equal(w.telemetry.data.decisionsTotal, before, 'a refusal counted a decision');
  });
});
```

Add to that file's imports: `import { nearestFrontierWall } from '../sphere/dungeon.ts';` and `BLOCKED` if not already present.

- [ ] **Step 2: Run to verify it fails** — the open-cell case will pass placement today.

- [ ] **Step 3: Implement.** In `src/core/sim/world.ts`, replace the body of `placeTower` and its doc comment:

```ts
  /** Place a tower on HIGH GROUND: a BLOCKED cell that borders open ground.
   *  Returns false for open cells, buried walls, and occupied cells.
   *  Counts a decision only on success.
   *
   *  Why walls and not open floor (PoC td-tab.js:2966): "towers build on the
   *  HIGH GROUND only... No connectivity guard needed: walls never carry enemy
   *  pathing, so a tower can never dam a lane." Placing on open cells would
   *  let a player seal a route and would require a connectivity check on every
   *  placement. M0b briefly allowed open cells; that was a mistake made
   *  because M0b had not built walls yet. */
  function placeTower(cell: number): boolean {
    if (!isFrontierWall(mesh, dungeon, cell)) return false;
    if (towers.some((t) => t.cell === cell)) return false;

    const pos: Vec3 = mesh.centers[cell] ?? [0, 1, 0];
    const tower = makeTower(nextTowerId++, cell, pos);
    towers.push(tower);
    telemetry.decision();
    return true;
  }
```

Update the import line in `world.ts` from
`import { generateDungeon, BLOCKED } from '../sphere/dungeon.ts';` to
`import { generateDungeon, BLOCKED, isFrontierWall } from '../sphere/dungeon.ts';`
and mirror the doc change on the `World` type's `placeTower` member.

- [ ] **Step 4: Move the baseline in `runner.ts`.** Change the towers block:

```ts
  const towers = spec.towers ?? 'heart';
  if (towers === 'heart') {
    // 'heart' now means "the high ground nearest the heart" — towers cannot
    // stand on open floor (see world.placeTower). The name still describes the
    // intent (defend the heart); renaming it would churn the sweep script, the
    // compare worker and their tests for nothing.
    const cell = nearestFrontierWall(world.mesh, world.dungeon, world.dungeon.heart);
    if (cell !== -1) world.placeTower(cell);
  } else if (towers !== 'none') {
    for (const cell of towers) world.placeTower(cell);
  }
```

Add `import { nearestFrontierWall } from '../sphere/dungeon.ts';` to `runner.ts`.

- [ ] **Step 5: Move the baseline in `liveness.test.ts`.** Replace
`w.placeTower(w.dungeon.heart);` with:

```ts
  // Towers stand on high ground only; the heart itself is open floor.
  w.placeTower(nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart));
```

and add the import.

- [ ] **Step 6: Run the full suite**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`
Expected: `fail 0`. **Liveness must still pass** — if a lever now reads dead, that is a finding, not a licence to add an exclusion (CLAUDE.md). Investigate before proceeding.

- [ ] **Step 7: Record the new baseline**

Run: `npm run sweep -- enemy.speed 0.6 2.0 3`
Capture the `survivedFor` column. These numbers replace M0a/M0b's; note them for `docs/05-M0c-notes.md` (Task 6).

- [ ] **Step 8: Commit**

```bash
git add src/core/sim/world.ts src/core/sim/runner.ts src/core/liveness.test.ts src/core/sim/world.test.ts
git commit -F - <<'EOF'
feat(sim): towers build on high ground only

Reverts the M0b closeout's spec edit. I had changed spec §7 from "wall
cells" to "open cells", arguing a BLOCKED cell was unreachable and
unpickable — both true only because M0b never built walls. That corrected
the spec to match a gap in the implementation rather than the design.

The PoC's rationale is the load-bearing part and is now in the code: walls
carry no enemy pathing, so a tower on one can never dam a lane, which is why
no connectivity guard is needed. Open-cell placement would reintroduce
exactly that problem.

Buried walls are refused too. With ~73% of this board BLOCKED, most wall
cells have no open neighbour and would overlook nothing.

THIS SHIFTS EVERY TELEMETRY BASELINE. The baseline tower in liveness.test.ts
and runner.ts moves from the heart to the high ground nearest it, so it
covers different lanes and kills different critters — and since all critters
share one RNG stream, every later envelope draw shifts with it. M0a and M0b
sweep numbers are no longer comparable to anything measured after this.
Taken deliberately and now, because it is strictly cheaper before tuning has
been done against those numbers than after.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 4: The two tank bugs

**Files:**
- Modify: `src/core/sim/tank.ts`
- Test: `src/core/sim/tank.test.ts` (create if absent)

**Background:**

**Turn is inverted.** `stepTank` rotates the heading around the **outward** surface normal by `+turn * π * dt`. A positive rotation about an outward normal is counter-clockwise seen from outside — a **left** turn. So `D`/right steers left. Verified numerically: tank at `[0,0,1]` heading `[1,0,0]`, `turn=+1` for 0.25 s gives `[0.707, 0.707, 0]` — rotated toward `+Y`, counter-clockwise on screen.

**Turning does not count as acting.** `const acting = Math.abs(input.forward) > 0 || input.fire;` — a tank pivoting to bring guns to bear while enemies are alive is recorded as **idle**, inflating `tankIdleUnderThreat`. That is the specific metric vision §8 names for detecting "the tank existing but having nothing to do", and it currently lies in the one direction that matters.

- [ ] **Step 1: Write the failing test** — create `src/core/sim/tank.test.ts`:

```ts
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTank, stepTank } from './tank.ts';
import { makeTuning } from '../tuning/store.ts';

describe('tank steering', () => {
  // Tank at the +Z pole heading +X. Seen from outside (camera on +Z looking at
  // the origin) screen-right is +X and screen-up is +Y. A RIGHT turn must
  // therefore rotate the heading toward -Y: clockwise on screen.
  function turned(turn: number): readonly [number, number, number] {
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    stepTank(tank, 0.25, { forward: 0, turn, fire: false }, [], makeTuning());
    return tank.heading;
  }

  test('right turns RIGHT (clockwise seen from outside)', () => {
    const h = turned(1);
    assert.ok(h[1] < -0.5, `right turn produced heading ${JSON.stringify(h)} — rotated toward +Y, i.e. left`);
  });

  test('left turns LEFT', () => {
    const h = turned(-1);
    assert.ok(h[1] > 0.5, `left turn produced heading ${JSON.stringify(h)}`);
  });

  test('turning stays on the tangent plane', () => {
    const h = turned(1);
    assert.ok(Math.abs(h[2]) < 1e-9, 'heading left the tangent plane at the +Z pole');
    assert.ok(Math.abs(Math.hypot(h[0], h[1], h[2]) - 1) < 1e-9, 'heading is not unit length');
  });
});

describe('tank acting — feeds tankIdleUnderThreat', () => {
  function acting(input: { forward: number; turn: number; fire: boolean }): boolean {
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    return stepTank(tank, 1 / 60, input, [], makeTuning()).acting;
  }

  test('turning counts as acting', () => {
    assert.equal(
      acting({ forward: 0, turn: 1, fire: false }), true,
      'a tank pivoting to bring guns to bear was recorded as idle',
    );
  });

  test('driving and firing count as acting', () => {
    assert.equal(acting({ forward: 1, turn: 0, fire: false }), true);
    assert.equal(acting({ forward: 0, turn: 0, fire: true }), true);
  });

  test('a completely idle tank is idle', () => {
    assert.equal(acting({ forward: 0, turn: 0, fire: false }), false);
  });
});
```

- [ ] **Step 2: Run to verify it fails.** Expected: FAIL on `right turns RIGHT` and `turning counts as acting`.

- [ ] **Step 3: Fix both.** In `src/core/sim/tank.ts`:

```ts
  // ── Turn: rotate heading around surface normal (pos for unit sphere) ───────
  if (input.turn !== 0) {
    const normal: Vec3 = normalize(tank.pos); // surface normal = pos on unit sphere
    // NEGATED: a positive rotation about an OUTWARD normal is counter-clockwise
    // seen from outside, i.e. a LEFT turn. Without this, pressing right steers
    // left. Pinned by a numeric case in tank.test.ts rather than by argument.
    const turnAmount = -input.turn * Math.PI * dt; // radians
    tank.heading = rodriguezRotate(tank.heading, normal, turnAmount);
  }
```

and:

```ts
  // Turning counts. A tank pivoting to bring its guns to bear while enemies are
  // alive is not idle, and tankIdleUnderThreat is the metric vision §8 names
  // for spotting a tank with nothing to do — it must not lie in that direction.
  const acting = Math.abs(input.forward) > 0 || Math.abs(input.turn) > 0 || input.fire;
```

- [ ] **Step 4: Run to verify PASS**, then `npm run typecheck && npm test`.

- [ ] **Step 5: Sabotage the fix.** Remove the `-` from `turnAmount` and confirm
`right turns RIGHT` fails with the actual heading printed. Restore; confirm PASS.

- [ ] **Step 6: Commit**

```bash
git add src/core/sim/tank.ts src/core/sim/tank.test.ts
git commit -F - <<'EOF'
fix(tank): steering was inverted, and turning counted as idle

Reported from playing M0b: "the turn left/right seem inverted". It was. A
positive rotation about an OUTWARD surface normal is counter-clockwise seen
from outside — a left turn — so pressing right steered left. The test pins
the handedness with a numeric case (tank at the +Z pole heading +X, right
turn must rotate toward -Y) rather than with an argument about winding,
because that is exactly the kind of reasoning that produced the bug.

Second, quieter bug: `acting` excluded turning, so a tank pivoting to bring
its guns to bear while enemies were alive was recorded as idle. That
inflates tankIdleUnderThreat, which vision §8 names as the metric for
spotting a tank with nothing to do — it was lying in the one direction that
matters.

Both shift the telemetry baseline, on top of the tower move.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 5: Render the walls

**Files:**
- Modify: `src/render/board.ts`
- Modify: `src/render/units.ts`

**Background:** `board.ts` shrinks to uploading `buildBoardGeometry`'s arrays. `cellFromFaceIndex` now reads the geometry's `faceCell` table, which already covers floor, wall tops and skirts — so clicking a wall's visible **side** selects that wall, which matters because from a raked or chase camera the skirts are most of what you can see. Towers must clear `WALL_HEIGHT` since they now stand on wall tops.

- [ ] **Step 1: Rewrite `board.ts` to consume the pure geometry**

```ts
// board.ts — uploads the board's geometry and owns picking.
//
// The extrusion itself is pure and Node-tested in render/geometry.ts; this file
// is the thin three.js half. The edge overlay stays opted out of raycasting —
// it sits fractionally in front of the surface, so a recursive raycast hits it
// first and returns an intersection with no faceIndex, silently swallowing
// every tower placement (the M0b bug).

import * as THREE from 'three';
import type { SphereMesh } from '../core/sphere/grid.ts';
import type { Dungeon } from '../core/sphere/dungeon.ts';
import { buildBoardGeometry, WALL_HEIGHT } from './geometry.ts';

export { WALL_HEIGHT };

const COLOR_EDGE = new THREE.Color(0x0a0f1a);

let faceToCell: Int32Array = new Int32Array(0);

export function cellFromFaceIndex(faceIndex: number): number {
  return faceToCell[faceIndex] ?? -1;
}

export function makeBoard(mesh: SphereMesh, dungeon: Dungeon): THREE.Group {
  const built = buildBoardGeometry(mesh, dungeon);
  faceToCell = built.faceCell;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(built.colors, 3));
  geo.computeVertexNormals();

  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
  );
  surface.name = 'board-surface';

  const group = new THREE.Group();
  group.name = 'board';
  group.add(surface);
  group.add(makeEdges(mesh, dungeon));
  return group;
}

/** Cell outlines on the walkable floor only. Outlining wall tops as well turns
 *  a board that is ~73% wall into a wireframe and buries the corridors, which
 *  are the part you actually need to read. */
function makeEdges(mesh: SphereMesh, dungeon: Dungeon): THREE.LineSegments {
  const seen = new Set<number>();
  const pts: number[] = [];
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined) continue;
    if (dungeon.tags[cell] === 0 /* BLOCKED */) continue;
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
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLOR_EDGE }));
  lines.name = 'board-edges';
  lines.raycast = () => {};
  return lines;
}
```

- [ ] **Step 2: Lift towers onto the wall tops** — in `src/render/units.ts`:

Add the import: `import { WALL_HEIGHT } from './geometry.ts';`

Replace the towers block in `sync`:

```ts
    towers.begin();
    for (const t of world.towers) {
      // Towers stand on high ground: clear the wall's roof, not the floor.
      towers.add(liftFrom(t.pos, 1 + WALL_HEIGHT, TOWER_SCALE), TOWER_SCALE, basisAt(normalOf(t.pos), [0, 1, 0]), 1);
    }
    towers.end();
```

Replace the `lift` helper with a base-radius-aware pair:

```ts
/** Push a model off a surface at `base` radius by roughly its own radius, so it
 *  sits ON that surface rather than half-buried in it. */
function liftFrom(p: Vec3, base: number, scale: number): Vec3 {
  const l = Math.hypot(p[0], p[1], p[2]) || 1;
  const k = (base + scale * 0.9) / l;
  return [p[0] * k, p[1] * k, p[2] * k];
}

/** Floor-standing units: critters, the tank, the heart. */
function lift(p: Vec3, scale: number): Vec3 {
  return liftFrom(p, 1, scale);
}
```

- [ ] **Step 3: Typecheck and look at it**

Run: `npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)"`

Run: `npm run dev` and open **http://localhost:5144/**
Expected: the board reads as a maze — walls standing proud of carved corridors and rooms. Check all five camera modes (`Tab` for family, `C` to cycle). Towers sit on wall tops, not floating or sunk. Clicking a wall's side face places a tower on that wall; clicking open floor refuses.

- [ ] **Step 4: Judge `wallHeight` by eye.** The spec flags this as a risk: at 73% BLOCKED the board may read as too solid from a high camera. If corridors are buried, `WALL_HEIGHT` is one constant in `geometry.ts` — adjust and re-look. Record what you chose and why.

- [ ] **Step 5: Commit**

```bash
./scripts/bust.sh --quiet
git add src/render/board.ts src/render/units.ts index.html
git commit -F - <<'EOF'
feat(render): the board gains its third dimension

board.ts shrinks to uploading arrays; the extrusion is pure and tested in
render/geometry.ts. Picking now covers wall skirts, so clicking the visible
side of a wall selects that wall — which is the common case, because from a
raked or chase camera the tops are foreshortened and the skirts are most of
what you can see.

Cell outlines are drawn on walkable floor only. Outlining wall tops as well
turns a board that is ~73% wall into a wireframe and buries the corridors,
which are the part you actually need to read.

Towers lift from the wall roof rather than the floor, so they stand on the
high ground they are now required to occupy.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
```

---

### Task 6: Docs and acceptance

**Files:**
- Modify: `docs/01-M0-tuning-rig-spec.md` §7
- Create: `docs/05-M0c-notes.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Revert spec §7.** It currently carries the M0b "correction". Replace that bullet with:

```markdown
- **Tower:** one type, placed on **wall cells (high ground)** that border open
  ground, nearest-target. Towers never stand on open floor.
  *(M0b briefly changed this to "open cells" on the reasoning that a BLOCKED
  cell was unpickable and unreachable — both true only because M0b had not yet
  built walls. M0c-1 restores it. The rationale, from the PoC: walls carry no
  enemy pathing, so a tower on one can never dam a lane, which is why placement
  needs no connectivity guard.)*
```

- [ ] **Step 2: Write `docs/05-M0c-notes.md`.** Required sections, following the shape of `docs/02-M0a-brain-notes.md`:
  - **The baseline break** — the new `survivedFor` numbers from Task 3 Step 7, stated as replacing M0a/M0b's, with the reason.
  - **What the build revealed that the spec got wrong** — the honest section. Do not write "nothing" without having looked.
  - **`wallHeight` as chosen** — the value that survived Task 5 Step 4 and what it looked like at the alternatives.
  - **Triangle budget** — floor/wallTop/skirt counts from `buildBoardGeometry().counts`, and what the skirt filter saved versus skirting every wall edge.
  - **Still missing for PoC parity** — chunks 2 and 3, so the next session knows where it is.

- [ ] **Step 3: Update `CLAUDE.md`** — State section: M0c-1 done, chunks 2–3 next; and in the known-state note, replace the tuning numbers with the new baseline and say plainly that pre-M0c numbers are void.

- [ ] **Step 4: Full gate**

```bash
npm run typecheck && npm test 2>&1 | grep -E "^. (tests|pass|fail)" && ./scripts/verify-determinism.sh
```
Expected: `fail 0`, determinism PASS.

- [ ] **Step 5: Commit and push**

```bash
./scripts/bust.sh --quiet
git add docs/ CLAUDE.md index.html
git commit -F - <<'EOF'
docs: M0c-1 closeout — walls, high ground, and a void baseline

Restores spec §7 to "wall cells" and records why, so the correction is not
made a third time.

Records the new telemetry baseline and states plainly that M0a and M0b
numbers are void: the tower moved onto high ground and the tank's `acting`
flag changed, so nothing measured before this is comparable.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
EOF
git push
```

---

## Self-Review

**Spec coverage.** §1 correction → Task 3 + Task 6. §2 board geometry → Task 1. §2.1 pure function → Task 1. §2.2 picking → Task 5. §3 placement rule → Tasks 2, 3. §4 baseline break → Task 3 (steps 4–7) + Task 6. §5 tank bugs → Task 4. §6 towers on walls → Task 5 step 2. §7 testing → Tasks 1–4, including the extended architecture guard in Task 1 step 6 and both sabotage passes. §8 acceptance → Task 5 step 3 and Task 6 step 4. §9 out-of-scope items appear in no task, correctly. §10 risks → Task 5 step 4 (wallHeight by eye), Task 6 step 2 (triangle budget).

**Placeholder scan:** none. Task 6's notes are recorded observations, which cannot be pre-written; the required sections and their sources are named explicitly.

**Type consistency:** `BoardGeometry`/`WALL_HEIGHT` (Task 1) are consumed unchanged by Task 5. `isFrontierWall`/`nearestFrontierWall` (Task 2) are consumed by Task 3 in `world.ts`, `runner.ts` and `liveness.test.ts` with matching signatures. `liftFrom`/`lift` (Task 5) replace M0b's single `lift` at every call site in `units.ts`.

**One gap found and closed:** Task 1's sketch emits floor and wall triangles in a single interleaved loop, but the tests index triangles by grouped surface ranges. The implementer note after Step 3 makes the two-pass emit order explicit rather than leaving it to be discovered by a failing test.
