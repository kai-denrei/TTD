# M0a — Brain Notes: What the Build Revealed

**Status:** complete. 2026-08-26.
**Scope:** M0a = the pure `core/` modules (tasks 1–8). No renderer, no UI, no wall-clock.
**Tests:** 89 passing, `tsc --noEmit` clean.

---

## 1. Fixed tick order — why it is load-bearing

`world.ts` runs eight phases in a fixed sequence every frame:

```
1. dt *= time.scale          — scaled time is what every system sees
2. waves.tick                → queues pendingSpawns via onSpawn callback
3. spawn                     → pendingSpawns → critters[]
4. critters                  → step each live critter; collect 'arrived' (leaks)
5. towers                    → collect TowerDamageEvents
6. tank                      → collect TankDamageEvents; observe tankActing
7. resolve damage            → apply all events; count kills, heart hits, tank hits
8. telemetry.tick            — sees the final frame state
```

**Why order matters:**

- `dt` scaling must be step 1. A system that sees an unscaled dt and then
  reads `time.scale` again internally would diverge from the canonical value.
  No system does this — all receive `dt` as a parameter — but the invariant
  is enforced structurally by making scaling unconditional and first.

- Spawn before step is non-negotiable: a critter spawned in the same tick
  it was queued must take its first step in that same tick, not the next.
  Inverting this would cause a one-frame invisible spawn that accumulates
  across thousands of ticks into a measurable position drift.

- Damage events are collected from towers and tank in steps 5–6, then
  applied together in step 7. This prevents a tower and the tank from both
  "seeing" the same live critter, killing it independently, and double-counting
  the kill. Collect-then-apply is the only safe order for shared mutable state.

- Telemetry is last so it records the *resolved* frame state: live critter
  count after deaths, kills after damage, heart HP after leaks. Recording
  before resolution would undercount everything by one frame.

**Consequence for presets:** reordering the tick phases invalidates every
saved preset, because telemetry values are path-dependent on which systems
ran first. The comment in `world.ts` is a load-bearing contract, not a hint.

---

## 2. Named RNG streams and their owners

Determinism requires that every random draw is assigned to exactly one named
stream, and that streams are never shared across systems. Adding a draw inside
one system must not reshuffle draws in another.

| Stream name | Owner | Notes |
|---|---|---|
| `stream(seed, 'grid')` | `generateSphereMesh` | Sphere point placement and relaxation. |
| `stream(seed, 'dungeon')` | `generateDungeon` (internal) | BFS carve, room placement, corridor selection. |
| `stream(seed, 'waves')` | `makeWaveEngine` / `planWave` | Wave sequencing, drip jitter, gate selection. |
| `stream(seed, 'critters')` | `spawnCritter` / `stepCritter` | Per-critter speed envelope retargeting. |

The 'grid' and 'dungeon' streams are consumed entirely during world construction
(they generate static geometry). The 'waves' and 'critters' streams are consumed
every tick; their sequence is the simulation's source of entropy.

**The invariant the replay test checks:** given the same `seed`, same preset
string, and same sequence of `TankInput` frames, `telemetry.summary()` must be
byte-identical across separate process runs. This is enforced by
`world.test.ts`'s determinism test (task 7).

---

## 3. Headless sweep — `enemy.speed` (0.6 → 2.0, 5 steps)

```
node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5
```

