// world.ts — assembles every simulation system into a single World.
//
// TICK ORDER — load-bearing, do not casually reorder.
// Changing this order invalidates the comparability of saved presets.
// Presets are tuning snapshots, and replays must match exactly:
//
//   1. dt *= time.scale
//   2. waves.tick  → fires onSpawn callbacks → push to pendingSpawns
//   3. spawn        → move pendingSpawns into critters[]
//   4. critters     → step each alive critter; collect 'arrived' (heart leaks)
//   5. towers       → collect TowerDamageEvents
//   6. tank         → collect TankDamageEvents; update tankActing
//   7. resolve damage → apply all damage events; count kills, heart hits, tank hits
//   8. telemetry    → tick with current state
//
// NAMED RNG STREAMS — never share a stream across systems.
// Adding a draw in one stream must never reshuffle another system's draws.
//   stream(seed, 'grid')     → generateSphereMesh
//   stream(seed, 'dungeon')  → generateDungeon (internal, used by dungeon.ts)
//   stream(seed, 'waves')    → makeWaveEngine / planWave
//   stream(seed, 'critters') → per-critter envelope RNG passed to stepCritter
//
// GOD MODE — hits are always recorded in telemetry; HP loss is skipped.
// Telemetry itself knows nothing about invulnerability; the World holds that logic.

import type { SphereMesh } from '../sphere/grid.ts';
import { generateSphereMesh } from '../sphere/grid.ts';
import type { Dungeon } from '../sphere/dungeon.ts';
import { generateDungeon, BLOCKED } from '../sphere/dungeon.ts';
import type { TuningStore } from '../tuning/store.ts';
import { makeTelemetry } from './telemetry.ts';
import type { Rng } from './rng.ts';
import { stream } from './rng.ts';
import type { Critter } from './critters.ts';
import { spawnCritter, stepCritter, hitCritter } from './critters.ts';
import type { WaveEngine } from './waves.ts';
import { makeWaveEngine } from './waves.ts';
import type { Tower } from './towers.ts';
import { makeTower, stepTowers } from './towers.ts';
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
  tank: Tank;
  heartHp: number;
  macro: boolean;
  tuning: TuningStore;
  telemetry: ReturnType<typeof makeTelemetry>;
  waves: WaveEngine;
  elapsed: number;
  tick(dt: number, input: TankInput): void;
  /** Place a tower on cell. Returns false if illegal (BLOCKED). Counts a decision only on success. */
  placeTower(cell: number): boolean;
  setMacro(on: boolean): void;
};

// ---- Factory ----------------------------------------------------------------

const MESH_POINTS = 600;
const MESH_RELAX = 40;
const DUNGEON_ROOMS = 12;
const DUNGEON_ROOM_RADIUS = 4;
const DUNGEON_EXTRA_CORRIDORS = 6;
const DUNGEON_CORRIDOR_WIDTH = 1;
const HEART_MAX_HP = 20;

