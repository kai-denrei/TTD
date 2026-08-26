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

## 6. Still missing for PoC parity

Chunk 2 (**combat made visible**) — `spawnTowerShot` with homing and arced
projectiles, `makeTracer` trails, `spawnBeam` hitscan beams, muzzle flashes, hit
flashes, death bursts; tank aimed fire along its barrel, and the twin-laser heat
and lockout model (`LASER_MAX_HEAT` 2.4 s, cool 1.4).

Chunk 3 (**roster & economy**) — typed towers with distinct attacks, cost,
sell, upgrade, range rings, and `economy.js`.

Then, and only then, the economy-and-win-condition work that started this
session.
