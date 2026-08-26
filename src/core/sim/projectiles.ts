// projectiles.ts — tower shots as simulation entities.
//
// WHY NOT A COSMETIC ANIMATION. Before this, towers dealt damage the instant
// they fired: unmissable, untimed, and impossible to see. Drawing a projectile
// over that would be a lie — travel time would affect nothing and a shot could
// never miss.
//
// Making them real buys the thing chunk 3 depends on: vision §6.4 names HK's
// per-tower projSpeed identity as "what stops towers feeling samey". A roster
// of towers that differ only in damage numbers feels like one tower with a
// slider. Travel speed, homing and the possibility of a miss are what give a
// tower a character you can feel before you read its stats.
//
// Shots move along the sphere SURFACE, re-orthogonalising their heading against
// the surface normal each step exactly as stepTank does — without that they
// fly off the sphere on a straight chord.
//
// A shot dies when it exceeds its range, HIT OR NOT (the PoC, td-tab.js:3166).
// Missing is a feature: it is what makes a fast critter genuinely harder rather
// than merely higher-HP.

import type { Vec3 } from '../sphere/vec3.ts';
import type { TuningStore } from '../tuning/store.ts';
import type { Critter } from './critters.ts';
import type { EventSource } from './events.ts';

export type Projectile = {
  id: number;
  pos: Vec3;
  dir: Vec3;
  /** Surface distance covered so far, tested against `range`. */
  travelled: number;
  range: number;
  speed: number;
  damage: number;
  source: EventSource;
  /** Critter id to chase, or null for dumb-fire. */
  homingId: number | null;
  /** Splash radius in world units; 0 for a direct hit. */
  splash: number;
  /** Mortar behaviour: detonate on reaching `range` even without a hit. That
   *  is what makes a mortar an area denial weapon rather than a slow bullet. */
  detonateAtRange: boolean;
};

export type ProjectileHit = {
  critterId: number;
  damage: number;
  source: EventSource;
  at: Vec3;
};

/** How close a shot must pass to count as a hit. Reuses the tank's convention
 *  (a fraction of mean chord) so contact scales with the mesh instead of being
 *  a second magic number that drifts from it. */
export const PROJECTILE_HIT_RADIUS = 0.02;

/** Blend used when a homing shot re-steers: 75% old heading, 25% toward the
 *  target. The PoC's value. A harder blend makes shots turn on a dime and
 *  never miss, which removes the reason projectiles exist. */
const HOMING_BLEND = 0.25;

export function makeProjectile(
  id: number,
  opts: {
    pos: Vec3; dir: Vec3; speed: number; damage: number;
    range: number; source: EventSource; homingId: number | null;
    splash?: number; detonateAtRange?: boolean;
  },
): Projectile {
  return {
    id,
    pos: normalize(opts.pos),
    dir: tangent(opts.dir, normalize(opts.pos)),
    travelled: 0,
    range: opts.range,
    speed: opts.speed,
    damage: opts.damage,
    source: opts.source,
    homingId: opts.homingId,
    splash: opts.splash ?? 0,
    detonateAtRange: opts.detonateAtRange ?? false,
  };
}

/** Advance every projectile one step. Mutates `ps` in place; returns the hits
 *  for the world to resolve and the ids that expired so it can prune them. */
