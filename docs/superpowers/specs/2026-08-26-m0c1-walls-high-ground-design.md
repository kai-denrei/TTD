# M0c-1 — Walls & High Ground · design

**Status:** approved 2026-08-26. Parent: `docs/00-TTD-vision.md`, `docs/01-M0-tuning-rig-spec.md` §7.
**Predecessor:** M0b (the rig made visible) — complete, 239 tests.
**Part of:** M0c — PoC parity, chunk 1 of 3.

> M0b made the simulation visible. It did not make it a game. This chunk gives
> the board its third dimension and puts towers where they belong.

---

## 0. Why this milestone exists

The operator's report after using M0b: *"currently there is no gameplay as far
as I can tell, towers don't fire or it's hard to tell, the green unit is
supposed to be the tank? but its turn left/right seem inverted. we need to
recreate something closer to the PoC before we can even start tweaking
anything."*

That is correct, and it reframes the work. An earlier plan to add an economy and
a win condition was premature: **you cannot balance what you cannot see or
steer.** PoC parity comes first.

The gap, measured against `~/Dev/spherical-stalberg-grid`:

| | PoC | TTD M0b |
|---|---|---|
| Board | BLOCKED cells **extruded** — floor, wall tops, skirts (`td-tab.js:600`) | flat coloured sphere |
| Tower fire | `spawnTowerShot` (homing, arced) · `makeTracer` · `spawnBeam` | instant damage, **no visuals at all** |
| Tank | aimed fire, twin lasers with heat + lockout | omnidirectional, ignores its barrel, **turn inverted** |
| Towers | typed roster, cost, sell, upgrade, range rings | one type, free, unlimited |
| Economy | `economy.js` | none |

**M0c is three chunks.** This spec covers chunk 1 only:

1. **Walls & high ground** (this document) — the board's third dimension,
   towers onto wall tops, the two tank bugs.
2. **Combat made visible** — tower shots, tracers, beams, muzzle flashes, hit
   flashes, death bursts; tank aimed fire.
3. **Tower roster & economy** — 3–4 types with distinct attacks, cost, sell,
   upgrade, range rings.

Walls come first because they change *where towers sit*, and therefore where
every projectile in chunk 2 originates. Building shots first means rebuilding
them after.

---

## 1. A correction this milestone makes

The M0b closeout "corrected" spec §7 from *"towers placed on wall cells"* to
*"open (non-BLOCKED) cells"*, arguing that a tower on a BLOCKED cell would be
unreachable by the nav graph and unpickable by the raycast.

**That reasoning was wrong, and the spec was right.** Both claims were true only
because M0b never built walls — the correction adjusted the spec to match a gap
in the implementation rather than to match the design. In the PoC, BLOCKED cells
are extruded geometry with pickable roofs, and towers mount on them
(`td-tab.js:2966`):

> *"HT rule: towers build on the HIGH GROUND only — real wall cells (in the
> un-sealed world) that border the open sector. Low ground belongs to monsters
> and the player. No connectivity guard needed: walls never carry enemy pathing,
> so a tower can never dam a lane."*

That last clause is the load-bearing part: **because walls carry no pathing, a
tower can never seal a route**, which is why the PoC needs no connectivity check
on placement. Placing on open cells would reintroduce exactly that problem.

Spec §7 is reverted to "wall cells" with this rationale attached, so the
correction is not made a third time.

---

## 2. Board geometry

Three surfaces built from one cell graph:

| Surface | Cells | Radius |
|---|---|---|
| **floor** | open (PATH, ROOM) | `1` |
| **wall top** | BLOCKED | `1 + wallHeight` |
| **skirt** | the vertical face on each BLOCKED↔open edge | spans `1` → `1 + wallHeight` |

`wallHeight = 0.03` — the PoC's value (`td-tab.js:47`). On TTD's mesh the mean
chord is 0.068, so a wall stands ≈0.44 of a cell wide: tall enough to read as
relief, short enough that a tank never loses sight of the board.

**Only BLOCKED↔open edges get skirts.** An edge between two BLOCKED cells is
interior to a wall mass and its skirt would be invisible geometry inside solid
rock. On this board that matters: **~73% of cells are BLOCKED** (measured:
1904–2019 of ~2670 across seeds 7/42/43/44), so naive skirting would emit
several times the necessary triangles.

**Colour.** Floor keeps the current PATH/ROOM tag colours. Wall tops take a
distinct darker tone, and skirts a darker tone still, so the relief reads
without lighting — the board uses `MeshBasicMaterial`, so shading has to come
from authored colour, not from a light.

### 2.1 The extrusion is a pure function

