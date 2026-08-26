# M0a Fix-C — re-review closeout report

Range: `30181cb..f23b723` (8 commits, local only, not pushed)
Entry state: 144 tests green, `tsc --noEmit` clean, cross-process determinism verified
Exit state: **151 tests green**, typecheck clean, determinism re-verified (non-vacuous)

Process: implement → opus review (empirical, sabotage-based) → fix → re-review → fix.
Two review rounds. Round 1 found the Critical below; round 2 found the Important below.
Both were real, both were caught only because the reviewers **ran and sabotaged the sim**
rather than reading the diff — consistent with this project's standing lesson.

## Commits

| SHA | Subject |
|---|---|
| `c6c6c9f` | fix(C-1): tank contact radius uses actual displacement, not speed lever |
| `0f3cd82` | fix(I-1): heartHits post-mortem gating + god mode symmetry with tankHit |
| `ad5a3bb` | fix(I-2): empty SATURATING set; add tower.damage + tank.damage to COMPANION_OVERRIDES |
| `41149bf` | fix(minors): TTK comment, dead firstHitAt branches, stale enemy.hp comments |
| `ab4c57f` | fix(review): I-2 upper-half gate was relocating exclusion; add I-1 regression test |
| `0e2061e` | fix(review): telemetry.kill null residue, mesh point count, spawn-adjacent comment |
| `3d41def` | docs: correct m0a-fixC-report — false claims about I-2 upper-half tests |
| `f23b723` | fix(review): expose tankContactRadius; tighten C-1, I-1, MINOR 3 tests |

Diffstat: 7 files, +294 / −67. All commits carry the required trailer.

---

## C-1 — contact radius now derives from motion, not the speed lever

`world.ts`: `tankPrev` is captured immediately **before** `stepTank` (nothing mutates
`tank.pos` between capture and use — steps 7a–7c touch critters and the heart only). The
radius is now `max(tankContactRadius, 0.5 * |displacement this tick|)`. The speed lever no
longer appears in the contact path at all.

Both stale comment blocks corrected: the derivation block (which described the static
radius as if the speed floor did not exist) and the contact-radius block (which described
`tank.speed*dt`).

### Parked-tank speed-invariance — measured

Seed 3 (the pass-through seed), `forward: 0`, `tank.damage=20`, 50 s of game time held
constant across dt by scaling tick count. Controller's own independent run:

| config | killsByPlayer |
|---|---|
| speed = 0.5, dt = 1/60 | **44** |
| speed = 10,  dt = 1/60 | **44** |
| speed = 10,  dt = 1/30 | **44** |
| speed = 10,  dt = 1/120 | **44** |

Speed-invariant **and** dt-invariant across the whole matrix. Before the fix the same
parked tank gave 0 hits at dt=1/60 and 110 at dt=1/30 (the reported artifact).

The reviewer investigated whether 44 indicates a still-permissive radius and concluded it
does not: seed 3's spawn cell has 4 gates, two unreachable, one routing critters *through*
the spawn cell — so ~half of all spawns walk over a parked tank by construction. 86 critters
spawn in the window; 44/86 = 51%, matching the 1-of-2-usable-gates prediction. Min-approach
distances are cleanly **bimodal** (44 critters at ~0.031–0.033, the other 42 at ~0.087) and
the radius 0.02730 sits in the gap — no marginal cases.

### Guard strength (this is where round 2 bit)

The first regression test asserted only *equality across speeds* plus a pinned kill count.
The reviewer swept the radius and found that pin **empirically blind**: multipliers 0.5×,
0.8×, 1×, 2×, 3× all yield 44 kills. It tolerated the radius being halved *or tripled* —
including the exact "3× too large" case it was added to catch. A quantized kill count is a
poor proxy for a continuous radius. Reverting the buggy line was caught **only** by the
incidental dt arm; had anyone later trimmed that arm as redundant, C-1 would have been
guarded by nothing.

Fixed by exposing `tankContactRadius` on `World` and asserting it directly. Sabotage
results after the fix:

| sabotage | outcome |
|---|---|
| radius × 3 | C-1 test **FAILS** — `contact radius 0.0819… drifted from the derived ~0.027` (previously passed) |
| revert to `0.5 * tuning.get('tank.speed') * dt` | C-1 test **FAILS** — dt-invariance broken: 44 vs 110 |

