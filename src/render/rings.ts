// rings.ts — range rings drawn ON the sphere, not through it.
//
// WHY A RING AT ALL. Range is the one tower stat a player cannot read off the
// board. Damage and rate announce themselves the moment a tower fires; reach
// is invisible until something walks out of it, so "why is this tower idle?"
// has no answer on screen. The ring is that answer, and it is also the whole
// of the placement decision: a tower is bought for the ground it covers.
//
// THE RADIUS IS A CHORD, AND THAT IS NOT A DETAIL. towers.ts targets with
// `dist(tower.pos, critter.pos) <= rangeWorld` — a straight-line EUCLIDEAN
// distance through the sphere, not an arc along its surface. Drawing
// rangeWorld as if it were arc length paints a ring that is wrong everywhere
// and wrongest where range is largest (a sniper at 7 cells), so the picture
// would disagree with the sim exactly where the player is looking hardest.
// Chord d on the unit sphere subtends 2·asin(d/2), so that conversion happens
// here, once, and the ring lands on the true boundary of what the tower hits.
//
// POOLED LIKE points.ts / effects.ts. Every buffer is allocated at
// construction; show() writes into a slot and sync() only rewrites colours.
// Rings appear precisely while the player is tapping the board, so a renderer
// that allocated per call would spike GC during the one interaction that has
// to feel immediate.
//
// EMISSIVE, like everything else that is allowed to glow. The terrain sits
// deliberately under the bloom threshold (see geometry.ts), so pushing ring
// colour past 1 is what makes it read as a light on the board rather than as
// paint on it.

import * as THREE from 'three';
import type { Vec3 } from '../core/sphere/vec3.ts';
import { WALL_HEIGHT } from './geometry.ts';

/** Slot 0 is the sticky ring; 1.. are transient. Eight is far more than the UI
 *  asks for and still under 800 points total. */
const RING_CAP = 8;
/** Points per ring. At 96 a ring reads as a dotted circle rather than a solid
 *  line, which is the library's visual language, and stays legible when the
 *  sniper's ring is stretched over a quarter of the globe. */
const SEG = 96;
/** Clear of the wall tops the towers themselves stand on, so a ring crossing a
 *  wall run is not buried in it. */
const LIFT = 0.004;
const INTENSITY = 1.8;

export type Rings = {
  group: THREE.Group;
  /** Draw a ring of great-circle radius `radiusWorld` (a CHORD distance, the
   *  same units towers.ts compares against) around `center`.
   *
   *  `ttl` 0 (or less) is the STICKY ring: it stays until the next sticky
   *  show() replaces it, or until hide() clears it. There is exactly one, on
   *  purpose — the API hands back no handle, so a second sticky ring could
   *  never be addressed to take it down again. Positive `ttl` is a transient
   *  ring that fades out over that many seconds. */
  show(center: Vec3, radiusWorld: number, color: number, ttl: number): void;
  /** Clear the sticky ring. Transient rings expire on their own. */
  hide(): void;
  /** Advance fades. Call once per frame with the frame delta. */
  sync(dt: number): void;
};

