# Braille half-dotted asset library — index & integration

2026-08-26. Source: `~/Dev/Braille/fun-shapes/index.html` — ~150 point-cloud
generators, all inline in one vanilla-JS file, no build step.

## Why this matters

The library is the visual identity of the whole project, and it is *far* richer
than the PoC used (the PoC pulled maybe a dozen). Everything here is pure math
with no DOM or three.js coupling, so it lifts into `core/` and is Node-testable
— the models can be unit-tested for point count, bounds and determinism like
any other core module.

## Conventions (shared by every generator)

- Signature `xxxPts(n?) -> Array<[x,y,z] | [x,y,z,hi]>`.
- `fitUnit(pts)` normalises to **unit radius**, centred on the origin, **+Y up**,
  and preserves the 4th element.
- **`p[3] === 1` = a highlight dot** — rendered larger/brighter. Used for muzzle
  flares, spike tips, eye glints, crease emphasis. It is the library's only
  channel for "look here", and it's free semantic weight for gameplay
  (a muzzle, a weak point, a charge state).
- Shared helpers: `fibDir(i,n)` (Fibonacci sphere sampling), `rotY`, `normV`,
  `crossV`, `dotV`, `hsh(i)` (deterministic pseudo-random).
- Ten **treatments** apply to any generator, in object space, independent of the
  shape: spin · sway · breathe · wave · twinkle · scatter · twist · jelly ·
  orbit · draw-on.

## Catalogue by category

Counts are model counts, not point counts.

| Category | n | Notable members |
|---|---|---|
| **Turrets** | 6 | `turretPts` · `turretTwinPts` · `gatlingPts` · `railgunPts` · `howitzerPts` · `ciwsPts` |
| **Sentries** | 13 | `senTripodPts` · `senMinigunPts` · `senNavalPts` · **`senWalkerPts`** · `senHowitzerPts` · `senFlakPts` · `senRailPts` · `senDomePts` · `senSiegePts` · **`senHexPts` / `senHexTwinPts` / `senHexSiegePts` / `senHexMissilePts`** |
| **Tower structures** | 12 | `twPylonPts` · `twLatticePts` · `twMonopolePts` · `twGuyedPts` · `twHexPts` · `twCellPts` · `twBroadcastPts` · `twEiffelPts` · `twSkytreePts` · `twNeedlePts` · `twWaterPts` · `twHframePts` |
| **Weapons / projectiles** | 9 | `missilePts` · `bulletPts` · `launcherPts` · `mortarPts` · `artilleryPts` · `sniperPts` · `cannonPts` · `grenadePts` · `catapultPts` |
| **Creatures / enemies** | 15 | `ufoPts` · `minePts` · `slimePts` · `invaderPts` · `spiderPts` · `batPts` · `coronaPts` · `phagePts` · `adenoPts` · `tmvPts` · `amoebaPts` · `parameciumPts` · `bacteriumPts` · `neuronPts` · `jellyfishPts` |
| **Shields / barriers** | 12 | **`shEnergyDomePts`** · **`shHexBarrierPts`** · `shJerseyPts` · `shHedgehogPts` · `shSandbagsPts` · `shTowerPts` · `shRiotPts` · `shBallisticPts` · `shHeaterPts` · `shRoundPts` · `shKitePts` · `shBucklerPts` |
| **Portals / gates** | 8 | `stargatePts` · `warpringPts` · `wormholePts` · `vortexPts` · `toriiPts` · `moongatePts` · `tesseractPts` · `riftPts` |
| **Robotic arms** | 7 | `armSixAxisPts` · `armScaraPts` · `armDeltaPts` · `armGantryPts` · `armPalletizerPts` · `armWelderPts` · `armGripperPts` |
| **Trees** | 12 | pine · parasol · oak · palm · birch · willow · cypress · spruce · baobab · cherry · bonsai · bare |
| **Primitives / abstract / origami / orbs** | ~55 | solids, maths surfaces, dice arrangements, folded paper |

Most models sit in the **600–1600 point** range; `invaderPts` (~88) and
`riftPts` (~280) are the light outliers.

## Three findings worth acting on

1. **The shields category is the force-field mechanic, already modelled.**
   `shEnergyDomePts` (hemispherical field with glowing nodes) and
   `shHexBarrierPts` (tessellated energy wall) are exactly the "set force
   fields, enemies accumulate, AoE" idea from the backlog notes — and they pair
   with `MUSTER` (vision §6.2) as attack-and-counterplay.
2. **Several sentries are walkers, not emplacements.** `senWalkerPts` (quadruped)
   and the `senHex*` family (6-legged hulls) read as *mobile* units. That gives
   an "enemy siege engine" or "ally" silhouette in the same visual language as
   the towers, without new art.
3. **Turrets vs tower-structures is a natural tier split.** The `tw*` family
   (pylons, lattice masts, Eiffel/Skytree) read as *infrastructure* — big,
   static, expensive — while `turret*`/`sen*` read as *weapons*. That's a
   ready-made visual grammar for a build tree: masts as support/economy,
   turrets as damage.

## M0 picks

M0 needs exactly one of each (spec §7). Chosen for silhouette legibility at
small scale on a sphere:

- **Tower — `turretPts`** (~600 pts). Pedestal + housing + one swept barrel;
  reads as "defensive emplacement" instantly, and the barrel gives an obvious
  aim direction to animate. Runners-up: `howitzerPts` (heavier, more artillery),
  `railgunPts` (sleeker, sci-fi).
- **Enemy — `minePts`** (~650 pts). A spiked sphere reads as *hazard* at any
  size and from any angle — which matters on a sphere where you see units from
  arbitrary orientations. Its highlight dots are the spike tips, so it stays
  legible when small. Runner-up: `ufoPts` (~720, very readable but its disc
  silhouette collapses when viewed edge-on).

Deliberately **not** picking a virus/organism model for M0 despite the PoC
lineage: they're beautiful but blobbier, and M0 needs maximum legibility while
we're judging pacing, not aesthetics.

## Porting plan

Extract into `src/core/models/` as pure TS, tree-shakeable:
- `models/fit.ts` — `fitUnit` + the shared helpers (`fibDir`, `rotY`, `normV`,
  `crossV`, `dotV`, `hsh`)
- `models/towers.ts`, `models/enemies.ts`, `models/weapons.ts`,
  `models/shields.ts`, `models/portals.ts` — by category, imported on demand

Port only what a milestone needs; the file is a quarry, not a dependency. Every
ported generator gets a test: point count in range, all points within unit
radius, deterministic output, and `hi` flags only ever `1`.

**Treatments** (spin/breathe/twinkle/…) belong in `render/`, not `core/` — they
are per-frame visual poses, not simulation state. The PoC proved they're cheap
(transform-only treatments are free; per-point re-pose is ~700 points of
trivial CPU work).