```ts
// src/render/geometry.ts — imports nothing from three
export type BoardGeometry = {
  positions: Float32Array;   // xyz per vertex, non-indexed
  colors: Float32Array;      // rgb per vertex
  faceCell: Int32Array;      // triangle index -> source cell
  counts: { floor: number; wallTop: number; skirt: number };  // triangles per surface
};
export function buildBoardGeometry(
  mesh: SphereMesh, dungeon: Dungeon, opts: { wallHeight: number },
): BoardGeometry;
```

`board.ts` shrinks to uploading these arrays into a `BufferGeometry`.

**Why pure matters here specifically:** skirt classification is exactly the kind
of logic that goes silently wrong — a skirt emitted on the wrong edge, wound
backwards so it is invisible from outside, or a `faceCell` entry off by one that
makes clicking a wall select its neighbour. None of those look obviously broken
on screen, and M0b already shipped one bug of precisely that shape (the edge
overlay swallowing every tower placement). Node tests catch them; eyeballing a
sphere does not.

Non-indexed, consistent with M0b: vertices are shared between adjacent quads, so
per-vertex colour would bleed one cell's tag into its neighbours.

### 2.2 Picking

Raycast targets the floor and wall meshes, as the PoC does
(`td-tab.js:3441`: `raycaster.intersectObjects([wallMesh, floorMesh], false)`).
The edge overlay stays opted out of raycasting (M0b fix).

A **skirt maps to its own wall cell**, so clicking the visible side of a wall
selects that wall rather than the floor behind it. This is the common case from a
raked or chase camera, where wall tops are foreshortened and skirts are most of
what you can see.

---

## 3. Placement rule

`world.placeTower(cell)` accepts a cell only when **all** hold:

1. `dungeon.tags[cell] === BLOCKED` — high ground only.
2. At least one neighbour is open — the PoC's *"beyond the frontier"* rule. A
   wall buried inside a wall mass overlooks nothing and can shoot nothing; with
   73% of the board BLOCKED, most wall cells are exactly that, so without this
   rule most legal placements would be useless.
3. No tower already on that cell.

Unchanged: placement counts a telemetry decision **only on success**.

New pure helper, needed by both the runner and the tests:

```ts
// src/core/sphere/dungeon.ts
/** Nearest BLOCKED cell to `from` that borders at least one open cell.
 *  BFS over mesh.adj; ties broken by lowest cell index so it is deterministic.
 *  Returns -1 if the board has no frontier wall (degenerate seeds). */
export function nearestFrontierWall(mesh: SphereMesh, dungeon: Dungeon, from: number): number;
```

Measured across seeds 7/42/43/44: the nearest frontier wall to the heart is
**1 hop away**, chord 0.057–0.070 — comfortably inside the default `tower.range`
of 0.25. The baseline tower moves about one cell and stays effective.

---

## 4. The baseline break (a real, accepted cost)

`liveness.test.ts` and `runner.ts` both place their baseline tower on
`dungeon.heart`, an open cell. Under the new rule that becomes
`nearestFrontierWall(mesh, dungeon, dungeon.heart)`.

**This shifts every telemetry baseline.** M0a and M0b sweep numbers stop being
comparable to anything measured afterwards: the tower sits on a different cell,
so it covers a different set of approach lanes and kills a different set of
critters, which — because all critters share one RNG stream — shifts every
subsequent envelope draw.

Taken deliberately, and now rather than later, because it is strictly cheaper
before any tuning has been done against those numbers than after. Recorded in
`docs/05-M0c-notes.md` and in `CLAUDE.md`'s known-state note.

`runner.ts`'s `towers: 'heart'` keeps its name but changes meaning to "the
frontier wall cell nearest the heart". The name still describes the intent —
*defend the heart* — and renaming it would churn the sweep script, the compare
worker and their tests for no gain. The meaning change is documented at the type.

---

## 5. Two tank bugs

### 5.1 Turn is inverted

`stepTank` rotates the heading around the outward surface normal by
`+input.turn * π * dt`. A positive rotation about an **outward** normal is
counter-clockwise seen from outside — which is a **left** turn. So `D` / right
steers left.

Verified numerically rather than reasoned about: tank at `[0,0,1]` heading
`[1,0,0]`, `turn = +1` for 0.25 s yields heading `[0.707, 0.707, 0]` — rotated
toward `+Y`, counter-clockwise on screen, i.e. left.

Fix: negate the rotation angle. Regression test asserts the empirical case
above, so the handedness is pinned by a number rather than by an argument.

### 5.2 Turning does not count as acting

```ts
const acting = Math.abs(input.forward) > 0 || input.fire;   // turn missing
```

A tank pivoting to bring its guns to bear while enemies are alive is recorded as
**idle**, inflating `tankIdleUnderThreat` — the specific metric vision §8 names
as detecting "the tank existing but having nothing to do". The metric currently
lies in the one direction that matters.

Fix: include `Math.abs(input.turn) > 0`. This also shifts the baseline (§4);
same one-time break, same note.

---

