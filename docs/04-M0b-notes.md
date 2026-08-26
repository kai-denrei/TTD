# M0b — Notes: What Making It Visible Revealed

**Status:** complete. 2026-08-26.
**Tests:** 239 passing (from M0a's 151), `tsc --noEmit` clean, cross-process
replay determinism PASS.

---

## 1. What the build revealed that the spec got wrong

The honest section, in the shape of M0a's §5.

**1. `heartHits` was never measuring pressure.**
M0a's sweep tables reported `heartHits` climbing 32 → 64 as `enemy.speed` went
0.6 → 2.0, read as "faster enemies reach the heart more often". Once
`runner.ts` truncated runs at heart death, `heartHits` became **exactly 20 in
every row** — the heart's max HP. The heart can only be hit 20 times before it
dies; everything above 20 was telemetry accruing on a corpse. The climb was an
artifact of measuring longer post-mortems at lower speeds, not rising pressure.

`survivedFor` was always the real signal. `heartHits` is now excluded from the
compare metrics with the reason stated in `compare.ts`: for two runs that both
end in death it reads 20 vs 20, delta zero — a number that looks measured but
cannot move. `survived` carries what it used to imply.

**2. One tower at default tuning kills nothing at all with an idle tank.**
`CLAUDE.md` records "every current setting loses with one tower". Sharper: with
`input: 'idle'`, a tower at the heart produces **zero** kills and a run
byte-identical to having no tower. `tower.damage` 3 vs `enemy.hp` 5 needs two
shots, and the 1.0 s cooldown is longer than a critter's dwell time in range,
so damage lands and never finishes. With `tower.damage=20` (one-shot) the same
run yields 19 kills; at `tower.rate=0.2`, 31.

Note the second-order effect: `tower.range=0.6` also yields zero kills. A wider
radius makes the nearest-target rule re-acquire a different critter every shot,
so damage spreads instead of accumulating. Range is not a strict improvement.

**3. Spec §7 said towers go on "wall cells".** That was the spec's error, not
the code's. A tower on a BLOCKED cell is unreachable by the nav graph and
unpickable by the raycast — it could neither shoot nor be placed. Spec
corrected; the flag comment in `world.ts` is removed.

**4. Point size cannot be an authored constant.**
Sizes chosen to look right from orbit became a saturated white blob from the
chase camera 0.16 radii away: 500+ additive points overlapping until everything
clipped to white, destroying the dot-cloud identity exactly where it should
read best. Size is now derived from the model's own scale (0.07 of its radius,
just under mean point spacing). See §4.

**5. A decorative overlay silently ate every tower placement.**
The board is a `Group`, and a recursive raycast hit the `LineSegments` edge
overlay before the surface — an intersection with a null `faceIndex`, so every
tap bailed. No unit test could have caught this; it took driving the real app
and reading back the live world. The overlay now opts out of raycasting inside
`board.ts`, beside `cellFromFaceIndex`, so the rule lives with the picking
contract rather than becoming a filter every caller must remember.

---

## 2. First data for the layer-balance pane

**This telemetry had never had a value before.** `macroShare`, `modeSwitches`
and `tankIdleUnderThreat` read 0 in every M0a sweep because nothing ever called
`world.setMacro()` — the sweep script mirrors a pure-tactical session. Vision §0
calls the macro-vs-tactical ratio the headline measurement the rig exists for.

From a browser session with two camera-family switches (`Tab` ×2):

```
macroShare           0.80
modeSwitches         2
tankIdleUnderThreat  5.78 s
decisionsTotal       1
playerKillShare      0
towerKillShare       0
```

**Reading it.** `macroShare 0.80` is what the camera family now measures: build
family = macro, tank family = tactical. The number is honest but not yet
meaningful as balance evidence, because it reflects how long the *screenshot
script* sat in each family, not how a player distributes attention.

`tankIdleUnderThreat` equalling the full elapsed time is the finding worth
carrying into M1: with no touch input driving and no keyboard held, the tank
does nothing while enemies are alive — which is precisely the failure mode
vision §8 says the design must avoid, and exactly why the unseeable threat
(§7.3) exists. The rig can now see it.

**What this pane still cannot tell us:** nothing here is a *played* session by a
human. These are first values, proving the pipe carries data, not a balance
verdict. A real reading needs a person playing, which M0b now makes possible
for the first time.

---

## 3. Render-lever liveness: what is proven and what is not

`liveness.test.ts` carried `bloom.strength`, `bloom.radius`, `bloom.threshold`
and `shake.amount` in a `RENDER_ONLY` exclusion set with the note "will be
confirmed live in M0b". That note is now discharged.

