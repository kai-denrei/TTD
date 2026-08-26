// critters.ts — nav-graph critter motion, live speed envelope, hit reactions.
//
// Design pillars:
//   - All levers read LIVE inside tick — never captured at construction.
//   - Deterministic: all randomness from the passed-in Rng (no Math.random).
//   - Movement walks distToHeart downhill, carrying leftover distance across
//     cell arrivals so pace doesn't lurch between cells of different sizes.
//   - Envelope re-targets on an unpredictable cadence (surgeCadence ± jitter),
//     not a smooth sine — that's the stressor the operator asked for.

import type { SphereMesh } from '../sphere/grid.ts';
import type { Dungeon } from '../sphere/dungeon.ts';
import { BLOCKED } from '../sphere/dungeon.ts';
import { sub, len } from '../sphere/vec3.ts';
import type { Vec3 } from '../sphere/vec3.ts';
import type { TuningStore } from '../tuning/store.ts';
import type { Rng } from './rng.ts';

// ---- Public type ------------------------------------------------------------

export type Critter = {
  id: number;
  alive: boolean;
  hp: number;
  cur: number;      // cell index currently occupying
  next: number;     // cell index heading toward
  prog: number;     // 0..1 progress along current segment
  pos: Vec3;
  // speed envelope
  envPhase: number;   // seconds until next re-target
  envValue: number;   // current eased envelope value
  envTarget: number;  // target we are easing toward
  envLeft: number;    // seconds remaining in current target window
  // hit reaction
  reactMult: number;  // 1 when idle, accelOnHit when reacting
  reactLeft: number;  // seconds remaining in the reaction
  bornAt: number;
};

// ---- Easing rate ------------------------------------------------------------
// We want envValue to track envTarget noticeably within a cadence window but
// not snap instantly. A rate of 4 /s gives a 63% travel in 0.25 s and ~98%
// in 1 s — fast enough to feel responsive at 1 s cadence, smooth enough that
// it's not a square wave.
const EASE_RATE = 4; // units: fraction per second

// ---- Helpers ----------------------------------------------------------------

function segLen(mesh: SphereMesh, a: number, b: number): number {
  const ca = mesh.centers[a];
  const cb = mesh.centers[b];
  if (ca === undefined || cb === undefined) return 1;
  return Math.max(len(sub(cb, ca)), 1e-6);
}

function lerpVec3(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}

/** Pick the open neighbor with the smallest distToHeart (downhill). Ties
 *  broken by smallest index so the choice is deterministic. Returns -1 if no
 *  downhill neighbor exists (heart cell or dead-end). */
function bestNeighbor(cell: number, dungeon: Dungeon, mesh: SphereMesh): number {
  const neighbors = mesh.adj[cell] ?? [];
  let best = -1;
  let bestDist = Infinity;
  const curDist = dungeon.distToHeart[cell] ?? -1;
  for (const n of neighbors) {
    if (dungeon.tags[n] === BLOCKED) continue;
    const d = dungeon.distToHeart[n] ?? -1;
    if (d === -1) continue;
    // strictly downhill only; equals = lateral, skip
    if (d < curDist && (d < bestDist || (d === bestDist && n < best))) {
      bestDist = d;
      best = n;
    }
  }
  return best;
}

/** Sample the envelope re-target interval. */
function nextEnvPhase(rng: Rng, tuning: TuningStore): number {
  const cadence = tuning.get('enemy.surgeCadence');
  const jitter = tuning.get('enemy.surgeJitter');
  // interval ∈ [cadence*(1-jitter), cadence*(1+jitter)]
  return cadence * (1 + (rng() * 2 - 1) * jitter);
}

/** Sample a new envelope target. */
function sampleEnvTarget(rng: Rng, tuning: TuningStore): number {
  const amp = tuning.get('enemy.surgeAmp');
  return 1 + (rng() * 2 - 1) * amp;
}

// ---- Public API -------------------------------------------------------------

export function spawnCritter(
  id: number,
  cell: number,
  tuning: TuningStore,
  rng: Rng,
  now: number,
): Critter {
  const hp = tuning.get('enemy.hp');
  // Pick initial next: best downhill neighbor of spawn cell.
  // If none (spawn IS heart, unusual but possible), use spawn.
  // We don't need rng for the initial next because bestNeighbor is deterministic.
  // We DO consume rng for the initial envelope target so streams stay aligned.
  const envTarget = sampleEnvTarget(rng, tuning);
  const envPhase = nextEnvPhase(rng, tuning);

  // next will be resolved on first stepCritter call (mesh/dungeon not available here)
  const c: Critter = {
    id, alive: true, hp,
    cur: cell, next: cell, prog: 0,
    pos: [0, 0, 0],
    envPhase, envValue: 1, envTarget, envLeft: envPhase,
    reactMult: 1, reactLeft: 0,
    bornAt: now,
  };
  return c;
}

