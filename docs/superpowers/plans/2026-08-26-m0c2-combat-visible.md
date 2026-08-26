# M0c-2 — Combat Made Visible · Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans or subagent-driven-development. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Make every combat event visible — tower shots that travel and can miss, hitscan tank lasers with heat and lockout, muzzle flashes, hit flashes and death bursts — by first giving the simulation a way to report what happened.

**Architecture:** A plain-data event buffer on `World`, cleared per tick and drained by the renderer. Projectiles become simulation entities in a new tick phase. Effects render from pooled buffers in `render/effects.ts`, following M0b's `points.ts` pattern.

**Tech Stack:** Vite 6 · TypeScript 5.7 · three 0.170 · `node --test`.

## Global Constraints

- **`src/core/` stays pure** — no three, no `Math.random`, no DOM, no wall-clock. `architecture.test.ts` enforces it.
- **`render/geometry.ts`, `render/bindings.ts` and `render/effects.ts` must stay three-free** where listed in `PURE_RENDER`; `effects.ts` DOES use three, so it is NOT added to that list — its pure helpers, if any, go in a separate module.
- `verbatimModuleSyntax` — type-only imports use `import type`. Relative imports end in `.ts`.
- `noUncheckedIndexedAccess` — guard or `!` variable-length indexing; `Vec3` tuples are exempt.
- `noUnusedLocals` / `noUnusedParameters` — unused import or param is a compile error.
- Dev server is **port 5144**; check with `curl localhost:5144` (vite binds IPv6, so a `127.0.0.1` probe falsely reports it down).
- `npm run typecheck` **and** `npm test` before every commit; `./scripts/bust.sh --quiet` after editing sources.
- Commit trailer:
  ```
  Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_017TsYtSYBUchM2TAbNFgQo1
  ```

## File Structure

| File | Responsibility |
|---|---|
| `src/core/sim/events.ts` | **new** · `WorldEvent` union + `makeEventBuffer` |
| `src/core/sim/events.test.ts` | **new** · per-tick clearing, drain semantics, bounded growth |
| `src/core/sim/projectiles.ts` | **new** · shots as entities: travel, home, collide, miss |
| `src/core/sim/projectiles.test.ts` | **new** · travel time, impact damage, misses, determinism |
| `src/core/sim/towers.ts` | **modify** · spawn shots instead of dealing damage |
| `src/core/sim/tank.ts` | **modify** · aimed fire within `fireArc`; heat + lockout |
| `src/core/sim/tank.test.ts` | **modify** · arc and heat tests |
| `src/core/sim/world.ts` | **modify** · new tick phase, event emission, header update |
| `src/core/tuning/schema.ts` | **modify** · six new levers |
| `src/render/effects.ts` | **new** · pooled tracers, beams, flashes, bursts |
| `src/render/bindings.ts` | **modify** · two `fx` render levers |
| `src/main.ts` | **modify** · drain events, sync effects |
| `docs/05-M0c-notes.md` | **modify** · chunk 2 findings |

---

### Task 1: The event feed

**Files:** create `src/core/sim/events.ts`, `src/core/sim/events.test.ts`; modify `src/core/sim/world.ts`.

**Interfaces produced:**
```ts
export type EventSource = 'tower' | 'tank';
export type WorldEvent =
  | { kind: 'shotFired'; at: Vec3; dir: Vec3; source: EventSource }
  | { kind: 'beam'; from: Vec3; to: Vec3 }
  | { kind: 'impact'; at: Vec3; damage: number; source: EventSource }
  | { kind: 'critterDied'; at: Vec3; by: EventSource }
  | { kind: 'heartHit'; at: Vec3 }
  | { kind: 'tankHit'; at: Vec3 };
export type EventBuffer = {
  emit(e: WorldEvent): void;
  drain(): WorldEvent[];
  clear(): void;
  readonly length: number;
};
export function makeEventBuffer(capacity?: number): EventBuffer;  // default 512
```

**Background:** this is the root cause of "towers don't fire". The world resolves damage and discards it. The buffer is **cleared at the start of each tick, not on drain** — a headless sweep has no renderer, and 6,000 ticks of accumulated impacts would be an unbounded allocation in the one path that must stay cheap. Capacity is a hard ceiling that drops overflow rather than growing, for the same reason `points.ts` caps its pools.

Events carry **positions, not entity references**: a critter that died this tick is pruned before the renderer looks.