## 6. Rendering towers on walls

`units.ts` currently lifts every unit off the surface by its own radius. A tower
on a wall must additionally clear `wallHeight`. The lift becomes a function of
what the unit stands on: towers on wall tops, critters and the tank on the floor.

The tower's model is `+Y`-up with `+X` along the barrel, so the existing
`basisAt(normal, heading)` continues to orient it; only the radial offset
changes.

---

## 7. Testing

**New, in `npm test`:**

- `render/geometry.test.ts` — pure, no three:
  - a skirt is emitted for every BLOCKED↔open edge and for **no** BLOCKED↔BLOCKED
    edge (the count is derived from the dungeon, not observed from a run)
  - wall-top vertices sit at radius `1 + wallHeight`; floor vertices at `1`;
    skirt vertices span exactly those two radii and nothing between
  - every triangle has a `faceCell` entry, and each entry names a cell whose tag
    matches the surface that emitted it
  - triangle winding is outward-facing on all three surfaces (a backwards skirt
    is invisible from outside and looks like a hole)
  - deterministic: two calls on one mesh produce identical arrays
- `core/sphere/dungeon.test.ts` — `nearestFrontierWall`:
  - returns a BLOCKED cell that borders at least one open cell
  - returns the nearest such cell, ties broken by lowest index
  - returns `-1` on a board with no frontier wall
- `core/sim/world.test.ts` — placement:
  - a frontier wall cell is accepted
  - an open cell is **refused** (the reverted rule, asserted directly)
  - a buried wall cell — BLOCKED with no open neighbour — is refused
  - an occupied cell is refused; a refusal counts no decision
- `core/sim/tank.test.ts` — the two bugs:
  - right turn rotates the heading clockwise as seen from outside, pinned by the
    numeric case in §5.1
  - `acting` is true when only turning

**Sabotage passes** (per CLAUDE.md): break the skirt edge-filter and confirm the
count test fails; restore the turn negation and confirm the handedness test
fails. A guard that passes against its own bug certifies the bug.

**One guard is extended.** `render/geometry.ts` is pure and Node-tested but
lives outside `core/`, so `architecture.test.ts` — which recurses over `core/`
only — would not cover it. M0b set the same precedent with `render/bindings.ts`
and left the purity as convention. Convention is what erodes.

`architecture.test.ts` gains a declared list of **pure render modules** and
asserts they import nothing from three. A module is on that list precisely
because its correctness is testable in Node, and importing three would silently
end that:

```ts
// modules under render/ that MUST stay three-free so they remain Node-testable
const PURE_RENDER = ['bindings.ts', 'geometry.ts'];
```

**Unchanged and still gating:** the rest of `architecture.test.ts`,
`liveness.test.ts`, replay determinism, `scripts/verify-determinism.sh`.

---

## 8. Acceptance

1. The board reads as a maze in 3D: walls stand proud of carved corridors and
   rooms, visible from every camera mode.
2. Towers place on wall tops only; open cells and buried walls are refused.
3. A tower sits visibly on top of a wall, not floating or sunk.
4. Clicking a wall's visible side face selects that wall.
5. `D` / right turns the tank right; `A` / left turns it left.
6. `tankIdleUnderThreat` stops counting a turning tank as idle.
7. `npm test` and `npm run typecheck` green; determinism PASS.
8. The baseline shift is recorded in `docs/05-M0c-notes.md` and `CLAUDE.md`.

---

## 9. Out of scope (and which chunk owns it)

- Tower shots, tracers, beams, muzzle flashes, hit flashes, death bursts — **chunk 2**
- Tank aimed fire along the barrel; laser heat and lockout — **chunk 2**
- Tower types, cost, sell, upgrade, range rings — **chunk 3**
- Economy and win condition — after chunk 3, once there is a game to balance
- Elevation as a *mechanic* (range bonus, line-of-sight blocking). High ground is
  spatial only: the simulation stays 2D-on-sphere, range stays surface chord.
  Both were considered and deferred — a range bonus makes every range comparison
  in the telemetry depend on geometry the sim ignores, and LOS needs a per-shot
  visibility test and would weaken an already-losing one-tower baseline.

---

## 10. Risks

- **The board may read as too solid.** At 73% BLOCKED, extruding could bury the
  corridors in rock from a high camera. *Mitigation:* `wallHeight` is one
  constant in one place; if it reads badly, it becomes a lever rather than a
  guess. Judged by eye at all five camera modes during acceptance.
- **Triangle count roughly triples.** Floor + wall tops + skirts against M0b's
  single surface. At ~2,670 cells that is still small, but it lands on a phone
  alongside the bloom chain. *Mitigation:* the skirt filter (§2) is what keeps it
  from being far worse; measured during acceptance rather than assumed.
- **The baseline break is irreversible in practice** (§4). Accepted, taken now.
