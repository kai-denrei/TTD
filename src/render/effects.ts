// effects.ts — everything that flashes, streaks or bursts.
//
// WHY THIS EXISTS AT ALL. M0b drew state, not events: a tower killing a critter
// was a state transition with no visual trace, which is the whole of "towers
// don't fire, or it's hard to tell". core/sim/events.ts gave the simulation a
// way to say what happened; this file is what listens.
//
// ONE PARTICLE POOL, NOT FOUR SYSTEMS. Muzzle flashes, hit flashes, beams and
// death bursts differ only in where they spawn, how fast they move and what
// colour they are. Giving each its own buffer would triple the bookkeeping to
// express a difference that is three numbers wide.
//
// PREALLOCATED, LIKE points.ts. Effects fire in bursts precisely when the game
// is busiest, so an effect system that allocates per impact spikes GC at the
// worst possible moment. Capacity is a hard ceiling; overflow is dropped.
//
// EVERYTHING HERE IS EMISSIVE. M0c-1 established that the terrain sits
// deliberately below the bloom threshold so it reads by relief rather than
// brightness. These are the things allowed to glow, and that contrast is what
// makes combat legible against a dim board.

import * as THREE from 'three';
import type { Vec3 } from '../core/sphere/vec3.ts';
import type { WorldEvent } from '../core/sim/events.ts';
import type { Projectile } from '../core/sim/projectiles.ts';

const PARTICLE_CAP = 3000;
const TRACER_CAP = 400;
/** Points drawn behind each shot. The head is brightest, so a tracer reads as
 *  a direction rather than a dot. */
const TRACER_TAIL = 5;
const TRACER_GAP = 0.008;

// Vertex colours are NOT clamped to 1 before the shader, and the material is
// additive, so pushing past 1 is how an effect clears the bloom threshold and
// actually reads as a flash rather than a tinted dot. The terrain deliberately
// sits below that threshold (M0c-1), so this is the whole contrast budget.
const INTENSITY = 3.4;

const C_SHOT = new THREE.Color(0xffd08a);
const C_IMPACT = new THREE.Color(0xfff4d6);
const C_DEATH = new THREE.Color(0xff6a3c);
const C_BEAM = new THREE.Color(0x9dffc4);
const C_HEART = new THREE.Color(0xff3060);

export type Effects = {
  group: THREE.Group;
  sync(
    events: readonly WorldEvent[],
    projectiles: readonly Projectile[],
    dt: number,
    fx: { flashDur: number; burstSize: number },
  ): void;
};

