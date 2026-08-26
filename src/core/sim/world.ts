// world.ts — assembles every simulation system into a single World.
//
// TICK ORDER — load-bearing, do not casually reorder.
// Changing this order invalidates the comparability of saved presets.
// Presets are tuning snapshots, and replays must match exactly:
//
//   0. clear last tick's events (never on drain — a headless run never drains)
//   1. dt *= time.scale
//   2. waves.tick  → fires onSpawn callbacks → push to pendingSpawns
//   3. spawn        → move pendingSpawns into critters[]
//   4. critters     → step each alive critter; collect 'arrived' (heart leaks)
//   5. towers       → collect TowerShotRequests → SPAWN projectiles (no damage)
//   6. tank         → collect TankDamageEvents (hitscan); update tankActing
//   7. projectiles  → move, home, collide → ProjectileHits
//   8. resolve damage → apply all damage; count kills, heart hits, tank hits
//   9. telemetry    → tick with current state
//  10. prune dead critters and spent projectiles
//
// M0c-2 inserted phase 7 and made towers spawn rather than damage. Projectiles
// step AFTER the tank so a shot fired this tick cannot also resolve this tick:
// it must be visible in flight for at least one frame, or the travel time it
// exists to express is invisible. Per the rule above, this reordering
// invalidates the comparability of presets saved before M0c-2.
//
// NAMED RNG STREAMS — never share a stream across systems.
// Adding a draw in one stream must never reshuffle another system's draws.
//   stream(seed, 'grid')     → generateSphereMesh
//   stream(seed, 'dungeon')  → generateDungeon (internal, used by dungeon.ts)
//   stream(seed, 'waves')    → makeWaveEngine / planWave
//   stream(seed, 'critters') → shared critter RNG stream; all critters draw in spawn order.
//                               Comparability hazard: changing combat levers changes survivor
//                               composition, shifting envelope draws for all subsequent critters.
//
// GOD MODE — hits are always recorded in telemetry; HP loss is skipped.
// Telemetry itself knows nothing about invulnerability; the World holds that logic.

import type { SphereMesh } from '../sphere/grid.ts';
import { generateSphereMesh } from '../sphere/grid.ts';
import type { Dungeon } from '../sphere/dungeon.ts';
import { generateDungeon, BLOCKED, isFrontierWall } from '../sphere/dungeon.ts';
import type { TuningStore } from '../tuning/store.ts';
import { makeTelemetry } from './telemetry.ts';
import { makeEventBuffer } from './events.ts';
import { makeEconomy } from './economy.ts';
import type { Economy } from './economy.ts';
import { TOWER_BY_KEY, sellRefund, unlockedKeys, MAX_TIER, upgradeCost } from './towerspec.ts';
import { ENEMY_BY_TYPE } from './enemyspec.ts';
import type { WorldEvent } from './events.ts';
import type { Rng } from './rng.ts';
import { stream } from './rng.ts';
import type { Critter } from './critters.ts';
import { spawnCritter, stepCritter, hitCritter, auraBoost } from './critters.ts';
import type { WaveEngine } from './waves.ts';
import { makeWaveEngine } from './waves.ts';
import type { Tower } from './towers.ts';
import { makeTower, stepTowers } from './towers.ts';
import type { Projectile } from './projectiles.ts';
import { makeProjectile, stepProjectiles } from './projectiles.ts';
import type { Tank, TankInput } from './tank.ts';
import { makeTank, stepTank } from './tank.ts';
import type { Vec3 } from '../sphere/vec3.ts';

// ---- Public types -----------------------------------------------------------

export type { Tower, Tank, TankInput };

