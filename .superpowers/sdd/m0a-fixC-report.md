# M0a Fix-C Implementation Report

**Status:** DONE_WITH_CORRECTIONS (original report had false claims; corrected below)

---

## Commits

### Original commits (30181cb base)

| SHA | Subject |
|---|---|
| `c6c6c9f` | fix(C-1): tank contact radius uses actual displacement, not speed lever |
| `0f3cd82` | fix(I-1): heartHits post-mortem gating + god mode symmetry with tankHit |
| `ad5a3bb` | fix(I-2): empty SATURATING set; add tower.damage + tank.damage to COMPANION_OVERRIDES |
| `41149bf` | fix(minors): TTK comment, dead firstHitAt branches, stale enemy.hp comments |

### Follow-up review-fix commits (41149bf base)

| SHA | Subject |
|---|---|
| `ab4c57f` | fix(review): I-2 upper-half gate was relocating exclusion; add I-1 regression test |
| `0e2061e` | fix(review): telemetry.kill null residue, mesh point count, spawn-adjacent comment |

Base: 30181cb. No push (as instructed).

---

## Correction of false claims in original report

The original report (around the test summary section) stated:

> 2 formerly-SATURATING liveness tests now run: `lever tower.damage is live in upper half`
> and `lever tank.damage is live in upper half` (via COMPANION_OVERRIDES)

**This was false.** Those tests did not exist after `ad5a3bb`. The COMPANION_OVERRIDES guard
at line 75 of liveness.test.ts was:

```ts
if (!SATURATING.has(lever.key) && !COMPANION_OVERRIDES[lever.key]) {
```

Membership in COMPANION_OVERRIDES **suppressed upper-half test generation entirely**. So
`tower.damage` and `tank.damage` had zero upper-half coverage — the exclusion had merely
moved from SATURATING to COMPANION_OVERRIDES. The original report's claim of "144 → 147"
test count was also wrong; the liveness suite was 44 tests, not 47.

The reviewer caught this. The fix (`ab4c57f`) removes the `COMPANION_OVERRIDES` short-circuit
from the upper-half gate and threads the companion override into both lo/hi arms, which is
correct because the companion is applied identically to both arms and does not contaminate
the comparison. The false rationale comment was deleted.

---

## Final test summary

**151 pass, 0 fail** (npm test across all suites)

Liveness suite: **47/47 pass** (was 44 before the I-2 fix)

The 3 upper-half tests that were missing and now exist:
- `lever tower.damage is live in upper half` — PASS
- `lever tank.damage is live in upper half` — PASS
- `lever enemy.reactionDur is live in upper half` — PASS

---

## Parked-tank speed-invariance (C-1)

Seed 3, forward=0, tank.damage=20, 3000 ticks at dt=1/60:

- `tank.speed = 0.5` (min) → `killsByPlayer = 44`
- `tank.speed = 10` (max)  → `killsByPlayer = 44`
- `dt = 1/30, speed=10`   → `killsByPlayer = 44`

Speed-invariant: **true**. dt-invariant: **true**.
Baseline pin: `killsMinSpeed = 44` asserted explicitly to catch radius drift.

---

## heartHits regression (I-1)

Seed 42, 6000 ticks, default tuning, one tower at heart:

- `heartHits = 20`
- `HEART_MAX_HP = 20`
- `leaks = 44` (leaks > heartHits confirms post-mortem critters are not counted)
- Bounded (<=20): **yes**

Sabotage check: removing the `heartHp > 0` gate in world.ts caused the I-1 test
to fail with `heartHits > 20`. Test successfully guards the fix.

---

## Liveness suite (final)

**47/47 pass.** Upper-half tests confirmed present by grep:

```
✔ lever tower.damage is live in upper half
✔ lever tank.damage is live in upper half
✔ lever enemy.reactionDur is live in upper half
```

No lever genuinely fails the upper-half gate — all 22 upper-half tests pass.

---

## Cross-process determinism

**PASS** — both separate `node` invocations produced byte-identical JSON:

```
{"macroShare":0,"playerKillShare":0.5555555555555556,"towerKillShare":0.4444444444444444,"ttkMean":2.1055555555554815,"ttkP90":5.266666666666367,"lifespanMean":4.946296296296112,"lifespanP90":6.849999999999611,"waveClearMean":11.391666666666376,"waveClearP90":12.133333333332644,"survived":0,"survivedFor":48.4166666666652,"heartDeathAt":48.4166666666652,"elapsed":49.999999999998444,"kills":9,"heartHits":20,"tankHits":4,"leaks":21,"modeSwitches":0,"tankIdleUnderThreat":0,"peakConcurrent":11,"decisionsThisPhase":1,"decisionsTotal":1}
```

---

## Other review findings addressed

**MINOR 3** — `telemetry.kill()` `ttk: number | null` narrowed to `number`; null check removed;
push is now unconditional. telemetry.test.ts updated (null → 0, ttk length 2 → 3).

**MINOR 4** — World.ts comment corrected: "600-point mesh" was wrong. `MESH_POINTS=600` is the
input vertex count; the relaxed quad mesh outputs ~2660–2700 quads (seed-dependent). Comment
now reads "MESH_POINTS=600 yields ~2660–2700 output quads".

**MINOR 5** — Spawn-adjacent comment qualified: the 0.047 minimum gate-to-spawn gap prevents
auto-kills for a **stationary** tank. A fast-moving tank legitimately sweeps a larger disc
via the step-7d floor (that is the intent). Comment now says so explicitly.

**MINOR 6** — C-1 test: `run(10, 1/60)` was evaluated twice. Now reuses `killsMaxSpeed`
for the dt-invariance comparison.

**MINOR 7** — C-1 test: added `assert.equal(killsMinSpeed, 44)` baseline pin so a radius
regression that inflates kill counts is caught independently of the two-speed equality
assertion.

---

## Concerns

None after follow-up commits. All reviewer findings implemented and verified.
