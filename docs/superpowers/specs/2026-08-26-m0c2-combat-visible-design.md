# M0c-2 — Combat Made Visible · design

**Status:** approved 2026-08-26. Part of M0c — PoC parity, chunk 2 of 3.
**Predecessor:** M0c-1 (walls & high ground) — complete, 265 tests.

> The operator's report on M0b was *"towers don't fire, or it's hard to tell."*
> They fire. Nothing draws it. This chunk fixes the cause, not the symptom.

---

## 0. The root cause

M0b renders **state** and not **events**. Every tick the world resolves tower
damage, kills, heart hits and tank contacts — and then discards all of it,
exposing only the surviving positions. A tower killing a critter is a state
transition with no visual trace: the critter is simply gone next frame.

So this chunk is not "add particle effects". It is: **give the simulation a way
to say what happened**, then draw it. Every effect below hangs off that one
mechanism.

---

## 1. The event feed

`World` gains a small event buffer that the renderer drains each frame.

```ts
// src/core/sim/events.ts
export type WorldEvent =
  | { kind: 'shotFired'; at: Vec3; dir: Vec3; source: EventSource }
  | { kind: 'beam'; from: Vec3; to: Vec3 }          // hitscan: the tank's laser
  | { kind: 'impact'; at: Vec3; damage: number; source: EventSource }
  | { kind: 'critterDied'; at: Vec3; by: EventSource }
  | { kind: 'heartHit'; at: Vec3 }
  | { kind: 'tankHit'; at: Vec3 };

export type EventSource = 'tower' | 'tank';
```

`World` exposes `drainEvents(): WorldEvent[]`.

**The buffer is cleared at the START of every tick, not on drain.** A headless
run has no renderer to drain it, and a 6,000-tick sweep that accumulates every
impact would be an unbounded allocation in the one code path that must stay
cheap. Clearing per tick bounds it to a single frame's worth regardless of who
is listening; a renderer that drains after `tick()` sees exactly that frame's
events.

Events carry positions, not entity references. A critter that died this tick is
already pruned by the time the renderer looks, and holding a reference to a dead
entity is how a renderer ends up resurrecting things.

---

## 2. Projectiles as simulation entities

Today `stepTowers` returns damage events and the world applies them the same
tick — instant, unmissable, no travel. The PoC instead spawns shots that
**travel, home, arc, and can miss** (`td-tab.js:3166`: a shot is killed when
`p.dist > p.range`, hit or not).

```ts
// src/core/sim/projectiles.ts
export type Projectile = {
  id: number;
  pos: Vec3;
  dir: Vec3;          // unit tangent, re-orthogonalised each step
  travelled: number;  // chord distance so far, against `range`
  range: number;
  speed: number;
  damage: number;
  source: EventSource;
  homingId: number | null;   // critter id, or null for dumb-fire
};
```

`stepProjectiles(projectiles, critters, dt, tuning)` moves each shot along the
sphere surface, re-steers homing shots toward their (living) target with the
PoC's 0.75/0.25 blend, tests collision by chord distance, and returns damage
events plus impacts. A shot whose `travelled` exceeds `range` dies unhit.

**Tick order gains a phase.** The header comment in `world.ts` calls the order
load-bearing, and this changes it:

```
  5. towers      → SPAWN projectiles (no damage)
  6. tank        → hitscan damage events + beam events
  7. projectiles → move, home, collide → damage + impact events
  8. resolve damage → apply, count kills/hits
  9. telemetry
 10. prune dead critters, prune spent projectiles
```

Projectiles step **after** the tank so a shot fired this tick does not also
resolve this tick — it must be visible in flight for at least one frame, or the
travel time it exists to express is invisible.

**Why this is worth changing the sim for:** `projSpeed` becomes a real lever.
Vision §6.4 names HK's per-tower `projSpeed` identity as "what stops towers
feeling samey", and chunk 3's whole premise is a roster of towers that feel
different. A render-only projectile cannot carry that.

---

## 3. Tank: aimed fire and heat

Two changes, both from the PoC.

**Aimed fire.** `stepTank` currently picks the nearest critter in range *in any
direction* — the barrel is decoration. It now requires the target within
`tank.fireArc` of the heading. The tank must be pointed at what it shoots,
which is what makes steering matter and what makes the turn fix from M0c-1
worth having.

**Heat and lockout.** The PoC's tank runs twin lasers with `LASER_MAX_HEAT 2.4`
seconds of continuous fire before lockout and `LASER_COOL 1.4` per second
(lockout ≈ 1.7 s). Firing adds heat; at max the guns cut out until cooled. The
point is the same as the orbital strike's commit ritual in vision §6.4: **you
cannot hold the trigger**, so tank DPS is a resource you spend rather than a
constant.

The tank stays **hitscan** — a beam, not a projectile — matching the PoC and
giving the two weapon systems genuinely different feels: deliberate travelling
tower fire against immediate tactical response.

---

## 4. Render: five effect families

All driven off the event feed, all emissive so they sit **above** the bloom
threshold that M0c-1 established the terrain sits below. That contrast is the
point: the board is dim, and the things that matter glow.

