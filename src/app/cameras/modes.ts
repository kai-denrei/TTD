// modes.ts — the camera roster, declared the way LEVERS declares levers.
//
// WHY A REGISTRY. The operator asked for a camera *system*: bird's-eye and
// cinematic angles for building, third-person and POV for the tank. Declaring
// modes as data means adding a top-down-over-tank or a scripted beat camera
// later is ONE entry, not a refactor. Vision §6.6 already lists beatCameras,
// modeTransition and intensityFraming as camera levers; this is the structure
// they hang off.
//
// PURE ON PURPOSE. Nothing here imports three.js. A mode is a function from
// context to {pos, look, up}, so every mode is Node-testable — including the
// pole degeneracy that would otherwise only show up as a camera spinning on
// screen at 3am.
//
// CONVENTION. The board is a unit sphere, so a surface point is its own
// normal. Distances below are in sphere radii.

import type { Vec3 } from '../../core/sphere/vec3.ts';

export type CamFamily = 'build' | 'tank';

export type CamContext = {
  /** The point of interest on the surface — the tank, or the build cursor. */
  anchor: Vec3;
  /** Unit surface normal at the anchor. */
  normal: Vec3;
  /** Tank heading (build modes use it only as a tangent reference). */
  heading: Vec3;
  /** Elapsed seconds — drives driftorbit. */
  t: number;
  /** User zoom multiplier. */
  zoom: number;
  /** User orbit, radians. Build modes only. */
  orbitYaw: number;
  orbitPitch: number;
};

export type CamFrame = { pos: Vec3; look: Vec3; up: Vec3 };

export type CameraMode = {
  id: string;
  family: CamFamily;
  label: string;
  frame(ctx: CamContext): CamFrame;
};

function norm(v: Vec3): Vec3 {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/** A tangent at `n`, stable everywhere including the poles. Preferring `hint`
 *  keeps the view oriented with the tank; the fallback engages only when hint
 *  is parallel to n — exactly the degenerate case that spins a camera. */
function tangent(n: Vec3, hint: Vec3): Vec3 {
  const d = hint[0] * n[0] + hint[1] * n[1] + hint[2] * n[2];
  const t: Vec3 = [hint[0] - n[0] * d, hint[1] - n[1] * d, hint[2] - n[2] * d];
  if (Math.hypot(t[0], t[1], t[2]) > 1e-6) return norm(t);
  const ref: Vec3 = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  return norm(cross(ref, n));
}

function at(n: Vec3, h: number): Vec3 {
  return [n[0] * h, n[1] * h, n[2] * h];
}

/** How far the build cameras sit above the surface, in sphere radii.
 *
 *  This was 1.15 — a camera 2.15 radii from the centre, which frames the whole
 *  PLANET. At that distance a cell is a few pixels and a tower is a smudge:
 *  every system underneath could be correct and the player would see a grey
 *  ball. The reference games put you close enough to read individual cells,
 *  because a tower defence is played on a board you can actually see.
 *
 *  0.34 puts roughly a dozen cells across the frame at zoom 1, which is the
 *  scale at which a turret reads as a turret and a critter reads as a threat.
 *  Zooming out is still available — it is just no longer the default. */
const BUILD_HEIGHT = 0.34;

export const CAMERA_MODES: readonly CameraMode[] = [
  {
    id: 'birdseye',
    family: 'build',
    label: "Bird's eye",
    frame(ctx) {
      const n = norm(ctx.normal);
      // up must be a TANGENT here, not the normal: looking straight down the
      // normal makes normal-as-up parallel to the view direction.
      const up = tangent(n, ctx.heading);
      return { pos: at(n, 1 + BUILD_HEIGHT * ctx.zoom), look: ctx.anchor, up };
    },
  },
  {
    id: 'raked',
    family: 'build',
    label: 'Raked',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      const side = cross(n, fwd);
      const c = Math.cos(ctx.orbitYaw);
      const s = Math.sin(ctx.orbitYaw);
      const lat: Vec3 = [fwd[0] * c + side[0] * s, fwd[1] * c + side[1] * s, fwd[2] * c + side[2] * s];
      const h = 1 + BUILD_HEIGHT * 0.8 * ctx.zoom;
      const k = BUILD_HEIGHT * 0.75 * ctx.zoom;
      return {
        pos: [n[0] * h + lat[0] * k, n[1] * h + lat[1] * k, n[2] * h + lat[2] * k],
        look: ctx.anchor,
        up: n,
      };
    },
  },
  {
    id: 'driftorbit',
    family: 'build',
    label: 'Drift orbit',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      const side = cross(n, fwd);
      // Slow automatic orbit: the showcase angle. 0.08 rad/s is one revolution
      // every ~78 s — movement you notice without having to track it.
      const a = ctx.t * 0.08;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const lat: Vec3 = [fwd[0] * c + side[0] * s, fwd[1] * c + side[1] * s, fwd[2] * c + side[2] * s];
      const h = 1 + BUILD_HEIGHT * 0.55 * ctx.zoom;
      const k = BUILD_HEIGHT * 1.0 * ctx.zoom;
      return {
        pos: [n[0] * h + lat[0] * k, n[1] * h + lat[1] * k, n[2] * h + lat[2] * k],
        look: ctx.anchor,
        up: n,
      };
    },
  },
  {
    id: 'chase',
    family: 'tank',
    label: 'Chase',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      // Must clear the walls. The board extrudes BLOCKED cells to 0.045, and
      // at the old rise of 0.075 the camera sat barely above them — any wall
      // between camera and tank swallowed the tank entirely, which is what
      // adding walls did to the main driving view. Rise is now ~3x wall height
      // so the tank stays visible while cornering along a wall run.
      const back = 0.20 * ctx.zoom;
      const rise = 0.14 * ctx.zoom;
      return {
        pos: [
          ctx.anchor[0] - fwd[0] * back + n[0] * rise,
          ctx.anchor[1] - fwd[1] * back + n[1] * rise,
          ctx.anchor[2] - fwd[2] * back + n[2] * rise,
        ],
        look: [
          ctx.anchor[0] + fwd[0] * 0.1,
          ctx.anchor[1] + fwd[1] * 0.1,
          ctx.anchor[2] + fwd[2] * 0.1,
        ],
        up: n,
      };
    },
  },
  {
    id: 'pov',
    family: 'tank',
    label: 'POV',
    frame(ctx) {
      const n = norm(ctx.normal);
      const fwd = tangent(n, ctx.heading);
      // Eye height sits just above the wall tops (0.045). Lower is more
      // immersive but you are then driving blind down a trench, which is a
      // deliberate choice for later — not the default for the mode you use to
      // check whether the tank is working at all.
      const pos: Vec3 = [
        ctx.anchor[0] + n[0] * 0.055,
        ctx.anchor[1] + n[1] * 0.055,
        ctx.anchor[2] + n[2] * 0.055,
      ];
      return {
        pos,
        look: [pos[0] + fwd[0] * 0.2, pos[1] + fwd[1] * 0.2, pos[2] + fwd[2] * 0.2],
        up: n,
      };
    },
  },
];
