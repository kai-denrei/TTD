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

/** Emissive multiplier for unit dot-clouds. Sized so a unit clears
 *  bloom.threshold (0.8) while the gamma-compensated terrain stays under it. */
const UNIT_INTENSITY = 3.6;

/** Same gamma pre-compensation the terrain uses (see render/geometry.ts).
 *
 *  This was the asymmetry that made units invisible: terrain colours were
 *  corrected for the ~v^2.2 crush on the way to the screen and unit colours were
 *  not, so the ground was lit correctly and everything standing on it rendered
 *  DARKER than the ground. Measured: 2470 points drawing 0.37 from the camera
 *  and still not visible. Fixing terrain alone was fixing half a pipeline. */
function toneUp(c: THREE.Color): THREE.Color {
  return new THREE.Color(
    Math.pow(c.r, 1 / 2.2),
    Math.pow(c.g, 1 / 2.2),
    Math.pow(c.b, 1 / 2.2),
  );
}

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
  add(pos: Vec3, scale: number, basis: Basis, tint: number, colorOverride?: THREE.Color): void;
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
      opacity: opts.opacity ?? 0.95,
      // NORMAL blending, not additive. Additive worked while the board was
      // near-black — a unit ADDED light and stood out. Once the board was lit
      // properly the same units added light to an already-light surface and
      // washed out into haze: measured 2470 points drawing 0.37 from the camera
      // and still invisible. Units are SOLID OBJECTS and should occlude the
      // ground they stand on. Effects stay additive, because a muzzle flash IS
      // added light.
      // ALWAYS ON TOP. Depth-testing units against the board loses them: a
      // controlled comparison at one instant showed six clearly-rendered
      // phages and the tank with the board hidden, and nothing at all with it
      // visible. Units are the thing the player is tracking; a board that can
      // swallow them is worse than one drawn behind them unconditionally.
      depthWrite: false,
      depthTest: false,
      blending: THREE.NormalBlending,
    }),
  );
  object.frustumCulled = false;

  // Units are meant to GLOW against a matte board. Vertex colours are not
  // clamped before the shader and the material is additive, so pushing past 1
  // is how a unit clears the bloom threshold. Without this they sit just under
  // it and read as flat paint — the board would be legible and the things
  // moving on it would not be.
  const base = toneUp(new THREE.Color(opts.color)).multiplyScalar(UNIT_INTENSITY);
  const hi = toneUp(new THREE.Color(opts.highlight)).multiplyScalar(UNIT_INTENSITY);
  let cursor = 0;
  let warned = false;

  function begin(): void {
    cursor = 0;
  }

  function add(pos: Vec3, scale: number, basis: Basis, tint: number, colorOverride?: THREE.Color): void {
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
      // A per-instance colour lets one pooled cloud draw a whole roster of
      // enemy types — twelve separate Points objects would be twelve draw calls
      // and twelve buffers to express what is really just a hue.
      const c = p[3] === 1 ? hi : (colorOverride ?? base);
      // A per-species override arrives raw, so it needs the same treatment the
      // pooled base colour already got at construction.
      const boost = colorOverride === undefined ? 1 : UNIT_INTENSITY;
      colors[o] = c.r * tint * boost;
      colors[o + 1] = c.g * tint * boost;
      colors[o + 2] = c.b * tint * boost;
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
