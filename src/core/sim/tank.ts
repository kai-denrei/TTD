// tank.ts — the player tank: movement, shooting, HP.
//
// Design:
//   - All levers read LIVE — never captured.
//   - No Math.random — heading is updated deterministically from TankInput.
//   - Returns DamageEvents for critters hit; the World resolves damage.
//   - Tank HP reduced by World after god-mode check.

import type { Vec3 } from '../sphere/vec3.ts';
import { add, scale, normalize, cross, len } from '../sphere/vec3.ts';
import type { TuningStore } from '../tuning/store.ts';
import type { Critter } from './critters.ts';

// ---- Public types -----------------------------------------------------------

export type Tank = {
  pos: Vec3;
  cell: number;
  heading: Vec3;
  cooldown: number;
  hp: number;
  hits: number;
};

export type TankInput = {
  forward: number; // -1..1
  turn: number;    // -1..1
  fire: boolean;
};

export type TankDamageEvent = {
  critterId: number;
  damage: number;
};

// ---- Tank factory -----------------------------------------------------------

export function makeTank(pos: Vec3, cell: number): Tank {
  return {
    pos,
    cell,
    heading: [0, 1, 0], // arbitrary initial heading
    cooldown: 0,
    hp: 100,
    hits: 0,
  };
}

// ---- Tank step --------------------------------------------------------------

/**
 * Advance the tank by dt given player input.
 * Returns damage events for critters in ramming/firing range.
 * The World is responsible for applying damage and god-mode checks.
 *
 * Movement model: the tank moves along the sphere surface (pos is unit-sphere).
 * heading is tangent to the sphere at pos. turn rotates heading around the
 * surface normal (pos itself on a unit sphere). forward moves along heading.
 *
 * tankActing = |forward| > 0 || fire (for telemetry idle-under-threat).
 */
export function stepTank(
  tank: Tank,
  dt: number,
  input: TankInput,
  critters: Critter[],
  tuning: TuningStore,
): { events: TankDamageEvent[]; acting: boolean } {
  const speed = tuning.get('tank.speed');
  const damage = tuning.get('tank.damage');
  const fireRate = tuning.get('tank.fireRate');

  // ── Turn: rotate heading around surface normal (pos for unit sphere) ───────
  if (input.turn !== 0) {
    const normal: Vec3 = normalize(tank.pos); // surface normal = pos on unit sphere
    // NEGATED: a positive rotation about an OUTWARD normal is counter-clockwise
    // seen from outside — a LEFT turn. Without the sign, pressing right steers
    // left, which is what M0b shipped. Pinned by a numeric case in
    // tank.test.ts rather than by an argument about winding, since an argument
    // about winding is what produced the bug.
    const turnAmount = -input.turn * Math.PI * dt; // radians
    // Rodrigues rotation of heading around normal
    tank.heading = rodriguezRotate(tank.heading, normal, turnAmount);
  }

  // ── Move: advance along heading on sphere surface ─────────────────────────
  if (input.forward !== 0) {
    const h = normalize(tank.heading);
    const step = scale(h, input.forward * speed * dt);
    const newPos: Vec3 = [
      tank.pos[0] + step[0],
      tank.pos[1] + step[1],
      tank.pos[2] + step[2],
    ];
    // Project back to unit sphere
    const l = len(newPos);
    if (l > 0) {
      tank.pos = [newPos[0] / l, newPos[1] / l, newPos[2] / l];
    }
    // Re-orthogonalize heading against new normal
    const normal: Vec3 = normalize(tank.pos);
    tank.heading = tangentProject(tank.heading, normal);
  }

  // ── Fire cooldown ──────────────────────────────────────────────────────────
  if (tank.cooldown > 0) tank.cooldown -= dt;

  const events: TankDamageEvent[] = [];
  if (input.fire && tank.cooldown <= 0) {
    // Fire at nearest alive critter within range (live lever: tank.range)
    const fireRange = tuning.get('tank.range');
    let target: Critter | null = null;
    let bestDist = Infinity;
    for (const c of critters) {
      if (!c.alive) continue;
      // Simple range check (tank fires in all directions in M0)
      const dx = c.pos[0] - tank.pos[0];
      const dy = c.pos[1] - tank.pos[1];
      const dz = c.pos[2] - tank.pos[2];
      const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
      if (d > fireRange) continue;
      if (d < bestDist || (d === bestDist && target !== null && c.id < target.id)) {
        bestDist = d;
        target = c;
      }
    }
    if (target !== null) {
      events.push({ critterId: target.id, damage });
      tank.cooldown = fireRate;
    }
  }

  // Turning counts. A tank pivoting to bring its guns to bear while enemies are
  // alive is not idle, and tankIdleUnderThreat is the metric vision §8 names for
  // spotting a tank with nothing to do — it must not lie in that direction.
  const acting = Math.abs(input.forward) > 0 || Math.abs(input.turn) > 0 || input.fire;
  return { events, acting };
}

// ---- Geometry helpers -------------------------------------------------------

/** Rodrigues rotation of vector v around unit axis k by angle theta (radians). */
function rodriguezRotate(v: Vec3, k: Vec3, theta: number): Vec3 {
  const cosT = Math.cos(theta);
  const sinT = Math.sin(theta);
  const c = cross(k, v);
  const d = (v[0] * k[0] + v[1] * k[1] + v[2] * k[2]) * (1 - cosT);
  return [
    v[0] * cosT + c[0] * sinT + k[0] * d,
    v[1] * cosT + c[1] * sinT + k[1] * d,
    v[2] * cosT + c[2] * sinT + k[2] * d,
  ];
}

/** Project heading onto the tangent plane at normal, renormalize. */
function tangentProject(heading: Vec3, normal: Vec3): Vec3 {
  const d = heading[0] * normal[0] + heading[1] * normal[1] + heading[2] * normal[2];
  const t: Vec3 = [
    heading[0] - d * normal[0],
    heading[1] - d * normal[1],
    heading[2] - d * normal[2],
  ];
  const l = len(t);
  if (l < 1e-10) {
    // heading was nearly parallel to normal — pick an arbitrary tangent
    const ref: Vec3 = Math.abs(normal[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    return tangentProject(ref, normal);
  }
  return [t[0] / l, t[1] / l, t[2] / l];
}

// Re-export for world.ts convenience
export { add, scale, normalize, cross };