/** effectiveSpeed reads all levers live — never cached. */
export function effectiveSpeed(c: Critter, tuning: TuningStore): number {
  return tuning.get('enemy.speed') * c.envValue * c.reactMult;
}

/** Advance one critter. Returns 'arrived' when it reaches the heart. */
export function stepCritter(
  c: Critter,
  dt: number,
  ctx: { mesh: SphereMesh; dungeon: Dungeon; tuning: TuningStore; rng: Rng },
): 'moving' | 'arrived' {
  if (!c.alive) return 'moving';

  const { mesh, dungeon, tuning, rng } = ctx;

  // ── 1. Update speed envelope ──────────────────────────────────────────────
  c.envLeft -= dt;
  if (c.envLeft <= 0) {
    // Re-target: pick a new envTarget and a new phase window
    c.envTarget = sampleEnvTarget(rng, tuning);
    const phase = nextEnvPhase(rng, tuning);
    c.envLeft = phase;
  }

  // Ease envValue toward envTarget (exponential approach)
  const amp = tuning.get('enemy.surgeAmp');
  if (amp === 0) {
    c.envValue = 1;
  } else {
    const diff = c.envTarget - c.envValue;
    c.envValue += diff * Math.min(1, EASE_RATE * dt);
    // Clamp to [1-amp, 1+amp] so floating-point drift can't escape
    c.envValue = Math.max(1 - amp, Math.min(1 + amp, c.envValue));
  }

  // ── 2. Update hit reaction timer ──────────────────────────────────────────
  if (c.reactLeft > 0) {
    c.reactLeft -= dt;
    if (c.reactLeft <= 0) {
      c.reactLeft = 0;
      c.reactMult = 1;
    }
  }

  // ── 3. Move along nav graph ───────────────────────────────────────────────
  // On the very first step, cur === next (from spawn). Resolve next here.
  if (c.cur === c.next) {
    // At a cell with no target: pick best downhill neighbor
    if (dungeon.distToHeart[c.cur] === 0) {
      // Already at heart
      c.pos = mesh.centers[c.cur] ?? c.pos;
      return 'arrived';
    }
    const nb = bestNeighbor(c.cur, dungeon, mesh);
    if (nb === -1) {
      // No downhill neighbor — stranded; just stay put (shouldn't happen on valid dungeon)
      c.pos = mesh.centers[c.cur] ?? c.pos;
      return 'moving';
    }
    c.next = nb;
    c.prog = 0;
  }

  const speed = effectiveSpeed(c, tuning);
  let budget = speed * dt; // world-distance budget this tick

  // Carry leftover distance across multiple cell arrivals in one tick
  while (budget > 0) {
    const curCenter = mesh.centers[c.cur];
    const nextCenter = mesh.centers[c.next];
    if (curCenter === undefined || nextCenter === undefined) break;

    const segLength = segLen(mesh, c.cur, c.next);
    const remaining = (1 - c.prog) * segLength; // world-distance left in segment

    if (budget >= remaining) {
      // Arrive at next cell
      budget -= remaining;
      c.cur = c.next;
      c.prog = 0;

      // Check if we've reached the heart
      if (dungeon.distToHeart[c.cur] === 0) {
        c.pos = mesh.centers[c.cur] ?? c.pos;
        return 'arrived';
      }

      // Pick next segment
      const nb = bestNeighbor(c.cur, dungeon, mesh);
      if (nb === -1) {
        // Dead-end or heart (covered above)
        c.next = c.cur;
        break;
      }
      c.next = nb;
    } else {
      // Advance within current segment
      c.prog += budget / segLength;
      budget = 0;
    }
  }

  // Interpolate world position
  const ca = mesh.centers[c.cur] ?? ([0, 0, 0] as Vec3);
  const cb = mesh.centers[c.next] ?? ca;
  c.pos = lerpVec3(ca, cb, c.cur === c.next ? 0 : c.prog);

  return 'moving';
}

/** Apply damage. Returns true if the critter was killed by this hit. */
export function hitCritter(c: Critter, damage: number, tuning: TuningStore): boolean {
  if (!c.alive) return false;
  c.hp -= damage;
  if (c.hp <= 0) {
    c.alive = false;
    return true;
  }
  // Apply hit reaction
  const accel = tuning.get('enemy.accelOnHit');
  const dur = tuning.get('enemy.reactionDur');
  c.reactMult = accel;
  c.reactLeft = dur;
  return false;
}
