# TTD — Tank Tower Defense · umbrella design

**Status:** living document. Working name. Started 2026-08-26.
**Predecessor:** `~/Dev/spherical-stalberg-grid` — kept as the PoC it was, not migrated in place.

> This is the vision + lever taxonomy. Buildable specs live beside it as
> `NN-<topic>-spec.md` and are written one at a time, each shippable alone.
> **§12 is the inbox** — pasted notes land there before they're folded in.

---

## 0. What the game is

> **A mix of passive TD macro strategy with some tactical tank battle
> elements, and retro/gaming homage and nostalgia for story-driven
> minigames.** — operator, 2026-08-26

Three layers, three tempos, and they are *supposed* to feel different:

| Layer | Tempo | The player is… | Intensity comes from |
|---|---|---|---|
| **TD macro** | slow, deliberate | planning, reading the board, committing resources | consequence, not pressure |
| **Tank tactical** | fast, hands-on | driving, aiming, intercepting | the moment — this is where stress lives |
| **Minigames** | a held breath | inside a story beat | homage, novelty, stakes |

This resolves a tension the design has been carrying. Earlier work tried to
make the **TD layer itself** relentless — drip spawns, overlap, never-wait
pressure. But if the TD layer is *supposed* to be passive macro strategy, then
cranking it is fighting the genre: the board's job is to give you decisions
with consequences, and the **tank** layer's job is to supply the adrenaline.
"Not fun yet" may be less a tuning failure than a misassigned load.

Practical consequences:
- **Pressure is layered, not global.** The macro layer can breathe (clear-gated
  waves, a real anticipation beat) *while* the tactical layer is dense, because
  they're different clocks. §6.1's per-wave program should modulate both.
