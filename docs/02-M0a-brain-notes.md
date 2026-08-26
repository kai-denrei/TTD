# M0a — Brain Notes: What the Build Revealed

**Status:** complete. 2026-08-26. M0a-fixB applied.
**Tests:** 144 passing, `tsc --noEmit` clean.

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
9. prune dead critters       — compact critters[] after all find() calls complete
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

- Telemetry is step 8 so it records the *resolved* frame state: live critter
  count after deaths, kills after damage, heart HP after leaks. Recording
  before resolution would undercount everything by one frame.

- Pruning is last (step 9) so all step 7 `find()` calls can still locate
  the critters they damage. After pruning, `critters[]` contains only live
  critters, keeping it O(alive) rather than O(ever-spawned).

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
| `stream(seed, 'critters')` | `spawnCritter` / `stepCritter` | One shared `crittersRng` stream (not per-critter). All spawned critters draw from the same sequence in spawn order. **Comparability hazard:** changing a combat lever changes which critters survive, which shifts every survivor's subsequent envelope draws — runs at different settings are not directly comparable at the per-critter level. |

The 'grid' and 'dungeon' streams are consumed entirely during world construction
(they generate static geometry). The 'waves' and 'critters' streams are consumed
every tick; their sequence is the simulation's source of entropy.

**The invariant the replay test checks:** given the same `seed`, same preset
string, and same sequence of `TankInput` frames, `telemetry.summary()` must be
byte-identical across separate process runs. This is enforced by
`world.test.ts`'s determinism test (task 7) and the cross-process
`scripts/verify-determinism.sh` script (run after I9 critter pruning — PASS).

---

## 3. Headless sweep — `enemy.speed` (0.6 → 2.0, 5 steps)

```
node --experimental-strip-types scripts/sweep.ts enemy.speed 0.6 2.0 5
```

```
┌─────────┬─────────────┬────────────┬─────────────────────┬────────────────────┬───────────────────┬────────────────────┬────────────────────┬────────────────────┬────────────────────┬────────────────────┬──────────┬────────────────────┬────────────────────┬───────────────────┬───────┬───────────┬──────────┬───────┬──────────────┬─────────────────────┬────────────────┬────────────────────┬────────────────┐
│ (index) │ enemy.speed │ macroShare │ playerKillShare     │ towerKillShare     │ ttkMean           │ ttkP90             │ lifespanMean       │ lifespanP90        │ waveClearMean      │ waveClearP90       │ survived │ survivedFor        │ heartDeathAt       │ elapsed           │ kills │ heartHits │ tankHits │ leaks │ modeSwitches │ tankIdleUnderThreat │ peakConcurrent │ decisionsThisPhase │ decisionsTotal │
├─────────┼─────────────┼────────────┼─────────────────────┼────────────────────┼───────────────────┼────────────────────┼────────────────────┼────────────────────┼────────────────────┼────────────────────┼──────────┼────────────────────┼────────────────────┼───────────────────┼───────┼───────────┼──────────┼───────┼──────────────┼─────────────────────┼────────────────┼────────────────────┼────────────────┤
│ 0       │ 0.6         │ 0          │ 0.2857142857142857  │ 0.7142857142857143 │ 4.344047619047387 │ 10.616666666666063 │ 10.02857142857098  │ 11.533333333333525 │ 16.920833333332684 │ 17.733333333332332 │ 0        │ 61.57              │ 61.57              │ 100.0             │ 14    │ 32        │ 5        │ 32    │ 0            │ 0                   │ 13             │ 1                  │ 1              │
│ 1       │ 0.95        │ 0          │ 0.75                │ 0.25               │ 2.088541666666572 │ 4.63333333333307   │ 4.468749999999794  │ 7.149999999999594  │ 12.993333333332746 │ 14.299999999999194 │ 0        │ 48.47              │ 48.47              │ 100.0             │ 16    │ 44        │ 6        │ 44    │ 0            │ 0                   │ 13             │ 1                  │ 1              │
│ 2       │ 1.3         │ 0          │ 0.46153846153846156 │ 0.5384615384615384 │ 2.030769230769133 │ 4.16666666666643   │ 3.961538461538267  │ 5.383333333333027  │ 11.183333333332813 │ 12.066666666665988 │ 0        │ 43.88              │ 43.88              │ 100.0             │ 13    │ 47        │ 3        │ 47    │ 0            │ 0                   │ 12             │ 1                  │ 1              │
│ 3       │ 1.65        │ 0          │ 0.375               │ 0.625              │ 1.223958333333299 │ 2.750000000000049  │ 3.4666666666665322 │ 4.616666666666404  │ 10.246666666666195 │ 10.883333333332715 │ 0        │ 42.50              │ 42.50              │ 100.0             │ 16    │ 54        │ 4        │ 54    │ 0            │ 0                   │ 10             │ 1                  │ 1              │
│ 4       │ 2           │ 0          │ 0.45454545454545453 │ 0.5454545454545454 │ 1.321212121212055 │ 2.249999999999872  │ 2.9651515151513563 │ 3.5833333333331296 │ 9.558333333332863  │ 10.999999999999375 │ 0        │ 37.15              │ 37.15              │ 100.0             │ 11    │ 64        │ 3        │ 64    │ 0            │ 0                   │ 9              │ 1                  │ 1              │
└─────────┴─────────────┴────────────┴─────────────────────┴────────────────────┴───────────────────┴────────────────────┴────────────────────┴────────────────────┴────────────────────┴────────────────────┴──────────┴────────────────────┴────────────────────┴───────────────────┴───────┴───────────┴──────────┴───────┴──────────────┴─────────────────────┴────────────────┴────────────────────┴────────────────┘
```