```
┌─────────┬─────────────┬────────────┬────────────────────┬─────────────────────┬────────────────────┬────────────────────┬───────────────┬──────────────┬───────────────────┬───────┬───────────┬──────────┬───────┬──────────────┬─────────────────────┬────────────────┬────────────────────┐
│ (index) │ enemy.speed │ macroShare │ playerKillShare    │ towerKillShare      │ ttkMean            │ ttkP90             │ waveClearMean │ waveClearP90 │ elapsed           │ kills │ heartHits │ tankHits │ leaks │ modeSwitches │ tankIdleUnderThreat │ peakConcurrent │ decisionsThisPhase │
├─────────┼─────────────┼────────────┼────────────────────┼─────────────────────┼────────────────────┼────────────────────┼───────────────┼──────────────┼───────────────────┼───────┼───────────┼──────────┼───────┼──────────────┼─────────────────────┼────────────────┼────────────────────┤
│ 0       │ 0.6         │ 0          │ 0.6666666666666666 │ 0.3333333333333333  │ 3.052083333333178  │ 6.733333333332951  │ 0             │ 0            │ 99.99999999999561 │ 72    │ 0         │ 0        │ 0     │ 0            │ 0                   │ 9              │ 1                  │
│ 1       │ 0.95        │ 0          │ 0.6619718309859155 │ 0.3380281690140845  │ 2.940610328638351  │ 5.8499999999996675 │ 0             │ 0            │ 99.99999999999561 │ 71    │ 0         │ 0        │ 0     │ 0            │ 0                   │ 8              │ 1                  │
│ 2       │ 1.3         │ 0          │ 0.7121212121212122 │ 0.2878787878787879  │ 2.815151515151369  │ 4.86666666666639   │ 0             │ 0            │ 99.99999999999561 │ 66    │ 9         │ 0        │ 9     │ 0            │ 0                   │ 8              │ 1                  │
│ 3       │ 1.65        │ 0          │ 0.631578947368421  │ 0.3684210526315789  │ 2.1599415204677337 │ 3.849999999999781  │ 0             │ 0            │ 99.99999999999561 │ 57    │ 18        │ 0        │ 18    │ 0            │ 0                   │ 8              │ 1                  │
│ 4       │ 2           │ 0          │ 0.5961538461538461 │ 0.40384615384615385 │ 1.7532051282050416 │ 3.316666666666478  │ 0             │ 0            │ 99.99999999999561 │ 52    │ 24        │ 0        │ 24    │ 0            │ 0                   │ 8              │ 1                  │
└─────────┴─────────────┴────────────┴────────────────────┴─────────────────────┴────────────────────┴────────────────────┴───────────────┴──────────────┴───────────────────┴───────┴───────────┴──────────┴───────┴──────────────┴─────────────────────┴────────────────┴────────────────────┘
```

**Reading:** The lever works. Rows differ on every meaningful axis:

- `heartHits` climbs 0 → 0 → 9 → 18 → 24: faster enemies reach the heart
  more often, as expected. The threshold sits between 0.95 and 1.3.
- `kills` falls 72 → 52: the tower has less time on each enemy, so fewer
  die before reaching the heart or escaping the 100-second window.
- `ttkMean` falls 3.05 → 1.75: faster enemies die faster (they enter tower
  range and are shot sooner in their shorter journey).
- `ttkP90` narrows accordingly: the long-tail kill disappears as speed rises.
- `playerKillShare` shifts slightly: the scripted tank fire pattern interacts
  differently with fast vs slow enemies passing through its position.