- **Mode-switching is the core loop, not a feature.** Anything that forces you
  off the board and into the tank (§7.3's unseeable threat) is load-bearing.
- **Minigames carry story and homage** — they are a pillar, not a reward
  mechanic bolted on. Paradroid, Trace, terminal hacking: the nostalgia *is*
  the point, and it's the layer that carries narrative.
- **The rig must measure the balance between layers**, not just enemy
  difficulty: time spent in macro vs tactical, switches per wave, and whether
  the tank is doing something meaningful or just idling (§8).

## 1. Why a new project

The PoC proved the hard things: an organic quad grid on a sphere, a dungeon
carved over its cell graph, dot-cloud creatures, planet tank combat, a
tower/economy layer. It also accreted — `td-tab.js` reached 3,870 lines with
four cp+sed sibling tabs, and the architecture we want (a pure, tested brain
under a thin shell) is not reachable from there by refactoring.

The PoC stays alive as a reference implementation and a diff target.

**What TTD actually is:** less a new game than an *integration project with a
new brain*. Most of the parts exist and are proven; what's missing is the
thing that makes them fun — pacing, critter intelligence, and a way to tune
both.

---

## 2. The problem being solved

The PoC's moment-to-moment isn't fun. Two recon passes (HokorobiTawaa
autopsy + our own tuning-surface audit) located it precisely:

| | HokorobiTawaa | PoC |
|---|---|---|
| Spawn | **drip** — per-type intervals 0.35–1.8s | one instant burst |
| Waves | never wait; overlap freely | wait for a full clear |
| Speed variance | re-rolled every 0.6–1.5s, 0.4×–1.4× | smooth sine, ±30%, 4 types |
| Group behaviour | aura leader (1.4× to neighbours) | **none** |
| Enemy speed dial | authored per type | `ENEMY_SPEED = 1.0` hardcoded |
| Post-processing | UnrealBloom 0.9 + additive everywhere | **deliberately deferred** |
| Audio | full Web Audio synthesis (DeepWatch) | **none at all** |
| Tuning | authored constants | ~24 params, nearly all needing a rebuild |

Four root causes, in leverage order:

1. **Burst spawning.** A wave arrives as one lump, then silence. HK braids
   several drip rhythms per wave, so pressure is continuous and legible.
2. **No group behaviour.** Every critter is independent; a crowd moves like a
   conveyor belt, never like a threat with intent.
3. **Nothing is tunable live.** You cannot find fun you cannot reach — most
   knobs need a world rebuild, and the most important one (enemy speed)
   doesn't exist.
4. **No feel layer.** No bloom, no audio, no shake. HK's dread is *implicit* —
   the player projects it onto a saturated, noisy board. We give them silence.

---

## 3. Provenance — what comes from where

Nothing here is speculative; all of it is built and working somewhere.

| Source | Brings | State |
|---|---|---|
| **spherical-stalberg-grid** | sphere pipeline (`grid.js`), `dungeon.js`, `cellindex.js`, `creatures.js`, `units.js`, `looks.js`, `towers.js`, `enemyspec.js`, `economy.js`, **`tanks2.js`** (planet tank combat) | proven, Node-tested |
| **DeepWatch** (`~/Documents/Dev/centroid-defense`) | **Web Audio stack**, orbital strike (charge → commit ritual → 2.4s descent → falloff), radar PPI (3s sweep, blip decay, trails), wave-end stats, bestiary codex | implemented, playable |
| **HokorobiTawaa** | drip-spawn pacing, speed-multiplier math, bloom/additive look, HP-scale curve | reference (read, don't port) |
| **hacking-mini-games** | **TRANSFER** (Paradroid duel), **TRACE** (node capture vs tracer), **CONSTELLATION** (parallax point cloud) + the `MiniGame` session contract | implemented, Vite+TS+three, embeddable as-is |
| **Braille** | dot-cloud / halftone glyph renderer | shared by both projects |
| **New** | tuning rig, posture minds, swarm, wave programs, thermal view, stealth threat | — |

`tanks2.js` matters more than it looks: the "portal dive → small planet with a
tank guarding a terminal" is *already built*. The dive is a win-condition and a
frame around a shipped game.

---

## 4. Stack

**Vite 6 + TypeScript 5.7 + three 0.170** — matching `hacking-mini-games`
exactly (`three ^0.170.0`, `@types/three`, `vite-plugin-pwa`).

Two reasons, both concrete:

1. **The minigames become native imports.** They're already this stack, with a
   renderer-agnostic contract. Matching means zero porting for three finished
   games.
2. **Types catch the class of bug that actually bit us.** One PoC session
   produced four defects TypeScript would have caught at compile time: a
   dangling `towerUnlockRound` export, `COL.hintFlash` never defined, `sp.type`
   read after portals were de-typed, and `TICKS[shape]` referencing a deleted
   parameter. All four came from a module written in isolation against an
   interface it couldn't see. That failure mode scales with the codebase.

Cost accepted: a build step, and DeepWatch's vanilla JS needs porting (Vite
consumes plain JS, so this can be incremental).

**Post-processing is foundational, not polish.** EffectComposer + UnrealBloom +
additive blending go in at the start. The PoC's decision log explicitly
deferred this ("the 6-module EffectComposer cost deferred until a look earns
it") — and a large part of "HK feels better" is that deferral.

### Migration policy
Ported, not copied. The sphere pipeline's *mathematics* is the asset
(hull-as-Delaunay, tangent-plane relax, incremental merge, voxel-hash
sampling); its API surface is PoC-grade. Each module is re-typed, its
boundaries redrawn, and its tests rewritten and extended as it lands. We do
not re-solve the geometry; we do re-draw the seams.

---

## 5. Design pillars

1. **Legible intent.** A critter's posture should be readable at a glance —
   stalking, gathering, committing. Threat you can read is threat you can play
   against.
2. **Difficulty is a gap the player chooses** (§9), not a curve we author.
3. **Everything is a lever.** Behaviours are weights on one machine, not
   bespoke features. If it can't be tuned live, it isn't done.
4. **The board cannot solve everything.** Some threats require *you* — that's
   what makes leaving the tower screen meaningful (§7.3).
5. **Feel is a system.** Bloom, audio, camera and shake are designed in, not
   bolted on.
6. **Deterministic.** Seeded RNG everywhere; no `Math.random` in sim logic. A
   run must be reproducible for tuning to mean anything.

---

## 6. The lever taxonomy

The core deliverable. Everything below is intended to be a live-tunable value
in the rig (§8), grouped as the dashboard groups them.

### 6.1 Intensity & pacing

Pressure is a **per-wave program**, not a global dial. Each wave carries its
own shape, and the shape ramps across a planet.

```
WaveProgram {
  composition   which types, how many        (the plan)
  dripRate      seconds between spawns       0.2 – 2.0
  dripJitter    randomness on that interval  0 – 1
  overlap       0 = wait for clear … 1 = never wait
  surges[]      {atSecond, multiplier} burst moments inside a wave
  gates         which portals feed it        (spatial pressure)
}
```

| Lever | Range | Effect |
|---|---|---|
| `dripRate` / `dripJitter` | 0.2–2.0s / 0–1 | burst → trickle; jitter kills metronome feel |
| `overlap` | 0–1 | clear-gated calm → relentless rolling |
| `surgeCount` / `surgeSize` | — | spikes inside a wave; the "here it comes" beat |
| `waveGap` / `waveCap` | 3–20s / 15–60s | breath length; anti-stall force |
| `sizeCurve` | linear / knee / exponential | how counts grow across waves |
| `hpCurve` | per-wave multiplier | HK ramps 1.0 → 3.0 over 12 waves, back-loaded |
| `concurrentCap` | 0 = uncapped | performance + design ceiling |

**Authored arc per planet** (from the operator's direction):

| Waves | Mode | Feel |
|---|---|---|
| 1–8/12 | **measured** — clear-gated, one new idea per wave | teaching |
| middle | **breath then relentless** — short beat, long overlapping drip | pressure |
| final | **fully rolling** — no gaps, continuous crescendo | overwhelm |

### 6.2 Critter minds — one posture machine

Rather than N bespoke behaviours, one small mind per critter. The named
stressors become *weights*, which is what makes them tunable.

**Postures:** `APPROACH · STALK · MUSTER · RUSH · FLANK · FLEE`

**Perception** (cheap, off the nav graph the PoC already has):
- distance to heart, distance to tank
- **threat field** — BFS gradient from tower coverage (HK structurally could
  not do this; it walked a fixed polyline. This is our differentiator.)
- local ally density
- player state — cannon overheated? ammo empty? far from the heart?

| Stressor | = posture + weights |
|---|---|
| **Speed variance** | envelope on any posture: `base · surge · cadence · jitter` |
| **Stalking** | `STALK` — hold at range, match pace, wait for an opening |
| **Avoiding** | pathing weight on the threat field — route around kill zones |
| **Mustering** | `MUSTER` — hold at a staging cell until N allies gather → all flip to `RUSH` |
| **Feinting** | `STALK ↔ APPROACH` oscillation — baits shots and ammo |
| **Flanking** | `FLANK` — costlier alternate route, arrives off-axis |
| **Opportunism** | posture weights read player state — surge while you're reloading |
| **Rout** | `FLEE` on local losses, then regroup — gives your win a visible shape |
| **Leader/aura** | a `MUSTER` anchor; kill it and the gathering visibly collapses |
| **Escalation** | `accelOnHit` — damage feeds the threat (HK: 1.7–1.9× for 1.2s) |
| **Attrition** | `regen` out of combat — forces sustained fire |

**Speed envelope** (the known-good stressor, generalised):
`pace = base × spec × posture × envelope(t) × slow × behMult`
where `envelope` is re-targeted every `cadence ± jitter` seconds toward a value
in `[1-amp, 1+amp]` — HK's version re-rolls every 0.6–1.5s across 0.4×–1.4×.
Ours is currently a *predictable sine*, which is why it doesn't bite.

### 6.3 Swarm

Mustering **is** the swarm mechanic, and it self-telegraphs — watching them
gather *is* the anticipation.

| Lever | Effect |
|---|---|
| `musterThreshold` | how many must gather before the rush |
| `musterPatience` | max wait before they commit anyway |
| `cohesion` | how tightly a group holds together |
| `separation` | anti-overlap; 0 = they blob, high = a spread front |
| `contagion` | how fast posture spreads through neighbours (panic/commit) |
| `pressure` | build-up that converts to a coordinated push |

### 6.4 Player agency

| Lever / system | Notes |
|---|---|
| **Force fields** | enemies accumulate against them → AoE payoff. Deliberate counterplay to `MUSTER`: bait the pile, then delete it. Attack and answer designed as one mechanic. |
| **Orbital strike** | from DeepWatch: charge (6s) → commit ritual (safety → target → launch) → 2.4s descent → `(1-d/R)^1.5` falloff. The ritual is the point: you cannot panic-spam it. |
| **Radar** | from DeepWatch: 3s sweep, blip decay 1.5s, 3-blip trails. On a sphere you genuinely cannot see the board — this is a need, not a flourish. |
| **Thermal view** | Predator-style. Reveals stealth; can also read heat generally (recently-fired towers, wounded critters, muster points). |
| **Tower roster** | ranges, rates, damage, projectile tempo — HK's per-tower `projSpeed` identity is what stops towers feeling samey. |

### 6.5 Feel

Currently absent, in rough order of felt impact per unit of work:

1. **Audio** — DeepWatch's Web Audio stack ports as-is (geometry-agnostic).
   Includes **range-cadence pings** that accelerate as threats close: tension
   without visual attention. Pairs perfectly with a threat you cannot see.
2. **Bloom + additive** — the look, foundational.
3. **Hit feedback** — flashes, hitstop, death bursts, damage-scaled shake.
4. **Danger states** — escalation as the heart is threatened.
5. **Heart as density** — HK renders remaining life as dot-count; you *see*
   yourself dying. We already have the dot renderer.

### 6.6 Camera

| Lever | Effect |
|---|---|
| `intensityFraming` | pull toward wherever pressure is highest |
| `beatCameras` | scripted moments: muster forming, crescendo, orbital descent |
| `modeTransition` | make TD↔Tank a *beat*, not a toggle |
| shake amplitude / falloff / trauma decay | tie to damage and proximity |

---

## 7. Systems

### 7.1 The dive (portal → arena → terminal → blueprint)
Enter a portal → a small planet where a tank guards a terminal → win the tank
fight (**`tanks2.js`, already built**) → access the terminal → play **TRACE**
(already built) → steal a tower blueprint. Leaving the board earns something
that changes the board.

### 7.2 Minigame host
One host implementing the existing `MiniGame` contract:
```ts
init(config, seed) · tick(dt) · input(event) · state() · result()
Phase = PLAN | RUN | WON | LOST_SOFT | LOST_CRIT
GameResult = { outcome, margin, timeUsed, resourcesUsed, hazardsTripped }
```
`LOST_SOFT` vs `LOST_CRIT` gives asymmetric failure for free; `margin` scales
rewards by decisiveness. Build the host once, skin it for every minigame.

### 7.3 The unseeable threat — the TD↔Tank spine
A stealth unit that **towers cannot target** and that is **invisible outside
thermal view**. Reaching the heart it attempts a hack — foiled by a minigame
(TRANSFER/Paradroid), not by damage.

This is the strongest idea in the backlog because it *manufactures* the mode
switch instead of hoping the player wants one: your automated defence is
structurally useless, so you must look, drive, and act.

**Open balance question:** tank-killable once thermal reveals it, or genuinely
untouchable so the hack is the only answer? Untouchable is purer but risks
feeling unfair; revealing→targetable keeps player skill in the loop.
*Unresolved — see §12.*

### 7.4 Meta
Achievements; bestiary codex (DeepWatch); wave-end stats breakdown; tower
blueprints as dive rewards.

---

## 8. The tuning rig

Its own panel, not folded into world controls. Mobile-legible.

**Groups:** intensity · critters · swarm · player · feel · camera · god

**Layer-balance telemetry (from §0).** The rig's job is not only "is the enemy
hard enough" but "is each layer doing its job":
- **time in macro vs tactical** — the headline ratio; the genre says the tank
  should own the intense moments
- **mode switches per wave** — is the loop actually switching, or has the
  player settled into one layer?
- **tank idle time under threat** — the tank existing but having nothing to do
  is the specific failure the unseeable threat (§7.3) is designed to prevent
- **decisions per macro phase** — towers placed/upgraded/sold per breath; a
  passive layer still has to pose questions

**God mode** (explicitly requested): infinite heart HP and infinite tank HP,
both **still counting hits**. The point isn't invulnerability — it's watching
how hard you *would* have been hit without the run ending.

**Telemetry** — the numbers that say whether a tuning change actually helped:
heart hits, tank hits, leaks, kills/min, TTK per type, time-at-risk, wave
clear times, peak concurrent enemies, idle time (the boredom detector).

**Presets:** live-apply, persist to localStorage, export/import as a string or
URL so a good configuration is saveable, shareable and diffable.

**Rule:** a lever that needs a world rebuild is a design smell. Anything in the
sim loop must be live.

---

## 9. Difficulty philosophy

From `paradroid-difficulty-study.md` — how one minigame carried 400+ screens:

> *"Almost no scripted difficulty curve. The ship is a fixed landscape; the
> player's current host is a self-chosen difficulty slider."*

Principles adopted:

- **Difficulty = gap, chosen by the player.** Not a tier number. The same board
  is trivial or a cliff depending on what you bring to it.
- **Power decays fastest at the top.** Peak state is the most perishable, so
  the strongest position is also the most urgent.
- **Punish ambition proportionally, then reopen the shallow end.** Failure
  costs position, never possibility.
- **A fallible, legible opponent beats a perfect one with a handicap.** Skill
  should matter, and mistakes should be *visible*.
- **Never coin-flip.** Ties replay; boards are always solvable; generosity is
  an invariant.

The implication for TTD: authored waves set the *stage*, but the player's
chosen posture — how far forward they push, what they leave undefended, when
they dive — sets the actual difficulty. Sliders tune the landscape; the player
picks the gap.

---

## 10. Architecture

```
src/
  core/     pure, deterministic, Node-tested, no three.js
            sphere/ (grid, dungeon, cellindex)
            sim/    (waves, minds, swarm, economy, towers, enemyspec)
            tuning/ (schema, presets, telemetry)
  render/   three.js: board, units, effects, post-processing
  audio/    Web Audio (ported from DeepWatch)
  ui/       HUD, dashboard, modals, minigame host
  games/    embedded minigames (TRANSFER, TRACE, CONSTELLATION)
  app/      shell, loop, input, cameras
```

Invariant: **`core/` never imports three.js.** The brain is testable headless;
the shell is thin. This is the structural fix for what went wrong in the PoC.

---

## 11. Milestones

**M0 — the rig** *(first build)*
Board + dungeon + one tower + one critter + the dashboard, telemetry, god
toggles, and every lever live. Deliberately ugly. The point is that from day
one, every later decision is made on evidence rather than guesses.

**M1 — critter minds.** The posture machine + speed envelope. First real feel test.
**M2 — pacing.** Wave programs, drip, overlap, surges, the authored planet arc.
**M3 — feel.** Audio, bloom, hit feedback, danger states, camera/shake.
**M4 — the spine.** Stealth unit + thermal view + minigame host + hack.
**M5 — sense & strike.** Radar + orbital strike.
**M6 — the dive.** Portal → tanks2 arena → terminal → TRACE → blueprint.
**M7 — meta.** Achievements, codex, force fields, cinematic pass.

Each milestone is playable on its own and gets its own spec.

---

## 12. Inbox — unfolded notes & open questions

*Raw notes land here; they get folded into the sections above as they're
designed. Nothing here is committed to yet.*

**Open questions:**
- Stealth unit: tank-killable once revealed, or untouchable? (§7.3)
- Does the thermal view cost something (heat, time, vulnerability) or is it a
  free toggle?
- Are planets a sequence (campaign) or a single escalating world?
- Does the dive pause the main board, or does it keep running while you're away
  — making the dive a *risk*, not a break?
- Force fields: a tower type, a placed consumable, or an ability?

**Not yet placed:**
- BREACH minigame (specced in `hacking-mini-games/03-breach.md`, not built)
- Achievements taxonomy
- Whether the PoC's sector/planet-growth reveal survives into TTD