- [ ] Write `events.test.ts` asserting: emit then drain returns the events and empties; `clear()` empties; emitting past capacity drops rather than grows (`length` never exceeds capacity); `drain()` on an empty buffer returns `[]`.
- [ ] Run it — expect module-not-found.
- [ ] Implement `events.ts`.
- [ ] Run — expect pass.
- [ ] Wire into `world.ts`: construct a buffer, `events.clear()` as the **first** statement of `tick()` (before `dt` scaling), expose `drainEvents()`. Emit `heartHit` and `tankHit` at their existing sites.
- [ ] Add a test asserting a 3,000-tick headless run leaves `drainEvents().length` bounded by capacity — the leak this design exists to prevent.
- [ ] `npm run typecheck && npm test`; commit.

---

### Task 2: Projectiles as entities

**Files:** create `src/core/sim/projectiles.ts`, `.test.ts`; modify `towers.ts`, `world.ts`, `schema.ts`.

**Interfaces produced:**
```ts
export type Projectile = {
  id: number; pos: Vec3; dir: Vec3; travelled: number;
  range: number; speed: number; damage: number;
  source: EventSource; homingId: number | null;
};
export type ProjectileHit = { critterId: number; damage: number; source: EventSource; at: Vec3 };
export function makeProjectile(id: number, opts: {...}): Projectile;
export function stepProjectiles(
  ps: Projectile[], critters: Critter[], dt: number, tuning: TuningStore,
): { hits: ProjectileHit[]; expired: number[] };
```

**Background:** the PoC (`td-tab.js:3166`) moves each shot along the surface, re-steers homing shots toward their living target with a **0.75 old / 0.25 new** blend, and kills a shot when `travelled > range` **hit or not** — shots miss. Movement re-orthogonalises `dir` against the surface normal each step, exactly as `stepTank` does, or the shot leaves the sphere.

`stepTowers` stops returning damage and starts returning spawn requests. Collision radius reuses the tank's `0.4 × mean chord` convention so contact scales with the mesh rather than being a second magic number.

**New lever:** `tower.projSpeed` (0.3–4.0, default 1.2, group `player`).

- [ ] Write `projectiles.test.ts`: a shot advances `speed * dt` per step; **damage lands on impact, not at spawn** (assert no hit on the spawn tick when the target is beyond one step); a shot exceeding `range` appears in `expired` with no hit; a homing shot whose target is dead continues on its last heading and does not throw; two identical runs give identical positions.
- [ ] Run — expect module-not-found.
- [ ] Implement `projectiles.ts`.
- [ ] Change `stepTowers` to return `TowerShotRequest[]` (`{ towerId, from, dir, targetId }`) instead of damage events; update its callers.
- [ ] Rewrite `world.ts` tick phases to:
  `5 towers → spawn`, `6 tank`, `7 projectiles → hits`, `8 resolve damage`, `9 telemetry`, `10 prune critters + expired projectiles`.
  **Update the load-bearing header comment in the same edit** — it states that reordering invalidates saved-preset comparability, so it must not lag the change.
- [ ] Emit `shotFired` on spawn and `impact` on hit; emit `critterDied` where kills are counted.
- [ ] Add `tower.projSpeed` to `schema.ts`.
- [ ] Run the full suite. **If a lever goes dead in liveness, investigate — never add an exclusion.**
- [ ] Sabotage: make `stepProjectiles` apply damage at spawn; confirm the travel-time test fails; restore.
- [ ] `npm run typecheck && npm test`; commit.

---

### Task 3: Tank aimed fire, heat and lockout

**Files:** modify `tank.ts`, `tank.test.ts`, `schema.ts`, `world.ts`.

**Background:** `stepTank` currently picks the nearest critter **in any direction** — the barrel is decoration, which is why steering felt pointless. Fire now requires the target within `tank.fireArc` of the heading (dot product against the tangent heading). The PoC's twin lasers run `LASER_MAX_HEAT 2.4` s of continuous fire before lockout and `LASER_COOL 1.4` per second. Firing adds heat; at max the guns cut out until cooled — you cannot hold the trigger, so tank DPS is spent rather than constant.

The tank stays **hitscan**: it emits a `beam` event, not a projectile.

**New levers:** `tank.fireArc` (10–180°, default 45), `tank.heatMax` (0.5–6.0 s, default 2.4), `tank.coolRate` (0.2–4.0/s, default 1.4), all group `player`. `Tank` gains `heat: number` and `lockedOut: boolean`.

- [ ] Extend `tank.test.ts`: a target 90° off the barrel is **not** hit at `fireArc` 45 but **is** at 180; heat rises while firing and lockout trips at `heatMax`; heat sheds at `coolRate` and fire resumes; a locked-out tank emits no beam.
- [ ] Run — expect failures.
- [ ] Implement in `tank.ts`; emit `beam` from `world.ts` where tank events are resolved.
- [ ] Add the three levers to `schema.ts`.
- [ ] Sabotage: make the arc check always true; confirm the 90°-off test fails; restore.
- [ ] Run full suite; investigate any liveness failure rather than excluding it.
- [ ] `npm run typecheck && npm test`; commit.