export function makeRings(): Rings {
  const positions = new Float32Array(RING_CAP * SEG * 3);
  const colors = new Float32Array(RING_CAP * SEG * 3);

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);
  // The draw range is the whole pool for the life of the renderer. An inactive
  // slot is drawn with colour 0, and additive blending makes black contribute
  // nothing — cheaper and less error-prone than compacting slots to keep the
  // live ones contiguous.
  geo.setDrawRange(0, RING_CAP * SEG);

  const object = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: 0.007,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  object.frustumCulled = false;
  object.name = 'rings';

  const group = new THREE.Group();
  group.name = 'rings';
  group.add(object);

  // ── per-slot state, all preallocated ────────────────────────────────────
  const active = new Uint8Array(RING_CAP);
  const life = new Float32Array(RING_CAP);
  const maxLife = new Float32Array(RING_CAP);
  const base = new Float32Array(RING_CAP * 3); // ring colour, pre-intensity
  /** cx, cy, cz, radius of what is currently written into each slot, so a
   *  caller that calls show() every frame with unchanged arguments does not
   *  rewrite 96 positions every frame. */
  const shape = new Float32Array(RING_CAP * 4);
  /** Last fade written per slot; -1 forces the first write. */
  const drawnFade = new Float32Array(RING_CAP).fill(-1);

  const scratch = new THREE.Color();
  let dirtyPos = false;
  let dirtyCol = false;

  /** Write one ring's SEG positions. The tangent basis is computed with scalars
   *  rather than via vec3.tangentBasis so that show() allocates nothing even
   *  when a caller drives it from inside the frame loop. */
  function writeRing(slot: number, center: Vec3, radiusWorld: number): void {
    const cl = Math.hypot(center[0], center[1], center[2]) || 1;
    const nx = center[0] / cl;
    const ny = center[1] / cl;
    const nz = center[2] / cl;

    // Chord -> angular radius. Clamped: a range lever cranked past the world's
    // own diameter must render as a ring around the far side rather than as
    // NaN. (M0a shipped a range lever that quietly exceeded the diameter; the
    // lesson was that the geometry has to say so instead of failing silently.)
    const chord = Math.min(2, Math.max(0, radiusWorld));
    const ang = 2 * Math.asin(chord / 2);

    // Any axis not parallel to the normal gives a valid tangent frame; the ring
    // is rotationally symmetric, so which one is arbitrary. These are the two
    // cross products (0,1,0)×n and (1,0,0)×n, written out — near the poles the
    // first degenerates, which is the whole reason for the branch.
    const polar = Math.abs(ny) >= 0.9;
    let ux = polar ? 0 : nz;
    let uy = polar ? -nz : 0;
    let uz = polar ? ny : -nx;
    const ul = Math.hypot(ux, uy, uz) || 1;
    ux /= ul; uy /= ul; uz /= ul;
    const vx = ny * uz - nz * uy;
    const vy = nz * ux - nx * uz;
    const vz = nx * uy - ny * ux;

    const r = 1 + WALL_HEIGHT + LIFT;
    const ca = Math.cos(ang) * r;
    const sa = Math.sin(ang) * r;

    let o = slot * SEG * 3;
    for (let i = 0; i < SEG; i++) {
      const t = (i / SEG) * Math.PI * 2;
      const ct = Math.cos(t);
      const st = Math.sin(t);
      positions[o] = nx * ca + (ux * ct + vx * st) * sa;
      positions[o + 1] = ny * ca + (uy * ct + vy * st) * sa;
      positions[o + 2] = nz * ca + (uz * ct + vz * st) * sa;
      o += 3;
    }
    dirtyPos = true;
  }

  function paint(slot: number, fade: number): void {
    if (drawnFade[slot] === fade) return;
    drawnFade[slot] = fade;
    const b = slot * 3;
    const r = base[b]! * INTENSITY * fade;
    const g = base[b + 1]! * INTENSITY * fade;
    const bl = base[b + 2]! * INTENSITY * fade;
    let o = slot * SEG * 3;
    for (let i = 0; i < SEG; i++) {
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = bl;
      o += 3;
    }
    dirtyCol = true;
  }

  /** A free transient slot, or the one closest to expiring. Overwriting the
   *  shortest-lived ring loses the least information. */
  function transientSlot(): number {
    let best = 1;
    let bestLife = Infinity;
    for (let s = 1; s < RING_CAP; s++) {
      if (active[s] === 0) return s;
      const l = life[s]!;
      if (l < bestLife) { bestLife = l; best = s; }
    }
    return best;
  }

  function show(center: Vec3, radiusWorld: number, color: number, ttl: number): void {
    const sticky = ttl <= 0;
    const slot = sticky ? 0 : transientSlot();

    scratch.setHex(color);
    const b = slot * 3;
    const colorChanged =
      base[b] !== scratch.r || base[b + 1] !== scratch.g || base[b + 2] !== scratch.b;
    base[b] = scratch.r;
    base[b + 1] = scratch.g;
    base[b + 2] = scratch.b;

    const s = slot * 4;
    const same =
      active[slot] === 1 &&
      shape[s] === center[0] && shape[s + 1] === center[1] &&
      shape[s + 2] === center[2] && shape[s + 3] === radiusWorld;
    if (!same) {
      shape[s] = center[0];
      shape[s + 1] = center[1];
      shape[s + 2] = center[2];
      shape[s + 3] = radiusWorld;
      writeRing(slot, center, radiusWorld);
    }
    if (colorChanged) drawnFade[slot] = -1;

    active[slot] = 1;
    life[slot] = sticky ? 0 : ttl;
    maxLife[slot] = sticky ? 0 : ttl;
    paint(slot, 1);
  }

  function clear(slot: number): void {
    active[slot] = 0;
    life[slot] = 0;
    maxLife[slot] = 0;
    shape[slot * 4 + 3] = -1; // force a rewrite when the slot is reused
    paint(slot, 0);
  }

  function sync(dt: number): void {
    for (let s = 0; s < RING_CAP; s++) {
      if (active[s] === 0) continue;
      if (maxLife[s]! <= 0) {
        paint(s, 1); // sticky: no fade, and paint() no-ops after the first call
        continue;
      }
      const remaining = life[s]! - dt;
      if (remaining <= 0) {
        clear(s);
        continue;
      }
      life[s] = remaining;
      paint(s, Math.min(1, remaining / maxLife[s]!));
    }
    if (dirtyPos) { posAttr.needsUpdate = true; dirtyPos = false; }
    if (dirtyCol) { colAttr.needsUpdate = true; dirtyCol = false; }
  }

  return {
    group,
    show,
    hide: () => clear(0),
    sync,
  };
}