export function makeEffects(): Effects {
  // ── particle pool ────────────────────────────────────────────────────────
  const px = new Float32Array(PARTICLE_CAP * 3);
  const pcol = new Float32Array(PARTICLE_CAP * 3);
  const vel = new Float32Array(PARTICLE_CAP * 3);
  const life = new Float32Array(PARTICLE_CAP);
  const maxLife = new Float32Array(PARTICLE_CAP);
  const baseCol = new Float32Array(PARTICLE_CAP * 3);
  let liveCount = 0; // particles are kept compacted into [0, liveCount)

  const pGeo = new THREE.BufferGeometry();
  const pPos = new THREE.BufferAttribute(px, 3);
  const pClr = new THREE.BufferAttribute(pcol, 3);
  pPos.setUsage(THREE.DynamicDrawUsage);
  pClr.setUsage(THREE.DynamicDrawUsage);
  pGeo.setAttribute('position', pPos);
  pGeo.setAttribute('color', pClr);

  const particles = new THREE.Points(
    pGeo,
    new THREE.PointsMaterial({
      size: 0.009, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  particles.frustumCulled = false;

  // ── tracers (rebuilt from live projectiles each frame) ───────────────────
  const tx = new Float32Array(TRACER_CAP * TRACER_TAIL * 3);
  const tcol = new Float32Array(TRACER_CAP * TRACER_TAIL * 3);
  const tGeo = new THREE.BufferGeometry();
  const tPos = new THREE.BufferAttribute(tx, 3);
  const tClr = new THREE.BufferAttribute(tcol, 3);
  tPos.setUsage(THREE.DynamicDrawUsage);
  tClr.setUsage(THREE.DynamicDrawUsage);
  tGeo.setAttribute('position', tPos);
  tGeo.setAttribute('color', tClr);

  const tracers = new THREE.Points(
    tGeo,
    new THREE.PointsMaterial({
      size: 0.012, sizeAttenuation: true, vertexColors: true,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }),
  );
  tracers.frustumCulled = false;

  const group = new THREE.Group();
  group.name = 'effects';
  group.add(particles, tracers);

  let warned = false;

  function spawn(at: Vec3, dir: Vec3, speed: number, ttl: number, c: THREE.Color): void {
    if (liveCount >= PARTICLE_CAP) {
      if (!warned) {
        console.warn(`[effects] particle cap ${PARTICLE_CAP} reached; extras dropped`);
        warned = true;
      }
      return;
    }
    const i = liveCount++;
    const o = i * 3;
    // Lift slightly off the surface so effects are not z-fighting the floor.
    const l = Math.hypot(at[0], at[1], at[2]) || 1;
    const k = (l + 0.006) / l;
    px[o] = at[0] * k; px[o + 1] = at[1] * k; px[o + 2] = at[2] * k;
    vel[o] = dir[0] * speed; vel[o + 1] = dir[1] * speed; vel[o + 2] = dir[2] * speed;
    baseCol[o] = c.r * INTENSITY; baseCol[o + 1] = c.g * INTENSITY; baseCol[o + 2] = c.b * INTENSITY;
    life[i] = ttl;
    maxLife[i] = ttl;
  }

  /** A puff of particles thrown out from `at` on a deterministic spray. No
   *  Math.random: effects are cosmetic, but a replay that looks different every
   *  time is a replay you cannot trust your eyes on. */
  function puff(at: Vec3, n: number, speed: number, ttl: number, c: THREE.Color, seed: number): void {
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + seed;
      const y = 1 - (2 * (i + 0.5)) / n;
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      spawn(at, [r * Math.cos(a), y, r * Math.sin(a)], speed, ttl, c);
    }
  }

  function stepParticles(dt: number): void {
    let w = 0;
    for (let i = 0; i < liveCount; i++) {
      const remaining = life[i]! - dt;
      if (remaining <= 0) continue;
      const src = i * 3;
      const dst = w * 3;
      // Compact survivors toward the front so the draw range stays contiguous.
      px[dst] = px[src]! + vel[src]! * dt;
      px[dst + 1] = px[src + 1]! + vel[src + 1]! * dt;
      px[dst + 2] = px[src + 2]! + vel[src + 2]! * dt;
      vel[dst] = vel[src]!; vel[dst + 1] = vel[src + 1]!; vel[dst + 2] = vel[src + 2]!;
      baseCol[dst] = baseCol[src]!; baseCol[dst + 1] = baseCol[src + 1]!; baseCol[dst + 2] = baseCol[src + 2]!;
      life[w] = remaining;
      maxLife[w] = maxLife[i]!;
      const f = remaining / (maxLife[i]! || 1); // fade out over the lifetime
      pcol[dst] = baseCol[dst]! * f;
      pcol[dst + 1] = baseCol[dst + 1]! * f;
      pcol[dst + 2] = baseCol[dst + 2]! * f;
      w++;
    }
    liveCount = w;
    pGeo.setDrawRange(0, liveCount);
    pPos.needsUpdate = true;
    pClr.needsUpdate = true;
  }

  function sync(
    events: readonly WorldEvent[],
    projectiles: readonly Projectile[],
    dt: number,
    fx: { flashDur: number; burstSize: number },
  ): void {
    let seed = 0;
    for (const e of events) {
      seed += 1.7;
      switch (e.kind) {
        case 'shotFired':
          // Muzzle flash: thrown forward along the barrel so it reads as a
          // direction, not a blob.
          puff(e.at, 7, 0.35, fx.flashDur, C_SHOT, seed);
          spawn(e.at, e.dir, 0.5, fx.flashDur, C_SHOT);
          break;
        case 'impact':
          puff(e.at, 10, 0.5, fx.flashDur, C_IMPACT, seed);
          break;
        case 'critterDied':
          // Scales with fx.burstSize; at 0 the burst disappears entirely.
          puff(e.at, 22, 0.8 * fx.burstSize, fx.flashDur * 2.5, C_DEATH, seed);
          break;
        case 'beam': {
          // Hitscan: a line of particles from muzzle to target, no velocity.
          const n = 14;
          for (let i = 0; i <= n; i++) {
            const t = i / n;
            spawn(
              [
                e.from[0] + (e.to[0] - e.from[0]) * t,
                e.from[1] + (e.to[1] - e.from[1]) * t,
                e.from[2] + (e.to[2] - e.from[2]) * t,
              ],
              [0, 0, 0], 0, fx.flashDur, C_BEAM,
            );
          }
          break;
        }
        case 'heartHit':
          puff(e.at, 16, 0.6, fx.flashDur * 2, C_HEART, seed);
          break;
        case 'tankHit':
          puff(e.at, 12, 0.5, fx.flashDur * 1.5, C_BEAM, seed);
          break;
      }
    }

    stepParticles(dt);

    // ── tracers ──────────────────────────────────────────────────────────────
    let t = 0;
    for (const p of projectiles) {
      if (t >= TRACER_CAP) break;
      const o = t * TRACER_TAIL * 3;
      const l = Math.hypot(p.pos[0], p.pos[1], p.pos[2]) || 1;
      const k = (l + 0.006) / l;
      for (let s = 0; s < TRACER_TAIL; s++) {
        const back = s * TRACER_GAP;
        const j = o + s * 3;
        tx[j] = (p.pos[0] - p.dir[0] * back) * k;
        tx[j + 1] = (p.pos[1] - p.dir[1] * back) * k;
        tx[j + 2] = (p.pos[2] - p.dir[2] * back) * k;
        const fade = 1 - s / TRACER_TAIL; // head brightest
        tcol[j] = C_SHOT.r * fade * INTENSITY;
        tcol[j + 1] = C_SHOT.g * fade * INTENSITY;
        tcol[j + 2] = C_SHOT.b * fade * INTENSITY;
      }
      t++;
    }
    tGeo.setDrawRange(0, t * TRACER_TAIL);
    tPos.needsUpdate = true;
    tClr.needsUpdate = true;
  }

  return { group, sync };
}