---

## I-1 — heartHits gating and god-mode symmetry

**(a) Post-mortem.** `heartHit()` and the HP decrement are gated on `heartHp > 0`; the
now-unreachable `if (heartHp < 0) heartHp = 0` clamp was dropped. `leaks` keeps counting
past death, preserving the honest leak-vs-hit distinction.

**heartHits after gating — measured** (seed 42, 6000 ticks, default tuning, tower at heart):

```
heartHits = 20   leaks = 44   heartHp = 0
```

Exactly `HEART_MAX_HP`. **Bounded — yes.** Was 44 (24 phantom post-mortem hits, 55%).

**(b) God mode.** `telemetry.heartHit()` is now unconditional, matching `tankHit`, the file
header at `world.ts:25`, and spec §5. HP mutation and the death stamp remain gated.

Reasoned interaction, since two gates now compose: under `god.heartInvulnerable`, `heartHp`
never decrements, so `heartHp > 0` is permanently true and `heartHit` fires on every leak,
unbounded (measured: `heartHits=44, leaks=44, heartHp=20`). This is correct — the
post-mortem gate exists to suppress hits on a *dead* heart, and under god mode the heart
never dies, so there is no phantom window to suppress. It is exactly symmetric with
`tankHit`, likewise unbounded under `god.tankInvulnerable`. Worth knowing, not a defect:
under god mode `heartHits` becomes an exact duplicate of `leaks` and stops being an
independent signal in that mode.

**Tests re-specified, not weakened.** `liveness.test.ts` and `world.test.ts` both asserted
`heartHits === 0` under god mode — that encoded the bug. Changed to `heartHits > 0` with
justification comments citing spec §5. `equal(0)` → `ok(>0)` is a strictly different
assertion and fails on the old code. The HP-unchanged assertions were kept in both.
`docs/02-M0a-brain-notes.md` updated to match.

**Round 2 found this gate had zero coverage** — the reviewer removed the `heartHp > 0` gate
and all 147 tests stayed green. A regression test was added. Sabotage after the fix:
removing the gate fails exactly 1 of 16 world tests, the I-1 test
(`heart should have died on this config; -34 !== 0`).

---

## I-2 — SATURATING emptied, and the exclusion genuinely removed

`SATURATING` is now `new Set<string>()`. All four entries deleted; `tower.damage` and
`tank.damage` moved to `COMPANION_OVERRIDES` with `{'enemy.hp': 20}`.