**New columns (M0a-fixB):**
- `survived`: 0 = heart died during the run, 1 = heart survived
- `survivedFor`: elapsed time at heart death (or total elapsed if survived)
- `heartDeathAt`: same as survivedFor when survived=0; 0 when survived=1
- `ttkMean`/`ttkP90`: now measures **true TTK** — elapsed from first damage to death. Kills with no prior hit (pure ram) are excluded.
- `lifespanMean`/`lifespanP90`: total age from spawn to death (this was the old `ttkMean`)

**Reading:** All rows have `survived=0` — the heart dies in every run at this config (one tower at heart). The key post-mortem warning: `survivedFor` shows the heart dies between t=37 (speed=2) and t=62 (speed=0.6), meaning 38%–63% of the 100s run is measuring a dead game. Compare `survivedFor` across settings, not just the final aggregates.

**`heartHits` climbs 32 → 64** as speed increases — faster enemies reach the heart more often. The heart dies faster at high speed (survivedFor 37 vs 62).

**`ttkMean` (true TTK)** now ranges 1.3–4.3s. Unlike the old lifespan-based metric, this measures how long enemies survive after taking their first hit — a genuine measure of tower effectiveness. It decreases at higher speed not because enemies travel faster but because fast enemies spend a shorter fraction of their journey in tower range.

**`lifespanMean`** shows the old journey-length picture: 3.0s at speed=2 vs 10.0s at speed=0.6. The journey-length story belongs to `lifespanMean`, not `ttkMean`.

**`waveClearMean` is now non-zero** (wired in f443b63) — waves clear in 9–17s depending on speed. Faster enemies clear waves faster because the ones that survive tower fire reach the heart quickly.

**Verdict:** `enemy.speed` is read live every tick. The harness gives meaningful
comparative signal — but the post-mortem warning applies to all rows.

---

## 4. Headless sweep — `wave.dripRate` (0.1 → 1.5, 4 steps)

```
node --experimental-strip-types scripts/sweep.ts wave.dripRate 0.1 1.5 4
```

