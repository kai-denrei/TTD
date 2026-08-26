# M0c — Notes: PoC Parity

**Status:** chunk 1 of 3 complete. 2026-08-26.
**Tests:** 265 passing (from M0b's 239), `tsc --noEmit` clean, determinism PASS.

---

## 0. Why M0c exists

The operator's report after using M0b: *"currently there is no gameplay as far
as I can tell, towers don't fire or it's hard to tell, the green unit is
supposed to be the tank? but its turn left/right seem inverted."*

All three were true. M0b rendered **state** but not **events** — the sim
resolved tower damage, kills and hits every tick and the renderer drew none of
it. A tower killing something was literally invisible.

An earlier plan for this session was an economy and a win condition, to give
difficulty a cost to trade against and a success to measure toward. That was
premature: **you cannot balance what you cannot see or steer.** PoC parity comes
first, in three chunks:

1. **Walls & high ground** — done, this document.
2. **Combat made visible** — tower shots, tracers, beams, muzzle flashes, hit
   flashes, death bursts; tank aimed fire.
3. **Tower roster & economy** — types with distinct attacks, cost, sell,
   upgrade, range rings.

---

## 1. The baseline break that wasn't

The M0c-1 spec warned that moving the baseline tower from the heart onto high
ground would **shift every telemetry baseline**, voiding M0a/M0b numbers. It was
called out as a real, accepted cost.

**It did not happen.** Sweep rows are byte-identical to M0a's:

| `enemy.speed` | `survivedFor` (M0a) | `survivedFor` (M0c-1) |
|---|---|---|
| 0.6 | 61.57 | 61.57 |
| 1.3 | 43.88 | 43.88 |
| 2.0 | 37.15 | 37.15 |

The tower genuinely moved — seed 42, cell **1258 (ROOM) → 1305 (BLOCKED)**,
0.063 away — and `placeTower(dungeon.heart)` now correctly returns `false`. So
this is not a change that failed to apply.

**The reason is worth more than the baseline was.** At default stats the tower
is so weak that its position is irrelevant:

| tower stats | on the wall overlooking the lane | on a distant wall |
|---|---|---|
| defaults | `survivedFor` 48.33 | 46.35 |
| `tower.damage=20` | 87.53 | 46.35 |
| `tower.damage=20, tower.rate=0.2` | **100.00** (survived) | 46.35 |

So **tower placement is currently a decision with no consequence** — a 4% spread
at default stats. Make the tower strong enough and position swings survival by
89%. This sharpens `CLAUDE.md`'s standing note: the one-tower baseline is not
merely weak, it is weak enough that *where you build does not matter*.

Note the distant-wall column: 46.35 regardless of stats. A tower away from the
lane contributes nothing however good it is.

---

## 2. A dead lever the tank fix uncovered

Fixing the tank's turn inversion changed its path, hence which critters it
killed, hence the shared critter RNG stream — M0a brain-notes §2's documented
comparability hazard. That shift made `tower.rate` fail its upper-half liveness
check.

The failure is **real, not incidental**. At default `tower.damage` 3 against
`enemy.hp` 5, a kill needs two hits on one critter; above ~2 s between shots the
critter leaves range before the second. So the tower kills nothing, and every
slow rate is indistinguishable from every other:

```
rate 0.2   kills 13   towerKillShare 0.615
rate 2.6   kills  4   towerKillShare 0.000
rate 5.0   kills  4   towerKillShare 0.000     <- byte-identical to rate 2.6
```

Handled with a `COMPANION_OVERRIDE` (`tower.damage=20`, applied to both arms so
the lever under test stays the only difference), matching how `tower.damage` and
`tank.damage` are already handled — **not** with an exclusion. With damage 20 the
lever is plainly live: 10 kills at 2.6 s against 8 at 5.0 s.

**The guard passed before only by luck.** The lever's upper half was always this
marginal; the RNG shift stopped hiding it. That is the liveness gate doing its
job — and it is the third lever whose observability is limited by one root
cause: **the default tower is too weak to complete a kill.**

---

## 3. What the screenshots taught, that no test could

**Terrain must stay under the bloom threshold.** Brightening the floor so
corridors would pop pushed it past the 0.5 threshold, at which point the terrain
itself bloomed and clipped to white — losing both its colour *and* its relief,
worse than the dark version it was meant to fix. Bloom is for emissive things:
units now, shots and impacts in chunk 2. The board is deliberately dim and reads
by **contrast of relief** rather than brightness.

**Walls broke the chase camera.** At the old rise of 0.075 above a surface whose
walls are 0.045 tall, any wall between camera and tank swallowed the tank
entirely — in the main driving view. Rise is now 0.14, roughly 3× wall height.

**`WALL_HEIGHT` is 0.045, not the PoC's 0.03.** At 0.03 the relief vanished from
the orbit cameras and the board read as flat colour. 0.045 is ~0.66 of a cell
(mean chord 0.068) and still low enough for the chase camera to see over.

**Only ~26% of walls are buildable** — 509 of 1964 on seed 7 — and nothing said
which. You tapped the rock and nothing happened, with nothing to explain why.
Buildable high ground now carries a distinct top tone, so the placement rule is
readable off the board instead of discovered by trial. Verified live: 5 of 6
clicks on the lit rim placed towers; the miss was open floor, correctly refused.

---

## 4. Triangle budget

| Surface | Triangles |
|---|---|
| floor | 1,396 |
| wall tops | 3,928 |
| skirts | 1,388 |
| **total** | **6,712** |

M0b's flat board was 5,324, so the third dimension costs **+26%** — not the
tripling a naive extrusion would have.

The skirt filter is why. Skirting every wall edge instead of only BLOCKED↔open
edges would emit **15,712** skirt triangles against the actual 1,388: the filter
removes 14,324 triangles, a **91% reduction**, all of which would have been
buried inside solid rock. Its expected count is derived from the dungeon rather
than observed from the build, so a regression fails rather than drifts.

---

## 5. The spec correction, reverted

The M0b closeout "corrected" spec §7 from *"wall cells"* to *"open cells"*,
arguing a BLOCKED cell was unreachable by the nav graph and unpickable by the
raycast. **Both were true only because M0b had not built walls** — the
correction adjusted the spec to match a gap in the implementation rather than
the design.

Spec §7 is restored, with the PoC's rationale attached so this is not
"corrected" a third time: *walls carry no enemy pathing, so a tower on one can
never dam a lane* — which is precisely why placement needs no connectivity
guard. Open-cell placement would reintroduce that problem.

---

## 6. Chunk 2 — combat made visible

### 6.1 The root cause was a missing channel, not missing particles

M0b rendered **state** and not **events**: the world resolved damage, kills and
hits every tick and discarded all of it, exposing only surviving positions. A
tower killing a critter was a state transition with no visual trace. So chunk 2
started with an event buffer (`core/sim/events.ts`) — every effect hangs off it.

The buffer clears at the **start** of each tick rather than on drain, because a
headless sweep has no renderer and draining is not guaranteed. Asserted: 3,000
undrained ticks hold fewer than 64 events.

### 6.2 Two calibration bugs found only by running it

**Shots tunnelled through critters.** At the default speed a shot advanced 0.02
per tick against a 0.02 hit radius, so the point test sampled straight past its
target. Fixed with a swept floor scaled to the actual step — the same fix, and
the same reason, as the tank's contact radius in `world.ts` step 8d.

**`projSpeed`'s range was wrong by a factor of ~5.** It was carried over from
the PoC's `16 × cellSide ≈ 1.1` without checking it against *this* project's
speed scale. Measured here: critters move **0.67 u/s** at `enemy.speed` 1 and
**2.83 u/s** at 3.0. The original default of 1.2 meant a shot could not catch
anything above `enemy.speed` ≈ 1.4 — the tower fired and the critter simply
outran it. Default is now 6.

**Lesson worth keeping:** a constant ported from the PoC is in the PoC's units
until proven otherwise. Measure the local scale before adopting the number.

### 6.3 The baseline moved, hard — and one number went to zero

| `enemy.speed` | `survivedFor` M0c-1 | M0c-2 | kills | `playerKillShare` |
|---|---|---|---|---|
| 0.6 | 61.57 | **40.35** | 6 → 1 | **0.00** |
| 1.3 | 43.88 | **28.25** | 7 → 1 | **0.00** |
| 2.0 | 37.15 | **36.17** | 5 → 2 | 0.50 |

Damage now lands late and can miss, so the game is materially harder.

**`playerKillShare` reading 0.00 is aimed fire working correctly, not a bug.**
The scripted patrol sweeps its heading with `sin(k/30)` and drives back and
forth; it never points at anything. With a 45° fire arc it therefore has no
target most of the time, and kills nothing.

That is realistic — a tank that does not aim does not kill — but it has a
consequence worth deciding on deliberately: spec §5 calls
`player-kills vs tower-kills` "the sharpest single number in M0", and it is now
**uninformative for any scripted run**. Two ways forward, neither taken yet
because it is a design call rather than a fix:

- give the patrol script a "turn toward the nearest critter" behaviour, at the
  cost of a scripted tank that aims better than a person would; or
- accept that `playerKillShare` is only meaningful in **played** sessions, and
  read it from the live telemetry pane rather than from sweeps.

### 6.4 Five levers, one root cause

Adding heat and aimed fire pushed two more levers into the dead zone, bringing
the running total to five whose observability is limited by the same thing:
**the default offence is too weak to complete a kill.**

- `tower.damage`, `tank.damage` — need `enemy.hp = 20` to be testable
- `tower.rate` — needs `tower.damage = 20`; at default damage the tower kills
  nothing above ~2 s between shots
- `enemy.hp` — at default offence, `enemy.hp = 20` yields exactly **0 kills**,
  so its upper half compared zero against zero
- `wave.hpGrowth` — needs the **opposite** companion: damage low enough that HP
  still matters. Measured live at damage 6 and 8, dead at 10+, where everything
  is one-shot and growing HP changes nothing. Its companion is **7**, the centre
  of that band — not an edge, because a lever sitting at the edge of its
  observable region goes dead on any unrelated RNG shift. That is how
  `tower.rate` died.

Both heat levers read dead for a different reason: the harness pulsed fire 1
tick in 5, adding 0.2 heat/s against 1.12/s of cooling, so heat never
accumulated and the levers were being tested outside the domain they exist for.
Both harnesses now **hold** fire, which is the realistic stress and is
self-limiting precisely because lockout exists.

### 6.5 What still is not good enough

Combat is now unmistakably visible — muzzle flashes, tracers in flight, hit
flashes, death bursts, tank beams — and `bloom.strength`'s default rose 0.8 →
1.5 to give it punch, which is safe because only emissive things cross the
threshold.

But the scene is still **dark overall**, and the effects read as tasteful rather
than impactful. Hitstop, damage-scaled shake and audio are what would actually
sell a hit, and all three are M3. The `fx.flashDur` and `fx.burstSize` levers
exist so this is tunable rather than baked, and that is the right place to leave
it until the feel pass.

---

## 7. Chunk 3 — the roster, the economy, and the light

### 7.1 What landed

Eight towers with six structurally different attacks (spread fans pellets, the
mortar lofts and detonates on arrival with splash, the slow field touches every
critter in range at once, the laser is hitscan). Twelve enemy types with their
own speed, HP, bounty, leak cost, colour and size, plus on-hit accel/slow and
regen. Credits, a kills-only economy with a streak multiplier that any leak
resets, tower cost/sell/upgrade, range rings, a shop, a build phase, a tower
unlock ladder, and a win condition.

Both references agreed on the numbers, so the roster is a settled design rather
than a guess — the PoC's `towers.js`, `economy.js` and `enemyspec.js` are pure
modules that ported near-verbatim.

### 7.2 The damage-scale bug

The first roster rescaled damage and HP **independently** onto TTD's range,
which broke the one property that matters: the baseline tower went from killing
a default critter in ~2 hits to needing 6, towers stopped killing anything, and
`tower.damage` and `tower.range` both read DEAD in liveness.

What has to be preserved is the **damage-to-HP ratio**. 14 damage against a
20 HP enemy is two shots; 2.52 against TTD's 5 HP default is the same two
shots. A test now pins "two shots to kill a default critter", so the scale
cannot drift again.

**The general lesson, twice learned this milestone:** a constant ported from
another project is in *that project's* units until proven otherwise.
`tower.projSpeed` had the same failure — carried over as ~1.1 when critters
here move up to 2.83 u/s, so a tower fired and the critter simply outran the
shot.

### 7.3 The board was gamma-crushed, and paint could not fix it

The board read as near-black from M0c-1 onward, and three separate attempts to
fix it by choosing brighter colours failed. Measuring instead of eyeballing
settled it: rendering a probe surface at a known value and sampling actual
pixels showed the input-to-screen curve is compressive and **saturating** —
0.3 in renders at 30/255, 0.7 at 52, and 0.9 *also* at 52.

Values written into a vertex-colour buffer land on screen at roughly `v^2.2`.
`screenTone()` pre-applies the inverse so the constants say what you will see.
Mean board brightness went 34/255 → 41, with the maze relief legible for the
first time.

Two things broke on the way, both worth recording:

- **`OutputPass` is not the missing piece it looks like.** It was added on the
  obvious reasoning that a post chain needs one. The white-surface probe showed
  the opposite: without it white renders white, with it white renders dark grey.
  The renderer already converts on the final blit. It is now absent with a
  comment saying why and how to re-test.
- **The bloom threshold measures BUFFER values, not screen values.** Gamma
  pre-compensation raises buffer values, so at the old threshold of 0.5 the
  terrain bloomed and washed the board to fog. Threshold is now 0.88, above the
  terrain; units and effects carry 2.8x and 3.4x emissive multipliers to sit
  well above it. The board stays matte and only what matters glows.

### 7.4 Standing findings

- **An aiming tank dominates.** Teaching the scripted patrol to aim revived
  `playerKillShare` from a pinned 0.00 — and immediately showed the tank taking
  70–100% of kills before the roster landed, 28–67% after. Vision §0 asks
  whether the board is wallpaper; with a competent aimer it nearly was.
- **Sweep `playerKillShare` is an UPPER BOUND.** The scripted aimer is perfect
  and never panics.
- **Two levers are in SATURATING for the same reason:** `eco.streakCap` and
  `wave.winAt` are long-run mechanics measured by a short run. A 50-second
  harness run reaches wave 3 with a best streak of 4, so caps and win targets
  above that are equally unreachable. Narrowing their ranges to fit the harness
  would let the rig's convenience dictate the game's shape.
- **Five levers need companion overrides** because the default offence cannot
  complete a kill. `wave.hpGrowth` needs the *opposite* companion to the others
  — damage low enough that HP still matters — which is what shows this is a
  defaults problem rather than a test problem.

---

## 8. Still missing for PoC parity

Chunk 2 is done. Not carried over from the PoC: **splash damage and mortar
arcs**, which belong with the tower types that use them, in chunk 3.

Chunk 3 (**roster & economy**) — typed towers with distinct attacks, cost,
sell, upgrade, range rings, and `economy.js`.

Then, and only then, the economy-and-win-condition work that started this
session.
