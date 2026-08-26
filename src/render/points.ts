// points.ts — pooled dot-cloud renderer.
//
// WHY POOLED BUFFERS, NOT INSTANCING. Peak M0 load is ~16 critters x 490 pts
// plus ~10 towers x 590 pts, about 13.7k points. At that scale, writing into a
// pre-allocated Float32Array and setting drawRange is far simpler than an
// InstancedBufferGeometry with a custom shader, and the cost is unmeasurable.
// Allocate once at construction; never allocate in a frame.
//
// HIGHLIGHTS ARE COLOUR, NOT SIZE. PointsMaterial has no per-vertex size
// attribute. p[3] === 1 points get a brighter colour, which pushes them past
// the bloom threshold and makes them glow — the library's "look here" channel
// survives. Per-point size would need a custom shader; a later refinement,
// deliberately not done here.
//
// SIZE IS DERIVED FROM MODEL SCALE, NOT AUTHORED PER CLOUD. Point size is in
// world units under sizeAttenuation, so a hand-picked constant that looks
// right from orbit becomes a saturated white blob from the chase camera 0.16
// radii away — 500+ additive points overlapping until everything clips to
// white, and the dot-cloud identity disappears exactly where it should read
// best. sizeFactor is a fraction of the model's own radius, so a model looks
// like itself at every distance. Opacity below 1 keeps additive stacking from
// clipping where the cloud is densest.

import * as THREE from 'three';
import type { ModelPoint } from '../core/models/helpers.ts';
import type { Vec3 } from '../core/sphere/vec3.ts';

export type Basis = { fwd: Vec3; up: Vec3; side: Vec3 };

/** Orthonormal basis on the sphere surface: model +Y -> normal (up),
 *  model +X -> heading (fwd), model +Z -> side. `heading` need not be exactly
 *  tangent; it is projected onto the tangent plane and renormalised. */
export function basisAt(normal: Vec3, heading: Vec3): Basis {
  const nl = Math.hypot(normal[0], normal[1], normal[2]) || 1;
  const up: Vec3 = [normal[0] / nl, normal[1] / nl, normal[2] / nl];

  const d = heading[0] * up[0] + heading[1] * up[1] + heading[2] * up[2];
  let fx = heading[0] - up[0] * d;
  let fy = heading[1] - up[1] * d;
  let fz = heading[2] - up[2] * d;
  let fl = Math.hypot(fx, fy, fz);
  if (fl < 1e-6) {
    // heading was parallel to the normal — pick a stable tangent so the model
    // does not collapse or spin. This is the pole-degeneracy case.
    const ref: Vec3 = Math.abs(up[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    fx = ref[1] * up[2] - ref[2] * up[1];
    fy = ref[2] * up[0] - ref[0] * up[2];
    fz = ref[0] * up[1] - ref[1] * up[0];
    fl = Math.hypot(fx, fy, fz) || 1;
  }
  const fwd: Vec3 = [fx / fl, fy / fl, fz / fl];
  const side: Vec3 = [
    up[1] * fwd[2] - up[2] * fwd[1],
    up[2] * fwd[0] - up[0] * fwd[2],
    up[0] * fwd[1] - up[1] * fwd[0],
  ];
  return { fwd, up, side };
}

export type PointCloud = {
  object: THREE.Points;
  begin(): void;
  add(pos: Vec3, scale: number, basis: Basis, tint: number): void;
  end(): void;
};

export function makePointCloud(
  model: readonly ModelPoint[],
  capacity: number,
  opts: { scale: number; sizeFactor: number; color: number; highlight: number; opacity?: number },
): PointCloud {
  const per = model.length;
  const total = per * capacity;
  const positions = new Float32Array(total * 3);
  const colors = new Float32Array(total * 3);

  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(positions, 3);
  const colAttr = new THREE.BufferAttribute(colors, 3);
  posAttr.setUsage(THREE.DynamicDrawUsage);
  colAttr.setUsage(THREE.DynamicDrawUsage);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('color', colAttr);

  const object = new THREE.Points(
    geo,
    new THREE.PointsMaterial({
      size: opts.scale * opts.sizeFactor,
      sizeAttenuation: true,
      vertexColors: true,
      transparent: true,
      opacity: opts.opacity ?? 0.62,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  object.frustumCulled = false;

  const base = new THREE.Color(opts.color);
  const hi = new THREE.Color(opts.highlight);
  let cursor = 0;
  let warned = false;

  function begin(): void {
    cursor = 0;
  }

  function add(pos: Vec3, scale: number, basis: Basis, tint: number): void {
    if (cursor >= capacity) {
      // A reallocation stall mid-wave is worse than a missing dot, so the
      // ceiling is hard. Warn once so it is visible if it ever binds.
      if (!warned) {
        console.warn(`[points] capacity ${capacity} exceeded; extra units not drawn`);
        warned = true;
      }
      return;
    }
    const { fwd, up, side } = basis;
    let o = cursor * per * 3;
    for (let i = 0; i < per; i++) {
      const p = model[i]!;
      const px = p[0] * scale;
      const py = p[1] * scale;
      const pz = p[2] * scale;
      positions[o] = pos[0] + px * fwd[0] + py * up[0] + pz * side[0];
      positions[o + 1] = pos[1] + px * fwd[1] + py * up[1] + pz * side[1];
      positions[o + 2] = pos[2] + px * fwd[2] + py * up[2] + pz * side[2];
      const c = p[3] === 1 ? hi : base;
      colors[o] = c.r * tint;
      colors[o + 1] = c.g * tint;
      colors[o + 2] = c.b * tint;
      o += 3;
    }
    cursor++;
  }

  function end(): void {
    geo.setDrawRange(0, cursor * per);
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
  }

  return { object, begin, add, end };
}