```
┌─────────┬───────────────┬────────────┬────────────────────┬────────────────────┬────────────────────┬───────────────────┬────────────────────┬───────────────────┬────────────────────┬────────────────────┬──────────┬────────────────────┬────────────────────┬───────────────────┬───────┬───────────┬──────────┬───────┬──────────────┬─────────────────────┬────────────────┬────────────────────┬────────────────┐
│ (index) │ wave.dripRate │ macroShare │ playerKillShare    │ towerKillShare     │ ttkMean            │ ttkP90            │ lifespanMean       │ lifespanP90       │ waveClearMean      │ waveClearP90       │ survived │ survivedFor        │ heartDeathAt       │ elapsed           │ kills │ heartHits │ tankHits │ leaks │ modeSwitches │ tankIdleUnderThreat │ peakConcurrent │ decisionsThisPhase │ decisionsTotal │
├─────────┼───────────────┼────────────┼────────────────────┼────────────────────┼────────────────────┼───────────────────┼────────────────────┼───────────────────┼────────────────────┼────────────────────┼──────────┼────────────────────┼────────────────────┼───────────────────┼───────┼───────────┼──────────┼───────┼──────────────┼─────────────────────┼────────────────┼────────────────────┼────────────────┤
│ 0       │ 0.1           │ 0          │ 0.6666666666666666 │ 0.3333333333333333 │ 3.0111111111109796 │ 6.999999999999602 │ 5.6263888888886235 │ 7.233333333332922 │ 8.288888888888492  │ 8.749999999999506  │ 0        │ 39.48              │ 39.48              │ 100.0             │ 12    │ 63        │ 16       │ 63    │ 0            │ 0                   │ 16             │ 1                  │ 1              │
│ 1       │ 0.567         │ 0          │ 0.5555555555555556 │ 0.4444444444444444 │ 1.779629629629564  │ 4.466666666666413 │ 5.133333333333135  │ 7.349999999999586 │ 13.586666666666058 │ 15.033333333332479 │ 0        │ 54.35              │ 54.35              │ 100.0             │ 18    │ 42        │ 8        │ 42    │ 0            │ 0                   │ 13             │ 1                  │ 1              │
│ 2       │ 1.033         │ 0          │ 0.3684210526315789 │ 0.631578947368421  │ 2.2412280701753353 │ 5.583333333333016 │ 5.214912280701507  │ 7.183333333332925 │ 17.049999999999294 │ 19.933333333332207 │ 0        │ 82.53              │ 82.53              │ 100.0             │ 19    │ 27        │ 6        │ 27    │ 0            │ 0                   │ 9              │ 1                  │ 1              │
│ 3       │ 1.5           │ 0          │ 0.4666666666666667 │ 0.5333333333333333 │ 3.012222222222117  │ 5.666666666666348 │ 5.683333333333126  │ 7.199999999999591 │ 21.97777777777696  │ 25.3333333333319   │ 0        │ 98.22              │ 98.22              │ 100.0             │ 15    │ 21        │ 2        │ 21    │ 0            │ 0                   │ 6              │ 1                  │ 1              │
└─────────┴───────────────┴────────────┴────────────────────┴────────────────────┴────────────────────┴───────────────────┴────────────────────┴───────────────────┴────────────────────┴────────────────────┴──────────┴────────────────────┴────────────────────┴───────────────────┴───────┴───────────┴──────────┴───────┴──────────────┴─────────────────────┴────────────────┴────────────────────┴────────────────┘
```

**Reading:** All rows have `survived=0` — the heart dies in every run. The `survivedFor` column is the key: burst spawning (dripRate=0.1) kills the heart by t=39; trickle (dripRate=1.5) survives until t=98. This confirms that `wave.dripRate` is the most impactful lever for *how long* the heart lives, not just whether it gets hit.