export function stepProjectiles(
  ps: Projectile[],
  critters: readonly Critter[],
  dt: number,
  _tuning: TuningStore,
): { hits: ProjectileHit[]; expired: number[] } {
  const hits: ProjectileHit[] = [];
  const expired: number[] = [];

  for (const p of ps) {
    // Re-steer toward a LIVING target only. A homing shot whose target died
    // keeps its last heading and flies on — which is how a shot misses, and is
    // visibly better than a projectile that freezes or snaps to nothing.
    if (p.homingId !== null) {
      const target = critters.find((c) => c.id === p.homingId && c.alive);
      if (target !== undefined) {
        const n = normalize(p.pos);
        const toward = tangent(
          [target.pos[0] - p.pos[0], target.pos[1] - p.pos[1], target.pos[2] - p.pos[2]],
          n,
        );
        p.dir = tangent(
          [
            p.dir[0] * (1 - HOMING_BLEND) + toward[0] * HOMING_BLEND,
            p.dir[1] * (1 - HOMING_BLEND) + toward[1] * HOMING_BLEND,
            p.dir[2] * (1 - HOMING_BLEND) + toward[2] * HOMING_BLEND,
          ],
          n,
        );
      }
    }

    const step = p.speed * dt;
    const moved: Vec3 = [
      p.pos[0] + p.dir[0] * step,
      p.pos[1] + p.dir[1] * step,
      p.pos[2] + p.dir[2] * step,
    ];
    p.pos = normalize(moved);
    p.dir = tangent(p.dir, p.pos); // stay on the tangent plane after moving
    p.travelled += step;

    // SWEPT COLLISION. The point test below samples once per tick, but at
    // tower.projSpeed 1.2 a shot advances 0.02 per tick — exactly the hit
    // radius — and at the lever's max of 4.0 it advances 0.067. Without a floor
    // scaled to the actual step, fast shots tunnel clean through critters and
    // the lever silently becomes "how reliably do I miss". Same fix, and same
    // reason, as the tank's contact radius in world.ts step 8d.
    const reach = Math.max(PROJECTILE_HIT_RADIUS, 0.5 * step);

    let hit = false;
    for (const c of critters) {
      if (!c.alive) continue;
      const dx = c.pos[0] - p.pos[0];
      const dy = c.pos[1] - p.pos[1];
      const dz = c.pos[2] - p.pos[2];
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) > reach) continue;
      hit = true;
      break;
    }

    // A mortar detonates when it reaches its throw distance whether or not it
    // hit anything — that is what makes it area denial rather than a slow
    // bullet you can simply walk around.
    const detonating = hit || (p.detonateAtRange && p.travelled >= p.range);

    if (detonating) {
      if (p.splash > 0) {
        // Splash pays EVERY critter inside the radius, so one shell into a
        // packed lane is worth many into a spread one. That is the whole
        // reason to buy a mortar.
        for (const c of critters) {
          if (!c.alive) continue;
          const dx = c.pos[0] - p.pos[0];
          const dy = c.pos[1] - p.pos[1];
          const dz = c.pos[2] - p.pos[2];
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) > p.splash) continue;
          hits.push({ critterId: c.id, damage: p.damage, source: p.source, at: c.pos });
        }
      } else if (hit) {
        for (const c of critters) {
          if (!c.alive) continue;
          const dx = c.pos[0] - p.pos[0];
          const dy = c.pos[1] - p.pos[1];
          const dz = c.pos[2] - p.pos[2];
          if (Math.sqrt(dx * dx + dy * dy + dz * dz) > reach) continue;
          hits.push({ critterId: c.id, damage: p.damage, source: p.source, at: p.pos });
          break;
        }
      }
    }

    if (detonating || p.travelled >= p.range) expired.push(p.id);
  }

  return { hits, expired };
}

function normalize(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Project `v` onto the tangent plane at unit normal `n`, renormalised.
 *  Falls back to a stable perpendicular when `v` is parallel to `n`, which is
 *  the same pole degeneracy the camera modes guard against. */
function tangent(v: Vec3, n: Vec3): Vec3 {
  const d = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
  const t: Vec3 = [v[0] - n[0] * d, v[1] - n[1] * d, v[2] - n[2] * d];
  if (Math.hypot(t[0], t[1], t[2]) > 1e-9) return normalize(t);
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return normalize([
    ref[1] * n[2] - ref[2] * n[1],
    ref[2] * n[0] - ref[0] * n[2],
    ref[0] * n[1] - ref[1] * n[0],
  ]);
}