export type World = {
  mesh: SphereMesh;
  dungeon: Dungeon;
  critters: Critter[];
  towers: Tower[];
  /** Shots currently in flight. The renderer draws tracers from these. */
  projectiles: Projectile[];
  /** Credits: what a tower costs and where the money comes from. */
  economy: Economy;
  tank: Tank;
  heartHp: number;
  heartDied: boolean;
  /** True once the run has been won: winAt waves cleared, heart alive, board
   *  empty. A run can now END WELL, which difficulty needs in order to mean
   *  anything — a curve with no top cannot be calibrated. */
  won: boolean;
  /** True when the run is over either way; the shell stops ticking on this. */
  over: boolean;
  macro: boolean;
  tuning: TuningStore;
  telemetry: ReturnType<typeof makeTelemetry>;
  waves: WaveEngine;
  elapsed: number;
  /** Contact radius used for tank ram detection (0.4 × mean chord length of the mesh).
   *  Exposed so tests can assert directly rather than inferring from kill counts. */
  tankContactRadius: number;
  tick(dt: number, input: TankInput): void;
  /** Everything that happened during the last tick, as plain data. The renderer
   *  drains this to draw shots, impacts and deaths — M0b had no such channel,
   *  which is why combat was invisible. Cleared at the START of each tick, so a
   *  headless run with no renderer never accumulates. */
  drainEvents(): WorldEvent[];
  /** Place a tower on HIGH GROUND: a BLOCKED cell bordering open ground.
   *  Returns false for open cells, buried walls, and occupied cells.
   *  One tower per cell; counts a decision only on success. */
  placeTower(cell: number, key?: string): boolean;
  /** Sell a tower, refunding eco.sellRefund of everything sunk into it.
   *  Returns the refund, or 0 if the cell held no tower. */
  sellTower(cell: number): number;
  /** Upgrade a tower one tier, charging its upgrade cost. False if maxed,
   *  missing, or unaffordable. */
  upgradeTower(cell: number): boolean;
  setMacro(on: boolean): void;
};

// ---- Factory ----------------------------------------------------------------

const MESH_POINTS = 600;
const MESH_RELAX = 40;
const DUNGEON_ROOMS = 12;
const DUNGEON_ROOM_RADIUS = 4;
const DUNGEON_EXTRA_CORRIDORS = 6;
const DUNGEON_CORRIDOR_WIDTH = 1;
/** Exported so the renderer and HUD can express heart HP as a fraction
 *  without duplicating the constant and silently drifting from it. */
export const HEART_MAX_HP = 20;
// How long (seconds) before the same critter can register another tank ram.
// Without a cooldown, damage and hit counts accumulate on every tick the critter
// stays inside the radius — a single pass could cost 30–50 ticks of HP.
// 0.5 s gives one event per critter encounter and makes tankHits an event count
// comparable to heartHits (both are per-crossing, not per-tick).
const TANK_CONTACT_COOLDOWN = 0.5;