export function makeWorld(opts: { seed: number; tuning: TuningStore }): World {
  const { seed, tuning } = opts;

  // ── Static geometry (uses its own named RNG streams internally) ──────────
  const mesh: SphereMesh = generateSphereMesh({ seed, points: MESH_POINTS, relaxIters: MESH_RELAX });
  const dungeon: Dungeon = generateDungeon(mesh, {
    seed,
    rooms: DUNGEON_ROOMS,
    roomRadius: DUNGEON_ROOM_RADIUS,
    extraCorridors: DUNGEON_EXTRA_CORRIDORS,
    corridorWidth: DUNGEON_CORRIDOR_WIDTH,
  });

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
  const pendingSpawns: Array<{ gate: number; hp: number }> = [];

  // ── Towers & tank ────────────────────────────────────────────────────────
  const towers: Tower[] = [];
  let nextTowerId = 0;

  const spawnPos: Vec3 = mesh.centers[dungeon.spawn] ?? [0, 1, 0];
  const tank: Tank = makeTank(spawnPos, dungeon.spawn);

  // ── Heart ─────────────────────────────────────────────────────────────────
  let heartHp: number = HEART_MAX_HP;

  // ── Layer mode ────────────────────────────────────────────────────────────
  let macro = false;

  // ── Telemetry ─────────────────────────────────────────────────────────────
  const telemetry = makeTelemetry();

  // ── Elapsed (post-scale) ──────────────────────────────────────────────────
  let elapsed = 0;
  let waveStartedAt = 0;   // stamped when a wave begins spawning; see tick step 2

  // ---- tick -----------------------------------------------------------------

  function tick(rawDt: number, input: TankInput): void {
    // ── 1. Scale dt ─────────────────────────────────────────────────────────
    // LOAD-BEARING ORDER: dt *= time.scale is first — every system sees scaled time.
    const dt = rawDt * tuning.get('time.scale');
    elapsed += dt;

    // ── 2. Waves tick (queues spawns via onSpawn callback) ──────────────────
    const stateBefore = waves.state;
    waves.tick(dt, {
      enemiesAlive: critters.filter((c) => c.alive).length,
      onSpawn: (gate: number, hp: number) => { pendingSpawns.push({ gate, hp }); },
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
    for (const { gate, hp } of pendingSpawns) {
      const c = spawnCritter(nextCritterId++, gate, tuning, crittersRng, elapsed, hp);
      // Initialize position from mesh
      const gatePos: Vec3 = mesh.centers[gate] ?? [0, 1, 0];
      c.pos = gatePos;
      critters.push(c);
    }
    pendingSpawns.splice(0);

    // ── 4. Step critters ─────────────────────────────────────────────────────
    const arrivedIds = new Set<number>();
    for (const c of critters) {
      if (!c.alive) continue;
      const result = stepCritter(c, dt, { mesh, dungeon, tuning, rng: crittersRng });
      if (result === 'arrived') {
        arrivedIds.add(c.id);
      }
    }

    // ── 5. Towers tick → collect damage events ───────────────────────────────
    const towerEvents = stepTowers(towers, critters, dt, tuning);

    // ── 6. Tank tick → collect damage events ─────────────────────────────────
    const { events: tankEvents, acting: tankActing } = stepTank(tank, dt, input, critters, tuning);

    // ── 7. Resolve damage ────────────────────────────────────────────────────

    // 7a. Critters that reached heart
    for (const id of arrivedIds) {
      const c = critters.find((x) => x.id === id);
      if (c === undefined || !c.alive) continue;
      c.alive = false;
      // Record hit in telemetry regardless of god mode
      telemetry.heartHit();
      telemetry.leak();
      // God mode: skip HP loss if heartInvulnerable
      if (!tuning.flag('god.heartInvulnerable')) {
        heartHp -= 1;
        if (heartHp < 0) heartHp = 0;
      }
    }

    // 7b. Tower damage events
    for (const evt of towerEvents) {
      const c = critters.find((x) => x.id === evt.critterId);
      if (c === undefined) continue;
      const killed = hitCritter(c, evt.damage, tuning);
      if (killed) {
        const tower = towers.find((t) => t.id === evt.towerId);
        if (tower !== undefined) tower.kills += 1;
        telemetry.kill('tower', elapsed - c.bornAt);
      }
    }

    // 7c. Tank damage events
    for (const evt of tankEvents) {
      const c = critters.find((x) => x.id === evt.critterId);
      if (c === undefined) continue;
      const killed = hitCritter(c, evt.damage, tuning);
      if (killed) {
        telemetry.kill('player', elapsed - c.bornAt);
      }
    }

    // 7d. Contact damage to tank (critters that reach the tank's position)
    const TANK_CONTACT_RADIUS = 0.05;
    for (const c of critters) {
      if (!c.alive) continue;
      const dx = c.pos[0] - tank.pos[0];
      const dy = c.pos[1] - tank.pos[1];
      const dz = c.pos[2] - tank.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d <= TANK_CONTACT_RADIUS) {
        // Record hit in telemetry regardless of god mode
        telemetry.tankHit();
        tank.hits += 1;
        if (!tuning.flag('god.tankInvulnerable')) {
          tank.hp -= 1;
          if (tank.hp < 0) tank.hp = 0;
        }
        // Kill the critter that rammed the tank (they die on impact)
        c.alive = false;
        telemetry.kill('player', elapsed - c.bornAt);
      }
    }

    // 7e. Wave clear detection (check if wave is now fully clear after deaths)
    // (Wave engine handles this internally via enemiesAlive count)

    // ── 8. Telemetry tick ────────────────────────────────────────────────────
    const enemiesAlive = critters.filter((c) => c.alive).length;
    telemetry.tick(dt, {
      macro,
      enemiesAlive,
      tankActing,
    });
  }

  // ---- placeTower -----------------------------------------------------------

  function placeTower(cell: number): boolean {
    // Reject if cell is BLOCKED
    if (dungeon.tags[cell] === BLOCKED) return false;

    // Get cell position
    const pos: Vec3 = mesh.centers[cell] ?? [0, 1, 0];
    const tower = makeTower(nextTowerId++, cell, pos);
    towers.push(tower);

    // Count as a decision ONLY on success
    telemetry.decision();
    return true;
  }

  // ---- setMacro -------------------------------------------------------------

  function setMacro(on: boolean): void {
    macro = on;
  }

  // ---- Return World ----------------------------------------------------------

  return {
    mesh,
    dungeon,
    critters,
    towers,
    tank,
    get heartHp() { return heartHp; },
    get macro() { return macro; },
    tuning,
    telemetry,
    waves,
    get elapsed() { return elapsed; },
    tick,
    placeTower,
    setMacro,
  };
}