---

### Task 4: Render the effects

**Files:** create `src/render/effects.ts`; modify `src/render/bindings.ts`, `src/main.ts`, `src/core/tuning/schema.ts`.

**Background:** five families, all fed by the event feed and the live projectile list, all **emissive** so they sit above the bloom threshold the terrain deliberately sits below (M0c-1's finding). Pools are preallocated `Float32Array`s exactly as `points.ts` does — an effect system that allocates per impact spikes GC during the busiest moment of the game.

| Effect | Source | Form |
|---|---|---|
| Tracer | live projectiles | short trail behind each shot, head brightest |
| Beam | `beam` event | bright segment, `fx.flashDur` burnout |
| Muzzle flash | `shotFired` | brief bloom at the barrel along `dir` |
| Hit flash | `impact` | small bright pop |
| Death burst | `critterDied` | expanding fading ring, radius × `fx.burstSize` |

**New render-only levers:** `fx.flashDur` (0.02–0.5 s, default 0.12), `fx.burstSize` (0–3, default 1), group `feel`. Both join `RENDER_ONLY_KEYS` **and** `RENDER_BINDINGS`; `render/bindings.test.ts` then covers them automatically, which is the point of that table. `RenderTarget` gains `fx: { flashDur: number; burstSize: number }`.

- [ ] Add both levers to `schema.ts`, to `RENDER_ONLY_KEYS`, to `RENDER_BINDINGS`, and extend `makeRenderTarget()`. Run `render/bindings.test.ts` — its coverage and effect tests should now exercise them with no new test code.
- [ ] Add the same two keys to `liveness.test.ts`'s `RENDER_ONLY` set (the bindings coverage test fails if the two lists drift).
- [ ] Implement `effects.ts` with pooled tracers, beams, flashes and bursts; expose `{ group, sync(events, projectiles, dt, target) }`.
- [ ] Wire into `main.ts`: after `loop.advance(...)`, `effects.sync(world.drainEvents(), world.projectiles, frameSeconds, renderTarget)`.
- [ ] `npm run typecheck && npm test`.
- [ ] Look at it on **http://localhost:5144/** — a tower firing must be unmistakable. Screenshot at `tower.projSpeed` 0.3 (slow enough to watch a shot cross a corridor) and 4.0 (near-instant).
- [ ] `./scripts/bust.sh --quiet`; commit.

---

### Task 5: Acceptance and notes

- [ ] Walk spec §8 point by point against the running app, recording what you saw:
      muzzle flash → tracer → hit flash on a tower shot; a visible death burst;
      a shot that misses because its target died in flight; a critter behind the
      tank not being hit; lockout after held fire and visible resumption.
- [ ] Capture the new sweep baseline (`npm run sweep -- enemy.speed 0.6 2.0 3`) — damage now lands late and can miss, so this replaces M0c-1's numbers.
- [ ] Extend `docs/05-M0c-notes.md` with a chunk-2 section: what the build revealed that the spec got wrong (the honest section — do not write "nothing" without looking), the new baseline, effect pool sizes and whether any ceiling bound, and what remains for chunk 3.
- [ ] Update `CLAUDE.md` State and known-state notes.
- [ ] `npm run typecheck && npm test && ./scripts/verify-determinism.sh`.
- [ ] `./scripts/bust.sh --quiet`; commit; push.

---

## Self-Review

**Spec coverage:** §1 event feed → Task 1. §2 projectiles + tick order → Task 2. §3 tank arc/heat → Task 3. §4 five effect families → Task 4. §5 levers → Tasks 2, 3, 4. §6 testing → Tasks 1–4 including both sabotage passes. §7 costs → Task 2 (header update) and Task 5 (baseline capture). §8 acceptance → Task 5. §9 out-of-scope appears in no task, correctly.

**Type consistency:** `EventSource`/`WorldEvent` (Task 1) are consumed by `projectiles.ts` (Task 2), `tank.ts` (Task 3) and `effects.ts` (Task 4) unchanged. `Projectile` (Task 2) is read by `effects.ts` for tracers. `RenderTarget.fx` (Task 4) extends the shape M0b's `bindings.ts` defined.

**One risk flagged rather than deferred:** Task 2 changes the tick order, and `liveness.test.ts` runs 3,000 ticks against every lever. Damage landing late and sometimes missing weakens the already-marginal one-tower baseline that M0c-1 measured. If `tower.damage` or `tower.rate` goes dead, the fix is a documented `COMPANION_OVERRIDE` (as `tower.rate` already has), never an exclusion — and it is more evidence for the standing finding that the default tower is too weak to complete a kill.