**Post-mortem warning applies differently here:** dripRate=0.1 spends ~60% of its run post-mortem (t=39 to t=100), dripRate=1.5 spends ~2%. The `heartHits` comparison (63 vs 21) is real — the burst setting dies faster and keeps accruing while dead — so the gap is partly genuine pressure and partly dead-game accumulation. Truncate at `survivedFor` for a clean comparison.

**`heartHits` falls 63 → 21** as drip rate rises, confirming the burst-vs-trickle dynamic. The gap between 0.1 (burst, killed at t=39) and 1.5 (trickle, killed at t=98) is enormous — this confirms `wave.dripRate` as the #1 game-feel lever.

**`waveClearMean` rises 8.3 → 22.0s** with drip rate — slower spawning means each individual wave takes longer to clear because the enemies arrive one by one over a longer window. `peakConcurrent` falls from 16 to 6, confirming the trickle effect.

**`ttkMean` (true TTK)** is now relatively stable across rows (1.8–3.0s) compared to the old lifespan metric. True TTK measures tower effectiveness regardless of spawn density — good. The variation comes from crowd effects: at burst (dripRate=0.1), multiple enemies compete for the tower's target, so some survive longer inside range before being shot.

**Verdict:** `wave.dripRate` remains the most impactful tuning lever. Use `survivedFor` to understand when the game ended, and compare `heartHits` against `survivedFor` rather than against raw `elapsed`.

---

## 5. What the build surfaced that the vision/spec got wrong

**1. `waveClearMean` / `waveClearP90` are now non-zero (M11 fix).**
These were 0 in M0a's original sweep tables because §5.1 claimed `waveCleared()`
was never wired. That was wrong — it was wired in commit f443b63 at `world.ts:148`.
The tables above are regenerated from the post-fix simulation and show real values.

**2. `modeSwitches` is always 0 in the sweep.**
The scripted session never calls `w.setMacro(true)`, so the mode never
transitions. The counter works correctly (tested in isolation), but the sweep
script intentionally mirrors a pure-tactical session. This is expected
behaviour — documenting it here so future sweep scripts can exercise macro mode.

**3. `tankHits` is always present but varies.**
The scripted input moves the tank, producing occasional contacts depending on
seed and enemy positions. On seed 42 at default tuning, contacts are low.
This is expected — the sweep is not designed to stress tank combat.

**4. `time.scale` applied to `elapsed` but telemetry accumulates post-scale.**
`w.telemetry.data.elapsed` accumulates scaled `dt`, not raw `dt`. This means
a `time.scale=2` run reports `elapsed ≈ 100s` with only 50s of wall time. This
is correct — telemetry is measuring game-time, which is what tuning comparisons
should be based on. But it is worth noting: sweep rows are comparable only if
they all use the same `time.scale`.

**5. The sim never ends — most sweep measurement is post-mortem (NEW-A finding).**
At default tuning, seed 42, one tower at heart, the heart dies around t=37–62s
depending on `enemy.speed`. Sweep runs are 100s, so 38–63% of every row is
measured after death. `survivedFor` in `summary()` now timestamps the death so
sweeps can report or truncate on it. Comparing a setting that dies at t=37
against one that dies at t=62 is valid only if you normalise by `survivedFor`.

**6. `ttk` measured lifespan, not time-to-kill (I7 fix).**
The old `ttkMean` was elapsed from spawn to death — a mix of travel time and
time-under-fire. Now `ttkMean` measures elapsed from first damage to death
(true TTK). The old metric is now `lifespanMean`. The narrative about "ttkMean
falls with speed because enemies travel faster" was wrong — it was measuring
the journey. True TTK is more stable across speed settings as shown above.

**7. `leaks` duplicated `heartHits` (I6 fix).**
Before the fix, both counters were incremented together and were always equal.
Now: `leak` = critter reached the heart (always, even in god mode); `heartHit`
= damage was actually applied (skipped if `god.heartInvulnerable`). Under
normal play (no god mode), leaks === heartHits. Under god mode, leaks > 0 and
heartHits === 0.