**Verdict:** `enemy.speed` is read live every tick (confirmed: no captured value
at construction, the store's design contract). The harness gives meaningful
comparative signal.

---

## 4. Headless sweep — `wave.dripRate` (0.1 → 1.5, 4 steps)

```
node --experimental-strip-types scripts/sweep.ts wave.dripRate 0.1 1.5 4
```

```
┌─────────┬───────────────┬────────────┬────────────────────┬─────────────────────┬─────────────────────┬────────────────────┬───────────────┬──────────────┬───────────────────┬───────┬───────────┬──────────┬───────┬──────────────┬─────────────────────┬────────────────┬────────────────────┐
│ (index) │ wave.dripRate │ macroShare │ playerKillShare    │ towerKillShare      │ ttkMean             │ ttkP90             │ waveClearMean │ waveClearP90 │ elapsed           │ kills │ heartHits │ tankHits │ leaks │ modeSwitches │ tankIdleUnderThreat │ peakConcurrent │ decisionsThisPhase │
├─────────┼───────────────┼────────────┼────────────────────┼─────────────────────┼─────────────────────┼────────────────────┼───────────────┼──────────────┼───────────────────┼───────┼───────────┼──────────┼───────┼──────────────┼─────────────────────┼────────────────┼────────────────────┤
│ 0       │ 0.1           │ 0          │ 0.6346153846153846 │ 0.36538461538461536 │ 3.7509615384613566  │ 6.516666666666296  │ 0             │ 0            │ 99.99999999999561 │ 52    │ 27        │ 0        │ 27    │ 0            │ 0                   │ 15             │ 1                  │
│ 1       │ 0.567         │ 0          │ 0.6571428571428571 │ 0.34285714285714286 │ 2.399761904761784   │ 5.33333333333303   │ 0             │ 0            │ 99.99999999999561 │ 70    │ 1         │ 0        │ 1     │ 0            │ 0                   │ 7              │ 1                  │
│ 2       │ 1.033         │ 0          │ 0.7               │ 0.3                 │ 0.706944444444414   │ 1.5666666666665776 │ 0             │ 0            │ 99.99999999999561 │ 60    │ 0         │ 0        │ 0     │ 0            │ 0                   │ 3              │ 1                  │
│ 3       │ 1.5           │ 0          │ 0.8723404255319149 │ 0.1276595744680851  │ 0.49645390070919965 │ 1.0833333333332718 │ 0             │ 0            │ 99.99999999999561 │ 47    │ 0         │ 0        │ 0     │ 0            │ 0                   │ 3              │ 1                  │
└─────────┴───────────────┴────────────┴─────────────────────┴─────────────────────┴─────────────────────┴────────────────────┴───────────────┴──────────────┴───────────────────┴───────┴───────────┴──────────┴───────┴──────────────┴─────────────────────┴────────────────┴────────────────────┘
```

**Reading:** The lever works, revealing the pacing insight from the vision doc:

- At `dripRate=0.1` (burst): `peakConcurrent=15`, `heartHits=27`, `kills=52`.
  A dense simultaneous wave overwhelms the tower — it cannot pick targets fast
  enough, so most enemies reach the heart.
- At `dripRate=1.5` (trickle): `peakConcurrent=3`, `heartHits=0`, `kills=47`.
  The tower clears each enemy in isolation; the heart is never threatened.
- The crossover between "manageable" and "dangerous" sits around 0.5–0.6s.
- `ttkMean` drops sharply from 3.75s → 0.50s as rate rises: trickle enemies
  are killed almost immediately upon entering range, with no crowd cover.
- `towerKillShare` drops at the high end (0.36 → 0.13): the tank's scripted
  fire starts to dominate as the trickle makes targets easier to hit individually.

**Verdict:** `wave.dripRate` is the most impactful lever in M0. The vision doc
called burst spawning the #1 root cause of the PoC feeling bad — these numbers
confirm it numerically: the 0.1 burst setting produces 27 heart hits; the 0.567
default produces 1.

---

## 5. What the build surfaced that the vision/spec got wrong

**1. `waveClearMean` / `waveClearP90` are always 0.**
The wave engine does not call `telemetry.waveCleared()`. The hook exists on
`Telemetry` but is never wired in the World tick — there's no wave-clear
detection between the wave engine and the telemetry object. This is not a
bug in the spec (the spec says the metric exists), but it's a gap: the metric
is unplumbed in M0a and will read 0 until M0b adds the wiring or a future task
hooks it up.

**2. `modeSwitches` is always 0 in the sweep.**
The scripted session never calls `w.setMacro(true)`, so the mode never
transitions. The counter works correctly (tested in isolation), but the sweep
script intentionally mirrors a pure-tactical session. This is expected
behaviour — documenting it here so future sweep scripts can exercise macro mode.

**3. `tankHits` is always 0.**
The scripted input never moves the tank into a position where critters can hit
it (critters walk toward the heart cell, not toward the tank). The tank combat
is live and tested, but the sweep's fixed input doesn't exercise it. Not a bug.

**4. `time.scale` applied to `elapsed` but telemetry accumulates post-scale.**
`w.telemetry.data.elapsed` accumulates scaled `dt`, not raw `dt`. This means
a `time.scale=2` run reports `elapsed ≈ 100s` with only 50s of wall time. This
is correct — telemetry is measuring game-time, which is what tuning comparisons
should be based on. But it is worth noting: sweep rows are comparable only if
they all use the same `time.scale`.

**5. The spec said enemy speed was "the lever the PoC never had".**
Confirmed. At `enemy.speed=0.6` the heart is never touched across 100 game-seconds;
at `enemy.speed=2.0` it takes 24 hits. This is the clearest confirmation that
the lever taxonomy is correctly wired: one number changes the entire game.