**The first attempt did not actually deliver this, and the round-1 review caught it.** The
upper-half gate read `if (!SATURATING.has(k) && !COMPANION_OVERRIDES[k])` — membership in
`COMPANION_OVERRIDES` *suppressed generation of the upper-half test entirely*. So the two
damage levers still had zero upper-half coverage; the exclusion had merely moved from one
skip-list to another, and `SATURATING` being empty was cosmetic. The enabling defect was a
false rationale comment ("the companion is not swept with the mid value, contaminating the
comparison") — wrong, because the companion is a fixed override applied identically to both
arms. That comment was deleted, and the companion is now threaded into both arms.

**Liveness with SATURATING empty: PASSES — 47/47.** Controller-verified census:

- 28 levers total − 4 render-only − 2 god = **22 eligible**
- **22 `in upper half` tests generated**, 1:1, all passing
- `lever tower.damage is live in upper half` and `lever tank.damage is live in upper half`
  confirmed present in the live output by grep (they did not exist after `ad5a3bb`)
- Bonus: `enemy.reactionDur` gained upper-half coverage from the same fix

**No lever genuinely fails the upper-half gate.** Nothing was re-excluded to make the gate
pass. The reviewer's independent check confirmed the two damage levers differ substantially
across the upper half with the companion (`tower.damage`: 13 summary fields differ,
kills 0→8; `tank.damage`: 15 fields differ, playerKillShare 1→0.73).

---

## Minors

- **TTK comment.** `telemetry.ts` no longer claims ttk "excludes contact-kills with no prior
  hit" — false, since `hitCritter` stamps `firstHitAt` before applying damage, so a one-shot
  records ttk = 0. Option A taken (recording 0 is defensible). The three unreachable
  `? … : null` branches removed. Follow-on residue also cleared: `telemetry.kill()` was
  still typed `ttk: number | null` with a dead null check — narrowed to `number`.
  `telemetry.test.ts` updated accordingly; the reviewer confirmed this was legitimate
  re-specification, not weakening (the old `ttk.length === 2` asserted a null-filter that is
  now unreachable by construction and no longer expressible). The ttk=0 one-shot contract,
  previously documented in three comments and asserted nowhere, now has a test.
- **`enemy.hp` comments.** `world.test.ts:100,113` corrected 10 → 5. Two further instances
  of the same stale comment were found and fixed. No `default 10` remains in `src/` or `docs/`.
- **`world.ts` derivation comment** corrected twice: the mesh point count (the source figure
  was wrong, and the first correction was also wrong — actual `mesh.centers.length` is
  seed-dependent, measured 2640–2696 over seeds 1–40), and the overclaim "prevents
  spawn-adjacent auto-kills regardless of seed", which C-1 makes true for a *stationary*
  tank only — a tank moving at speed 10 displaces ~0.167/tick, sweeping ~0.083 > the 0.047
  minimum gate-to-spawn distance. Now qualified.
- `assert.ok(heartHits <= 20)` tightened to `assert.equal(heartHits, 20)` so an
  *under*-counting regression cannot slip through; duplicate `run(10, 1/60)` evaluation removed.

---

## Cross-process determinism

**PASS.** Two separate `node` invocations, seed 42, 6000 ticks, tower placed, scripted input:

```
bytes A: 505   bytes B: 505   cmp: identical   md5 1eb4d9673f109b2999ce943a9d1dfaa1
```

Non-empty output asserted before comparing — the ledger records a prior determinism check
that passed **vacuously** on 0 bytes. 505 bytes each, so this one is real. C-1 changed the
contact path, so this was not a formality.

`src/core/` purity re-confirmed: no three.js, no `Math.random`, no DOM or wall-clock
(only comments match those strings).

---

## Verification summary

| check | result |
|---|---|
| `npm run typecheck` | clean, no output |
| `npm test` | **151 pass / 0 fail** (was 144) |
| `node --test src/core/liveness.test.ts` | **47 pass / 0 fail** (was 44) |
| upper-half census | 22 eligible levers → 22 tests, 1:1 |
| parked-tank speed-invariance | 44 at every speed × dt cell |
| heartHits bound | 20 = HEART_MAX_HP exactly |
| contact radius | 0.02702517752041214 |
| cross-process determinism | byte-identical, 505 bytes |
| sabotage: radius × 3 | caught by C-1 test |
| sabotage: revert C-1 line | caught by C-1 test |
| sabotage: remove `heartHp > 0` gate | caught by I-1 test |

---

## Concerns

1. **Two rounds of review were needed, and both findings were of the same species the
   milestone is about.** Round 1's I-2 attempt relocated an exclusion instead of removing
   it; round 2's C-1 pin was a metric that looked like a guard and measured nothing. Both
   are "artifact rather than the real quantity" — the exact failure C-1 and I-2 exist to
   eliminate. The pattern is durable enough in this codebase to be worth naming: a
   *syntactically* correct fix (empty set, added assertion) is not evidence of a
   *semantically* delivered one. Only sabotage established either.

2. **Implementer reports overclaimed twice.** Round 1 asserted two named tests existed that
   did not; round 2 asserted the baseline pin caught radius drift independently, which the
   sweep disproved. Both were caught by reviewers re-running the claims. This matches the
   process lesson already in the ledger from Fix-A. Report claims in this project should be
   treated as hypotheses until independently re-run.

3. **Under god mode `heartHits` duplicates `leaks` exactly.** Correct per spec §5 and
   symmetric with `tankHit`, but it means the headline difficulty metric carries no
   independent information in the mode you would use to tune difficulty. If a
   "damage actually applied" signal is wanted later, add it under its own name
   (`heartDamage`) — never by redefining `heartHits` again.

4. **`tank.damage=20` vs `enemy.hp=5` means every contact one-shots in the C-1 test**, so
   the kill count is saturated at "every critter that walks over the tank". The direct
   radius assertion now covers drift, so this is no longer load-bearing — but the kill-count
   arms of that test are coarser than they look, and should not be trusted alone if the
   direct assertion is ever removed.

5. Not pushed, per instruction. The report file is gitignored (`.superpowers/`), so its
   corrections live on disk only; the code commits carry the substance.