**Proven mechanically** (`render/bindings.test.ts`, in `npm test`, no browser):
each render lever has exactly one declared binding; min and max leave the render
target in different states; `readRenderState` re-reads every key each frame and
never caches. Verified by sabotage — making the `bloom.radius` binding a no-op
fails both the effect and the per-frame-read assertions, and both pass on
restore.

**Not proven by any test, and checked by eye instead:** that three.js honours
the property once written. Both were checked in a headless browser during the
acceptance pass:

| Lever | Check | Result |
|---|---|---|
| `bloom.strength` | 0 vs 3, same frame otherwise | At 0, critters are flat dark dots with no halo. At 3, every unit has a visible glow, the tank reads green and the heart blooms. **Honoured.** |
| `shake.amount` | 0 vs 2, trauma applied every frame, camera x sampled 40 frames | stddev **4.4e-16** (floating-point zero) at 0; **0.040** at 2. **Honoured.** |

A headless pixel-diff harness remains deliberately out of scope. The gap is
narrow and now measured; it is not hidden.

---

## 4. Rendering notes

**Board.** Non-indexed geometry, ~16k vertices. Vertices are shared between
adjacent quads, so per-vertex colour bleeds one cell's dungeon tag into its
neighbours; duplicating per face gives each cell a flat exact colour for
nothing. Fan-triangulation is generic over polygon size because the mesh
pipeline merges cells and a stray 5-gon must not throw.

**Units.** One pooled `Float32Array` per unit type with `drawRange`, allocated
once. Peak M0 load is ~13.7k points, where instancing with a custom shader
would be more machinery for no measurable gain. Capacity is a hard ceiling that
warns once: a reallocation stall mid-wave is worse than a missing dot. The
ceilings (200 critters, 64 towers) were never approached — `peakConcurrent`
topped out at 16.

**Point size is derived, not authored** — 0.07 of the model's radius. See §1.4.
Per-point *size* for highlights would need a custom shader; M0b uses brightness
instead, which still pushes highlights past the bloom threshold so the Braille
library's "look here" channel survives.

**Model counts are asserted exactly** — turret 590 points / 1 highlight, mine
490 / 26 — derived from generator structure rather than observed from a run, so
a silent change to a ring count fails rather than drifts.

---

## 5. Camera notes

Five modes in a declarative registry: `birdseye`, `raked`, `driftorbit` (build)
and `chase`, `pov` (tank). Adding a sixth is one entry.

**The pole degeneracy is the real trap.** Framing off a surface normal has a
singularity where `up` aligns with the view direction, and the failure mode is a
camera that spins. Asserted at five positions including both poles; verified by
sabotage — removing the stable-tangent fallback fails 5 tests with `cos=1`
exactly.

**Shake is deterministic** — a sine-sum over elapsed time, never `Math.random`,
so a replay stays a replay. Trauma is squared so a small knock barely registers.

---

## 6. Known state when tuning (supersedes M0a's note)

- **`survivedFor` is the difficulty signal.** Use it, not `heartHits` (§1.1).
- **Runs truncate at heart death** in both `scripts/sweep.ts` and the in-app
  compare, so `elapsed === survivedFor` for any run that died. Sweep rows are
  now comparable without normalising.
- **Every default setting still loses with one tower**, and more sharply than
  recorded: the tower gets zero kills when the tank is idle (§1.2).
- **Compare is a three-seed mean, not a truth.** Critters share one RNG stream,
  so changing a combat lever shifts survivor composition and every later
  envelope draw. Treat small deltas as noise.
- **A worked example** (`wave.dripRate` 0.15 → 1.60, three seeds, truncated):
  `survivedFor` 18.66 → 63.84 (**+45.19**), `peakConcurrent` 11 → 3.33 (−7.67),
  `kills` 1.33 → 9.33, `waveClearMean` 3.53 → 16.91. Burst spawning kills the
  heart in under 19 s; trickle survives more than three times as long. This is
  spec §9.8 satisfied: two settings, one better, cited by number.

---

## 7. What M0b did not do

- Gate visuals. The design's §2 table lists a ring of highlight dots per spawn
  gate; `units.ts` does not draw them. Gates are cosmetic in M0b and spawn
  points are obvious from where critters appear — dropped deliberately, not
  missed.
- Model treatments (spin, breathe, twinkle), audio, hit feedback, beat cameras
  and `intensityFraming` — all M3, and beat cameras need sim events that do not
  exist yet.
- A dedicated tank model. The tank re-tints the turret silhouette; a real model
  is M1.
- A headless pixel-diff harness (§3).