| Effect | Source event | Form |
|---|---|---|
| **Tracer** | live projectile list | a short trail of points behind each shot, head brightest |
| **Beam** | `beam` | a bright segment from tank to target, ~0.12 s burnout |
| **Muzzle flash** | `shotFired` | a brief bloom at the barrel, oriented along `dir` |
| **Hit flash** | `impact` | a small bright pop at the impact point |
| **Death burst** | `critterDied` | an expanding, fading ring of points |

Effects are pooled exactly as units are (M0b's `points.ts` pattern): fixed
capacity, preallocated `Float32Array`, no per-frame allocation. An effect system
that allocates per impact would spike GC during precisely the busiest moment.

`render/effects.ts` owns the pools and their lifetimes; it consumes events and
the projectile list, and knows nothing about how either is produced.

---

## 5. New levers

| Group | Lever | Range | Default | Controls |
|---|---|---|---|---|
| player | `tower.projSpeed` | 0.3–4.0 | 1.2 | shot travel speed (sphere units/s) |
| player | `tank.fireArc` | 10–180° | 45 | how far off the barrel the tank can hit |
| player | `tank.heatMax` | 0.5–6.0 s | 2.4 | continuous fire before lockout (PoC value) |
| player | `tank.coolRate` | 0.2–4.0 /s | 1.4 | heat shed per second (PoC value) |
| feel | `fx.flashDur` | 0.02–0.5 s | 0.12 | hit-flash and muzzle-flash lifetime |
| feel | `fx.burstSize` | 0–3 | 1 | death-burst radius multiplier |

The four `player` levers must pass `liveness.test.ts` — they change kill timing,
so they change telemetry. The two `fx` levers are render-only and join
`RENDER_ONLY_KEYS` plus `RENDER_BINDINGS`, gated by `render/bindings.test.ts`
exactly as `bloom.*` and `shake.amount` are.

`tank.fireArc` at 180° reproduces today's omnidirectional behaviour, which makes
the lever's own upper bound the migration path rather than a cliff.

---

## 6. Testing

**New:**
- `core/sim/events.test.ts` — the buffer clears per tick and never grows across
  a long headless run; drain returns one frame's events and empties.
- `core/sim/projectiles.test.ts` — a shot travels at `speed`; damage lands on
  impact, **not** at spawn; a shot exceeding `range` dies unhit; a homing shot
  whose target dies continues on its last heading rather than throwing; two
  identical runs produce identical projectile paths.
- `core/sim/tank.test.ts` (extend) — a target outside `fireArc` is not hit; the
  same target inside it is; heat accumulates while firing and locks out at
  `heatMax`; heat sheds at `coolRate` and fire resumes.
- `render/effects.test.ts` — pool capacity is a hard ceiling; an expired effect
  frees its slot; no allocation after construction (assert the buffer identity
  is stable across many spawns).
- `render/bindings.test.ts` — automatically covers the two new `fx` levers via
  the existing coverage test, which is the point of that table.

**Sabotage passes:** make `stepProjectiles` deal damage at spawn instead of on
impact and confirm the travel-time test fails; widen the `fireArc` check to
always pass and confirm the arc test fails.

**Regression risk to watch:** `liveness.test.ts` must stay green. Damage now
lands late and can miss, which changes kill timing throughout — if a lever goes
dead, that is a finding to investigate, never an exclusion to add.

---

## 7. Costs, stated plainly

**Telemetry baselines shift again.** Damage that used to land instantly now
arrives after travel and sometimes not at all. Kill timing changes throughout,
and because critters share one RNG stream, every later envelope draw moves with
it. M0c-1's numbers join M0a's and M0b's as historical.

**Tick order changes.** `world.ts`'s header states that reordering invalidates
the comparability of saved presets. Adding phase 7 does exactly that. The header
must be updated in the same commit as the change, not after.

Both are accepted for the same reason as last time: cheaper now, before anyone
has tuned against the current numbers, than later.

---

## 8. Acceptance

1. A tower firing is unmistakable: muzzle flash, a tracer crossing the gap, a
   hit flash on arrival.
2. A critter dying produces a visible burst.
3. Tower shots visibly travel — at `tower.projSpeed` 0.3 they are slow enough to
   watch cross a corridor; at 4.0 they are near-instant.
4. A shot whose target dies in flight visibly continues and misses.
5. The tank fires along its barrel; a critter behind it is not hit.
6. Holding fire locks the tank out, and it visibly resumes after cooling.
7. Every new `player` lever passes liveness; both `fx` levers pass the bindings
   gate.
8. `npm test`, `npm run typecheck`, determinism PASS.

---

## 9. Out of scope

- Splash damage and mortar arcs (the PoC has both) — they belong with the tower
  types that use them, in **chunk 3**.
- Tower types, cost, sell, upgrade, range rings — **chunk 3**.
- Audio — M3. It is the highest felt-impact item in vision §6.5, and it is
  deliberately not being smuggled in here.
- Hitstop and damage-scaled camera shake — M3. `shake.amount` already exists and
  is already wired; adding trauma on impact is a one-line change that belongs
  with the rest of the feel pass, not ahead of it.
- Economy and win condition — after chunk 3.