export function makeWorld(opts: { seed: number; tuning: TuningStore }): World {
  const { seed, tuning } = opts;

  /** Bounty for killing `c`: the type's own worth, scaled by the eco.bounty
   *  lever so the whole payout curve stays tunable while a prime keeps paying
   *  more than a phage. Bounties are FLAT across waves by design — money
   *  tightens automatically as counts rise. */
  const bountyFor = (c: Critter): number =>
    (ENEMY_BY_TYPE.get(c.type)?.bounty ?? 1) * (tuning.get('eco.bounty') / 8);

  // ── Static geometry (uses its own named RNG streams internally) ──────────
  const mesh: SphereMesh = generateSphereMesh({ seed, points: MESH_POINTS, relaxIters: MESH_RELAX });
  const dungeon: Dungeon = generateDungeon(mesh, {
    seed,
    rooms: DUNGEON_ROOMS,
    roomRadius: DUNGEON_ROOM_RADIUS,
    extraCorridors: DUNGEON_EXTRA_CORRIDORS,
    corridorWidth: DUNGEON_CORRIDOR_WIDTH,
  });

  // ── Tank contact radius — derived from mesh geometry ─────────────────────
  // Computed once at construction so it is free of per-tick allocation.
  // Algorithm: mean chord length across all adjacent cell pairs in the mesh
  //   (captures the actual local cell spacing, not an approximation).
  // Fraction: 0.4 × mean chord.
  //   - MESH_POINTS=600 yields ~2640–2700 output quads (varies by seed); mean chord ≈ 0.068 → radius ≈ 0.027.
  //   - Measured minimum gate-to-spawn across seeds 1–60 is 0.047 (seed 57),
  //     so 0.027 keeps spawned critters outside the contact zone.
  //   - A critter must travel ~0.4 of a cell before it can trigger a ram hit,
  //     which prevents spawn-adjacent auto-kills for a stationary tank. A fast
  //     moving tank (tank.speed=10) displaces ~0.167/tick and sweeps a larger
  //     disc via the step-7d floor — that is intentional (the point of swept radius).
  //   - In step 7d the floor is extended by half the actual displacement moved
  //     this tick (measured from tankPrev), so a moving tank does not tunnel
  //     through critters. A parked tank (forward=0) gets no extension.
  //   - Contact damage fires at most once per TANK_CONTACT_COOLDOWN seconds per
  //     critter (see step 7d), so a single pass registers exactly one event
  //     regardless of how long the critter spends inside the radius.
  let edgeSum = 0;
  let edgeCount = 0;
  for (let i = 0; i < mesh.centers.length; i++) {
    const adjs = mesh.adj[i] ?? [];
    for (const j of adjs) {
      if (j > i) {
        const ci = mesh.centers[i];
        const cj = mesh.centers[j];
        if (ci !== undefined && cj !== undefined) {
          const dx = cj[0] - ci[0]; const dy = cj[1] - ci[1]; const dz = cj[2] - ci[2];
          edgeSum += Math.sqrt(dx * dx + dy * dy + dz * dz);
          edgeCount += 1;
        }
      }
    }
  }
  const meanChord = edgeCount > 0 ? edgeSum / edgeCount : 0.068;
  const tankContactRadius = 0.4 * meanChord;

  // ── Named RNG streams ────────────────────────────────────────────────────
  // waves stream: used by makeWaveEngine and planWave
  const wavesRng: Rng = stream(seed, 'waves');
  // critters stream: used by spawnCritter and stepCritter envelopes
  const crittersRng: Rng = stream(seed, 'critters');

  // ── Wave engine ──────────────────────────────────────────────────────────
  // Gates: all open cells adjacent to spawn, or spawn itself as fallback
  const gateList: number[] = (mesh.adj[dungeon.spawn] ?? []).filter(
    (n) => dungeon.tags[n] !== BLOCKED,
  );
  if (gateList.length === 0) gateList.push(dungeon.spawn);
  const waves: WaveEngine = makeWaveEngine(tuning, wavesRng, gateList);

  // ── Critters ─────────────────────────────────────────────────────────────
  const critters: Critter[] = [];
  let nextCritterId = 0;

  // Pending spawns queued by wave engine callbacks
  const pendingSpawns: Array<{ gate: number; hp: number; type: string }> = [];

  // ── Towers & tank ────────────────────────────────────────────────────────
  const towers: Tower[] = [];
  let nextTowerId = 0;

  // ── Projectiles ───────────────────────────────────────────────────────────
  const projectiles: Projectile[] = [];
  let nextProjectileId = 0;

  const spawnPos: Vec3 = mesh.centers[dungeon.spawn] ?? [0, 1, 0];
  const tank: Tank = makeTank(spawnPos, dungeon.spawn);

  // ── Heart ─────────────────────────────────────────────────────────────────
  let heartHp: number = HEART_MAX_HP;

  // ── Layer mode ────────────────────────────────────────────────────────────
  let macro = false;

  // ── Telemetry ─────────────────────────────────────────────────────────────
  const telemetry = makeTelemetry();

  // ── Events ────────────────────────────────────────────────────────────────
  const events = makeEventBuffer();

  // ── Economy ───────────────────────────────────────────────────────────────
  // Towers cost credit, so placement is a decision rather than a click. Until
  // M0c-3 towers were free and unlimited, and no lever setting produces
  // difficulty against unlimited free defence.
  const economy = makeEconomy(tuning);

  // ── Elapsed (post-scale) ──────────────────────────────────────────────────
  let elapsed = 0;
  let waveStartedAt = 0;   // stamped when a wave begins spawning; see tick step 2

  // ---- tick -----------------------------------------------------------------

  function tick(rawDt: number, input: TankInput): void {
    // ── 0. Clear last tick's events ─────────────────────────────────────────
    // Before anything else, and never on drain: a headless sweep has no
    // renderer, so draining is not guaranteed to happen at all.
    events.clear();

    // ── 1. Scale dt ─────────────────────────────────────────────────────────
    // LOAD-BEARING ORDER: dt *= time.scale is first — every system sees scaled time.
    const dt = rawDt * tuning.get('time.scale');
    elapsed += dt;

    // ── 2. Waves tick (queues spawns via onSpawn callback) ──────────────────
    const stateBefore = waves.state;
    waves.tick(dt, {
      enemiesAlive: critters.filter((c) => c.alive).length,
      onSpawn: (gate: number, hp: number, type: string) => { pendingSpawns.push({ gate, hp, type }); },
    });
    // Wave-clear timing. The engine enters 'breathing' exactly when the field
    // has drained to its overlap threshold — that transition IS the wave being
    // cleared, so it is the only honest place to stamp the duration. Watched
    // here rather than inside the engine so the engine stays free of telemetry.
    if (stateBefore !== 'breathing' && waves.state === 'breathing') {
      telemetry.waveCleared(elapsed - waveStartedAt);
    }
    if (stateBefore !== 'spawning' && waves.state === 'spawning') {
      waveStartedAt = elapsed;
    }

    // ── 3. Spawn pending critters ────────────────────────────────────────────
    for (const { gate, hp, type } of pendingSpawns) {
      const c = spawnCritter(nextCritterId++, gate, tuning, crittersRng, elapsed, hp, type);
      // Initialize position from mesh
      const gatePos: Vec3 = mesh.centers[gate] ?? [0, 1, 0];
      c.pos = gatePos;
      critters.push(c);
    }
    pendingSpawns.length = 0;

    // ── 4. Step critters ─────────────────────────────────────────────────────
    const arrivedIds = new Set<number>();
    for (const c of critters) {
      if (!c.alive) continue;
      const result = stepCritter(c, dt, {
        mesh, dungeon, tuning, rng: crittersRng, now: elapsed,
        aura: auraBoost(c, critters),
      });
      if (result === 'arrived') {
        arrivedIds.add(c.id);
      }
    }

    // ── 5. Towers tick → spawn projectiles, or resolve hitscan immediately ───
    // Six attack kinds, three resolutions: beam and slowfield are instant,
    // everything else becomes a projectile that has to travel and can miss.
    const shotRequests = stepTowers(towers, critters, dt, tuning, meanChord);
    const towerHitscan: Array<{ critterId: number; damage: number }> = [];
    for (const req of shotRequests) {
      if (req.attack === 'slowfield') {
        // Touches every critter in range at once: chip damage plus a heavy
        // slow. The tether is drawn per target so the field reads as a field.
        for (const id of req.fieldTargets ?? []) {
          const c = critters.find((x) => x.id === id && x.alive);
          if (c === undefined) continue;
          towerHitscan.push({ critterId: id, damage: req.damage });
          c.slowFactor = req.slowFactor ?? 1;
          c.slowLeft = req.slowDur ?? 0;
          events.emit({ kind: 'beam', from: req.from, to: c.pos });
        }
        continue;
      }
      if (req.attack === 'beam') {
        const c = critters.find((x) => x.id === req.critterId && x.alive);
        if (c === undefined) continue;
        towerHitscan.push({ critterId: req.critterId, damage: req.damage });
        events.emit({ kind: 'beam', from: req.from, to: c.pos });
        continue;
      }
      for (const dir of req.dirs) {
        const p = makeProjectile(nextProjectileId++, {
          pos: req.from,
          dir,
          speed: req.projSpeed,
          damage: req.damage,
          range: req.rangeWorld,
          source: 'tower',
          // A mortar is dumb-fire and detonates where it lands; only the
          // steering kinds chase. A homing spread would make the fan pointless.
          homingId: req.attack === 'homing' ? req.critterId : null,
          splash: req.splashWorld,
          detonateAtRange: req.attack === 'mortar',
        });
        projectiles.push(p);
        events.emit({ kind: 'shotFired', at: p.pos, dir: p.dir, source: 'tower' });
      }
    }

    // ── 6. Tank tick → collect damage events ─────────────────────────────────
    // Capture position before stepTank so we can measure actual displacement below.
    const tankPrev: [number, number, number] = [tank.pos[0]!, tank.pos[1]!, tank.pos[2]!];
    const { events: tankEvents, acting: tankActing } = stepTank(tank, dt, input, critters, tuning);

    // ── 7. Projectiles: move, home, collide ──────────────────────────────────
    const { hits: projectileHits, expired } = stepProjectiles(projectiles, critters, dt, tuning);
    for (const h of projectileHits) {
      events.emit({ kind: 'impact', at: h.at, damage: h.damage, source: h.source });
    }

    // ── 8. Resolve damage ────────────────────────────────────────────────────

    // 8a. Critters that reached heart
    for (const id of arrivedIds) {
      const c = critters.find((x) => x.id === id);
      if (c === undefined || !c.alive) continue;
      c.alive = false;
      // leak = critter reached the heart (always, even in god mode)
      telemetry.leak();
      // A leak costs twice: a life, and the income curve. Resetting the streak
      // here rather than at the damage site means god mode still breaks it —
      // the streak is about letting something through, not about taking damage.
      economy.leak();
      // heartHit = spec §5 "god-mode hits count normally" — symmetry with tankHit
      // (called unconditionally; only HP mutation + death stamp are gated on invulnerability)
      // Also gated on heartHp > 0 to prevent post-mortem phantom hits.
      if (heartHp > 0) {
        telemetry.heartHit();
        events.emit({ kind: 'heartHit', at: mesh.centers[dungeon.heart] ?? [0, 1, 0] });
        if (!tuning.flag('god.heartInvulnerable')) {
          // Per-type damage: a boss costs three hearts, a phage one. Uniform
          // leak cost would make every leak equally bad, which erases the
          // reason to prioritise one lane over another when you cannot hold
          // both — and choosing which leak to accept is most of the tension.
          const dmg = ENEMY_BY_TYPE.get(c.type)?.heartDmg ?? 1;
          heartHp = Math.max(0, heartHp - dmg);
          if (heartHp === 0) telemetry.recordHeartDeath(elapsed);
        }
      }
    }

    // 8b0. Hitscan tower damage (beam and slowfield resolve the tick they fire)
    for (const h of towerHitscan) {
      const c = critters.find((x) => x.id === h.critterId);
      if (c === undefined) continue;
      if (hitCritter(c, h.damage, tuning, elapsed)) {
        const ttk = elapsed - (c.firstHitAt ?? elapsed);
        telemetry.kill('tower', elapsed - c.bornAt, ttk);
        economy.rewardKill(bountyFor(c));
        events.emit({ kind: 'critterDied', at: c.pos, by: 'tower' });
      }
    }

    // 8b. Projectile hits (tower fire arrives here, one or more ticks late)
    for (const h of projectileHits) {
      const c = critters.find((x) => x.id === h.critterId);
      if (c === undefined) continue;
      const killed = hitCritter(c, h.damage, tuning, elapsed);
      if (killed) {
        const ttk = elapsed - (c.firstHitAt ?? elapsed);
        telemetry.kill('tower', elapsed - c.bornAt, ttk);
        economy.rewardKill(bountyFor(c));
        events.emit({ kind: 'critterDied', at: c.pos, by: 'tower' });
      }
    }

    // 8c. Tank damage events (hitscan — the tank fires a beam, not a shot)
    for (const evt of tankEvents) {
      const c = critters.find((x) => x.id === evt.critterId);
      if (c === undefined) continue;
      events.emit({ kind: 'beam', from: tank.pos, to: c.pos });
      const killed = hitCritter(c, evt.damage, tuning, elapsed);
      if (killed) {
        const ttk = elapsed - (c.firstHitAt ?? elapsed);
        telemetry.kill('player', elapsed - c.bornAt, ttk);
        economy.rewardKill(bountyFor(c));
        events.emit({ kind: 'critterDied', at: c.pos, by: 'tank' });
      }
    }

    // 8d. Contact damage to tank (critters that reach the tank's position)
    // Swept-motion floor: the point test below samples once per tick. Without the
    // floor a fast tank tunnels through critters — the step can exceed the static
    // radius entirely and 100% of contacts are missed. We use the actual displacement
    // measured since tankPrev (not the speed lever) so a parked tank (forward=0) never
    // gets an inflated disc regardless of the speed setting.
    const mdx = tank.pos[0]! - tankPrev[0]!;
    const mdy = tank.pos[1]! - tankPrev[1]!;
    const mdz = tank.pos[2]! - tankPrev[2]!;
    const r = Math.max(tankContactRadius, 0.5 * Math.sqrt(mdx * mdx + mdy * mdy + mdz * mdz));
    for (const c of critters) {
      if (!c.alive) continue;
      // Contact latch: only register a new ram event when the cooldown has expired.
      // This makes tankHits an event count (one per critter encounter), comparable
      // to heartHits, and prevents per-tick HP drain during a single pass-through.
      if (c.contactLeft > 0) continue;
      const dx = c.pos[0] - tank.pos[0];
      const dy = c.pos[1] - tank.pos[1];
      const dz = c.pos[2] - tank.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= r) {
        c.contactLeft = TANK_CONTACT_COOLDOWN;
        telemetry.tankHit();
        events.emit({ kind: 'tankHit', at: tank.pos });
        tank.hits += 1;
        if (!tuning.flag('god.tankInvulnerable')) { tank.hp -= 1; if (tank.hp < 0) tank.hp = 0; }
        if (hitCritter(c, tuning.get('tank.damage'), tuning, elapsed)) {
          const ttk = elapsed - (c.firstHitAt ?? elapsed);
          telemetry.kill('player', elapsed - c.bornAt, ttk);
          // Ramming pays a premium: it is the riskiest way to kill something,
          // since it means putting the tank where the critter already is.
          economy.rewardKill(bountyFor(c), true);
          events.emit({ kind: 'critterDied', at: c.pos, by: 'tank' });
        }
      }
    }

    // 8e. Wave clear detection (check if wave is now fully clear after deaths)
    // (Wave engine handles this internally via enemiesAlive count)

    // ── 8e2. Win check ───────────────────────────────────────────────────────
    // Won when the target wave count is cleared AND the board is empty. Both
    // halves matter: clearing wave N while a dozen critters are still walking
    // is not a win, it is a lull.
    if (telemetry.data.wonAt === null && heartHp > 0) {
      const target = tuning.get('wave.winAt');
      const boardEmpty = critters.every((c) => !c.alive);
      if (waves.wave > target && boardEmpty) telemetry.recordWin(elapsed);
    }

    // ── 8f. Passive income (defaults to zero; see eco.trickle) ───────────────
    economy.tick(dt);

    // ── 9. Telemetry tick ────────────────────────────────────────────────────
    const enemiesAlive = critters.filter((c) => c.alive).length;
    telemetry.tick(dt, {
      macro,
      enemiesAlive,
      tankActing,
    });
    telemetry.recordEconomy(economy);

    // ── 10. Prune dead critters and spent projectiles ─────────────────────────
    if (expired.length > 0) {
      const gone = new Set(expired);
      const live = projectiles.filter((p) => !gone.has(p.id));
      projectiles.length = 0;
      for (const p of live) projectiles.push(p);
    }

    // Done last so all step 7 `find` calls still have their targets.
    // filter() preserves order → determinism holds.
    // After pruning, critters[] contains only live critters.
    if (critters.some((c) => !c.alive)) {
      const alive = critters.filter((c) => c.alive);
      critters.length = 0;
      for (const c of alive) critters.push(c);
    }
  }

  // ---- placeTower -----------------------------------------------------------

  // Towers build on the HIGH GROUND only: a BLOCKED cell that borders open
  // ground. From the PoC (td-tab.js:2966): "towers build on the HIGH GROUND
  // only... No connectivity guard needed: walls never carry enemy pathing, so a
  // tower can never dam a lane." That last clause is why this rule exists —
  // allowing open cells would let a player seal a route and would force a
  // connectivity check on every placement.
  //
  // M0b briefly allowed open cells instead. That was a mistake: it "corrected"
  // spec §7 to match an implementation that had not yet built walls, rather
  // than to match the design.
  function placeTower(cell: number, key = 'single'): boolean {
    if (!isFrontierWall(mesh, dungeon, cell)) return false;

    // One tower per cell — stacking bypasses the decision budget
    if (towers.some((t) => t.cell === cell)) return false;

    const spec = TOWER_BY_KEY.get(key);
    if (spec === undefined) return false;
    // The unlock ladder is enforced HERE, not only in the shop. A rule that
    // lives solely in the UI is a suggestion: any other caller — a preset, a
    // test, a future auto-builder — walks straight past it, and the ladder that
    // paces the whole early game becomes decoration.
    if (!unlockedKeys(waves.wave).includes(key)) return false;
    // Charged LAST, after every other check, so a refused placement never
    // takes money. Ordering matters here: a rule added later above this line
    // is free, one added below it silently bills for nothing.
    if (!economy.spend(spec.cost)) return false;

    const pos: Vec3 = mesh.centers[cell] ?? [0, 1, 0];
    const tower = makeTower(nextTowerId++, cell, pos);
    tower.key = key;
    tower.spent = spec.cost;
    towers.push(tower);

    // Count as a decision ONLY on success
    telemetry.decision();
    return true;
  }

  /** Upgrade the tower on `cell` one tier. Returns false if there is no tower,
   *  it is already at max tier, or the credit is short.
   *
   *  Charged LAST, like placeTower, so a refused upgrade never takes money —
   *  the ordering is the rule, not an accident of how it was written. */
  function upgradeTower(cell: number): boolean {
    const tower = towers.find((t) => t.cell === cell);
    if (tower === undefined) return false;
    const spec = TOWER_BY_KEY.get(tower.key);
    if (spec === undefined) return false;
    if (tower.tier >= MAX_TIER) return false;
    const cost = upgradeCost(spec, tower.tier);
    if (cost === null) return false;
    if (!economy.spend(cost)) return false;

    tower.tier += 1;
    // Load-bearing: sellRefund reads `spent`, so accumulating the upgrade here
    // is what makes a fully upgraded tower refund proportionally instead of
    // refunding only its purchase price.
    tower.spent += cost;
    telemetry.decision(); // an upgrade IS a decision, same as a place or a sell
    return true;
  }

  /** Sell the tower on `cell`, refunding a fraction of everything sunk into it.
   *  Returns the credit refunded, or 0 if there was nothing to sell. */
  function sellTower(cell: number): number {
    const i = towers.findIndex((t) => t.cell === cell);
    if (i === -1) return 0;
    const tower = towers[i]!;
    const refund = sellRefund(tower.spent, tuning.get('eco.sellRefund'));
    economy.credited(refund);
    towers.splice(i, 1);
    telemetry.decision();
    return refund;
  }

  // ---- setMacro -------------------------------------------------------------

  function setMacro(on: boolean): void {
    // Reset per-phase counter when entering a new macro phase
    if (on && !macro) {
      telemetry.resetPhaseCounters();
    }
    macro = on;
  }

  // ---- Return World ----------------------------------------------------------

  return {
    mesh,
    dungeon,
    critters,
    towers,
    projectiles,
    tank,
    get heartHp() { return heartHp; },
    get heartDied() { return telemetry.data.heartDeathAt !== null; },
  get won() { return telemetry.data.wonAt !== null; },
  get over() { return telemetry.data.heartDeathAt !== null || telemetry.data.wonAt !== null; },
    get macro() { return macro; },
    tuning,
    telemetry,
    waves,
    get elapsed() { return elapsed; },
    tankContactRadius,
    tick,
    drainEvents: () => events.drain(),
    placeTower,
    sellTower,
    upgradeTower,
    economy,
    setMacro,
  };
}
