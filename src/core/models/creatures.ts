// creatures.ts — dot-cloud models for the enemy roster.
//
// Ported from ~/Dev/Braille/fun-shapes/index.html, the same donor as
// turret.ts and mine.ts. Port, don't copy: re-typed to the four-component
// ModelPoint, the ragged `p.push(1)` highlight trick replaced by an explicit
// flag, and every generator's point budget now stated up front so the tests
// can assert it from structure rather than from a run.
//
// WHY THIS FILE EXISTS. enemyspec.ts fields twelve types whose differences are
// structural — rammable, regen, accel-on-hit — but until now every one of them
// drew as the same spiked ball. A roster that reads identically is a roster
// the player cannot learn: the whole point of `accelOnHit` inverting the
// shooting reflex is lost if you cannot tell the barbed mine from the corona
// before you shoot it. The silhouette IS the tell. That argument is doubled
// for scoutufo and drifter, which enemyspec.ts deliberately gives the SAME
// colour (E_YELLOW) on the grounds that "the mesh silhouette separates them" —
// a promise this file is the first to actually keep.
//
// Model convention, inherited from turret.ts/mine.ts: unit radius, +Y up.
// Several of these are flat (z = 0) in the donor — spider and bat are drawn in
// the XY plane. On a sphere that is a liability edge-on, but both shapes are
// pure outline (legs, wings) and a solid-of-revolution version of either reads
// as a blob, which is exactly the failure we are fixing. They stay flat; the
// renderer is expected to bill-board them toward the camera.

import { fibDir, fitUnit, normV } from './helpers.ts';
import type { ModelPoint, V3 } from './helpers.ts';

/** Dot product. helpers.ts exports fibDir/normV/crossV/fitUnit but no dotV,
 *  and only amoebaPts needs one, so it lives here rather than widening the
 *  shared surface for a single caller. */
function dotV(a: V3, b: V3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

// ---- flyers -----------------------------------------------------------------

/** Flying saucer: domed cockpit on a squashed disc, ringed by under-lights.
 *
 *  Rejected for the generic critter in docs/03-braille-assets.md because a disc
 *  collapses edge-on — but that is precisely the read we want for the SCOUT
 *  UFO, the fastest thing on the board: a shape that flickers between wide and
 *  thin as it crosses the sphere signals "you will not hit this with a straight
 *  shot". The eight under-lights are the highlights, so even when the disc is
 *  edge-on there is still a bright row to track.
 *
 *  75 dome (upper half of 150) + 460 disc + 90 rim + 8 lights = 633 points,
 *  8 highlights. The rim sits at exactly r = 1, so fitUnit is a no-op here. */
export function ufoPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  for (let i = 0; i < 150; i++) {
    const d = fibDir(i, 150);
    if (d[1] < 0) continue;
    pts.push([d[0] * 0.42, 0.06 + d[1] * 0.34, d[2] * 0.42, 0]);
  }
  for (let i = 0; i < 460; i++) {
    const d = fibDir(i, 460);
    pts.push([d[0] * 0.98, d[1] * 0.16, d[2] * 0.98, 0]);
  }
  for (let a = 0; a < 90; a++) {
    const ang = (a / 90) * 2 * Math.PI;
    pts.push([Math.cos(ang), 0, Math.sin(ang), 0]);
  }
  for (let k = 0; k < 8; k++) {
    const ang = (k / 8) * 2 * Math.PI;
    pts.push([0.58 * Math.cos(ang), -0.17, 0.58 * Math.sin(ang), 1]);
  }
  return fitUnit(pts);
}

/** Bat: chunky body, pointed ears, two scalloped wings, drawn flat in XY.
 *
 *  The WAVE GHOST is wave 2 — the player's second lesson, and it must not be
 *  mistaken for the wave-1 phage. A wide horizontal wingspan against the
 *  phage's tall vertical lander is the largest silhouette difference available
 *  at this size, and it survives the sphere's foreshortening better than any
 *  difference in body volume would. The scalloped trailing edge is what stops
 *  it reading as a plain bar when the wings are only a few pixels deep.
 *
 *  90 body + 14 ears (2 x 7) + 110 wings (2 x [17 leading + 31 trailing +
 *  7 strut]) + 2 eyes = 216 points, 2 highlights. */
export function batPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  for (let i = 0; i < 90; i++) {
    const d = fibDir(i, 90);
    pts.push([d[0] * 0.15, d[1] * 0.28, 0, 0]);
  }
  for (const sgn of [-1, 1]) {
    for (let s = 0; s <= 6; s++) {
      const f = s / 6;
      pts.push([sgn * 0.09 * (1 - f), 0.26 + f * 0.22, 0, 0]);
    }
  }
  for (const sgn of [-1, 1]) {
    const tipX = sgn * 0.98;
    const tipY = 0.22;
    for (let s = 0; s <= 16; s++) {
      const f = s / 16;
      pts.push([
        sgn * 0.13 + (tipX - sgn * 0.13) * f,
        0.16 + (tipY - 0.16) * f + 0.06 * Math.sin(Math.PI * f),
        0,
        0,
      ]);
    }
    for (let s = 0; s <= 30; s++) {
      const f = s / 30;
      const x = tipX + (sgn * 0.11 - tipX) * f;
      const base = tipY + (-0.34 - tipY) * f;
      const scallop = 0.12 * Math.abs(Math.sin(3 * Math.PI * f));
      pts.push([x, base + scallop, 0, 0]);
    }
    for (let s = 0; s <= 6; s++) {
      const f = s / 6;
      pts.push([sgn * 0.13 + (tipX - sgn * 0.13) * f * 0.9, 0.14 - 0.24 * f, 0, 0]);
    }
  }
  pts.push([-0.07, 0.07, 0, 1], [0.07, 0.07, 0, 1]);
  return fitUnit(pts);
}

// ---- viruses ----------------------------------------------------------------

/** Coronavirus: a fuzzy shell studded with club-tipped spikes.
 *
 *  The CORONAVIRUS and the BARBED MINE are the roster's mirrored pair — one
 *  slows when shot, the other accelerates — and mistaking them costs the run,
 *  so they get the two most opposed silhouettes in the file: a soft radially
 *  symmetric fuzz-ball versus a hard-angled spider. The 264 knob highlights are
 *  a deliberate outlier (over a third of the cloud): at small scale the whole
 *  outer shell glows, which is the "halo/corona" read the name promises and is
 *  unmistakable next to the mine model's 26 isolated spike tips.
 *
 *  320 shell + 44 spikes x (3 stalk + 6 knob) = 716 points, 264 highlights. */
export function coronaPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const R = 0.5;
  const nSpk = 44;
  for (let i = 0; i < 320; i++) {
    const d = fibDir(i, 320);
    pts.push([d[0] * R, d[1] * R, d[2] * R, 0]);
  }
  for (let k = 0; k < nSpk; k++) {
    const d = fibDir(k, nSpk);
    for (let s = 1; s <= 3; s++) {
      const r = R + (s / 3) * 0.28;
      pts.push([d[0] * r, d[1] * r, d[2] * r, 0]);
    }
    const tip = R + 0.34;
    for (let j = 0; j < 6; j++) {
      const e = fibDir(j, 6);
      pts.push([d[0] * tip + e[0] * 0.07, d[1] * tip + e[1] * 0.07, d[2] * tip + e[2] * 0.07, 1]);
    }
  }
  return fitUnit(pts);
}

/** Bacteriophage: the "lunar lander" — icosahedral head, tail sheath, leg fibers.
 *
 *  THE PHAGE is wave 1, the shape the player sees before they have learned
 *  anything, so it carries the most load per dot: a head-on-legs standing on
 *  the surface reads as "a thing that walks toward you" from any camera angle,
 *  which is exactly the lesson (drive over it) that wave 1 teaches. Only the
 *  six foot tips are highlighted — a sparse, spread constellation that stays
 *  countable when the model is ten pixels across, where a lit body would just
 *  smear.
 *
 *  200 head + 150 sheath (15 rings x 10) + 60 baseplate (30 x 2 radii)
 *  + 84 legs (6 x 2 segments x 7) = 494 points, 6 highlights. */
export function phagePts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const hy = 0.5;
  const hR = 0.4;
  const tailTop = 0.1;
  const tailBot = -0.35;
  const tr = 0.1;
  for (let i = 0; i < 200; i++) {
    const d = fibDir(i, 200);
    pts.push([d[0] * hR, hy + d[1] * hR, d[2] * hR, 0]);
  }
  for (let iy = 0; iy <= 14; iy++) {
    const y = tailTop + ((tailBot - tailTop) * iy) / 14;
    for (let a = 0; a < 10; a++) {
      const ang = (a / 10) * 2 * Math.PI;
      pts.push([tr * Math.cos(ang), y, tr * Math.sin(ang), 0]);
    }
  }
  for (let i = 0; i < 30; i++) {
    const a = (i / 30) * 2 * Math.PI;
    for (const rr of [0.12, 0.2]) {
      pts.push([rr * Math.cos(a), tailBot, rr * Math.sin(a), 0]);
    }
  }
  for (let k = 0; k < 6; k++) {
    const ang = (k / 6) * 2 * Math.PI;
    const cx = Math.cos(ang);
    const cz = Math.sin(ang);
    const hip: V3 = [0.14 * cx, tailBot, 0.14 * cz];
    const knee: V3 = [0.2 * cx, tailBot - 0.05, 0.2 * cz];
    const foot: V3 = [0.5 * cx, -0.9, 0.5 * cz];
    const segs: readonly (readonly [V3, V3])[] = [[hip, knee], [knee, foot]];
    for (let si = 0; si < segs.length; si++) {
      const seg = segs[si]!;
      const A = seg[0];
      const B = seg[1];
      for (let s = 0; s <= 6; s++) {
        const f = s / 6;
        // Only the very end of the second segment is a foot tip.
        const hi = si === 1 && s === 6 ? 1 : 0;
        pts.push([
          A[0] + (B[0] - A[0]) * f,
          A[1] + (B[1] - A[1]) * f,
          A[2] + (B[2] - A[2]) * f,
          hi,
        ]);
      }
    }
  }
  return fitUnit(pts);
}

// ---- organisms --------------------------------------------------------------

/** Amoeba: an irregular blob throwing out five finger-like pseudopods, plus a
 *  bright nucleus and two vacuoles.
 *
 *  THE AMOEBA is the first type you can safely leave to a tower and walk away
 *  from, so its job is to be recognisable in peripheral vision. The five pods
 *  point in fixed, hard-coded directions — deliberately NOT symmetric — which
 *  is what makes the outline unmistakable at a glance where a lumpy sphere
 *  would just read as "generic critter". The nucleus is an off-centre bright
 *  cluster rather than a rim highlight, giving the one shape in the file whose
 *  glow is INSIDE the silhouette; that alone separates it from the mine.
 *
 *  620 membrane + 44 nucleus + 28 vacuoles (2 x 14) = 692 points,
 *  44 highlights. */
export function amoebaPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const N = 620;
  const pods: readonly V3[] = [
    [1, 0.2, 0.3],
    [-0.6, 0.1, 0.8],
    [0.2, -0.3, -0.9],
    [-0.9, 0.4, -0.2],
    [0.4, 0.85, 0.1],
  ];
  // Base radius wobbles gently; each pod adds a cos^6 lobe, which is narrow
  // enough that the pods read as fingers rather than as a bulge.
  const bump = (d: V3): number => {
    let r = 0.6 + 0.06 * Math.sin(4 * d[0] + 3 * d[2]);
    for (const p of pods) r += 0.42 * Math.pow(Math.max(0, dotV(d, normV(p))), 6);
    return r;
  };
  for (let i = 0; i < N; i++) {
    const d = fibDir(i, N);
    const r = bump(d);
    pts.push([d[0] * r, d[1] * r * 0.85, d[2] * r, 0]);
  }
  for (let i = 0; i < 44; i++) {
    const d = fibDir(i, 44);
    pts.push([0.12 + d[0] * 0.17, -0.05 + d[1] * 0.17, d[2] * 0.17, 1]);
  }
  const vacuoles: readonly (readonly [number, number, number, number])[] = [
    [-0.3, 0.1, 0.12, 0.12],
    [0.12, 0.28, -0.16, 0.09],
  ];
  for (const [cx, cy, cz, vr] of vacuoles) {
    for (let a = 0; a < 14; a++) {
      const ang = (a / 14) * 2 * Math.PI;
      pts.push([cx + vr * Math.cos(ang), cy + vr * Math.sin(ang), cz, 0]);
    }
  }
  return fitUnit(pts);
}

/** Jellyfish: a domed bell over a rim, trailing sixteen swaying tentacles and
 *  four frilly oral arms.
 *
 *  THE JELLYFISH is the aura carrier — the type you must learn to shoot FIRST,
 *  against every other wave's lesson — so it needs the roster's loudest
 *  "something is happening around me" read. The long trailing skirt is that
 *  read: it occupies far more screen area than the creature's hitbox, so a
 *  pack containing one looks visibly different from a pack that does not, which
 *  is the cue that its 0.14-radius speed aura exists at all.
 *
 *  No highlights. The donor's bell was drawn translucent via the renderer's
 *  alpha treatment, not via the highlight channel, and there is no single
 *  feature on it that deserves the "look here" flag more than the rest — a lit
 *  rim would just outline a circle. Reported rather than invented.
 *
 *  150 bell (upper half of 300) + 40 rim + 336 tentacles (16 x 21)
 *  + 52 oral arms (4 x 13) = 578 points, 0 highlights. */
export function jellyfishPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const R = 0.62;
  for (let i = 0; i < 300; i++) {
    const d = fibDir(i, 300);
    if (d[1] < 0) continue;
    const wob = 1 + 0.05 * Math.sin(6 * Math.atan2(d[2], d[0]));
    pts.push([d[0] * R * wob, 0.2 + d[1] * R * 0.8, d[2] * R * wob, 0]);
  }
  for (let a = 0; a < 40; a++) {
    const ang = (a / 40) * 2 * Math.PI;
    pts.push([R * Math.cos(ang), 0.2, R * Math.sin(ang), 0]);
  }
  for (let k = 0; k < 16; k++) {
    const ang = (k / 16) * 2 * Math.PI;
    const cx = R * 0.9 * Math.cos(ang);
    const cz = R * 0.9 * Math.sin(ang);
    for (let s = 0; s <= 20; s++) {
      const f = s / 20;
      const sway = 0.12 * Math.sin(f * 6 + ang * 2);
      pts.push([cx + sway * Math.cos(ang), 0.2 - f * 1.1, cz + sway * Math.sin(ang), 0]);
    }
  }
  for (let k = 0; k < 4; k++) {
    const ang = (k / 4) * 2 * Math.PI + 0.4;
    for (let s = 0; s <= 12; s++) {
      const f = s / 12;
      const r = 0.16 * (1 - f * 0.5);
      pts.push([r * Math.cos(ang) + 0.05 * Math.sin(f * 8), 0.15 - f * 0.6, r * Math.sin(ang), 0]);
    }
  }
  return fitUnit(pts);
}

/** Slime: a rounded dome over a drippy, wavy skirt.
 *
 *  GREEN SLIME is the regenerator, and the thing the player must read off it is
 *  "soft, and it will come back" — hence a shape with no straight lines and no
 *  spikes anywhere. Its only structural cue is the six-lobed drip skirt, which
 *  is why the base ring is generated separately from the dome rather than being
 *  the dome's equator: the wave has to survive being drawn at a dozen dots.
 *
 *  No highlights. In the donor the slime's face (eyes and mouth) came from a
 *  separate `slimeFeatures(t)` overlay driven by wall-clock time — which core/
 *  is forbidden to touch, and which is not a point cloud anyway (it emits
 *  screen-space dots with radii). Porting it would mean inventing a static
 *  face, so the face is dropped and the loss is recorded here.
 *
 *  286 dome (of 520, those with y >= -0.1) + 64 drip base = 350 points,
 *  0 highlights. */
export function slimePts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const R = 0.8;
  for (let i = 0; i < 520; i++) {
    const d = fibDir(i, 520);
    if (d[1] < -0.1) continue;
    const wob = 1 + 0.06 * Math.sin(5 * Math.atan2(d[2], d[0]));
    pts.push([d[0] * R * wob, -0.18 + d[1] * R, d[2] * R * wob, 0]);
  }
  for (let a = 0; a < 64; a++) {
    const ang = (a / 64) * 2 * Math.PI;
    const drip = -0.18 - 0.12 * (0.5 + 0.5 * Math.sin(6 * ang));
    pts.push([R * Math.cos(ang), drip, R * Math.sin(ang), 0]);
  }
  return fitUnit(pts);
}

/** Spider: round abdomen, smaller head, eight jointed legs, two eyes. Flat.
 *
 *  The BARBED MINE inverts the shooting reflex — chipping it nearly doubles its
 *  speed — so it is the one type that must never be confused with anything
 *  else, least of all with the corona it mirrors. Eight straight jointed legs
 *  give a hard, angular, spiky-but-NOT-radial outline: the visual opposite of
 *  the corona's soft fuzz, and distinct from the mine's even spike spread
 *  because the legs all splay sideways from a two-lobed body.
 *
 *  Only the two eyes are highlighted. Two bright dots close together at one end
 *  of a shape is the strongest "this is facing you" signal available in a dot
 *  cloud, and it is worth more here than lit leg tips, which would fuse with
 *  the corona's lit shell at distance.
 *
 *  150 abdomen + 70 head + 112 legs (2 sides x 4 legs x 2 segments x 7)
 *  + 2 eyes = 334 points, 2 highlights. */
export function spiderPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  for (let i = 0; i < 150; i++) {
    const d = fibDir(i, 150);
    pts.push([d[0] * 0.34, -0.16 + d[1] * 0.34, 0, 0]);
  }
  for (let i = 0; i < 70; i++) {
    const d = fibDir(i, 70);
    pts.push([d[0] * 0.2, 0.28 + d[1] * 0.2, 0, 0]);
  }
  for (const sgn of [-1, 1]) {
    for (let L = 0; L < 4; L++) {
      const y0 = 0.14 - L * 0.14;
      const hip: readonly [number, number] = [sgn * 0.16, y0];
      const knee: readonly [number, number] = [sgn * 0.5, y0 + 0.16];
      const foot: readonly [number, number] = [sgn * 0.85, y0 - 0.12];
      const segs: readonly (readonly [readonly [number, number], readonly [number, number]])[] = [
        [hip, knee],
        [knee, foot],
      ];
      for (const [A, B] of segs) {
        for (let s = 0; s <= 6; s++) {
          const f = s / 6;
          pts.push([A[0] + (B[0] - A[0]) * f, A[1] + (B[1] - A[1]) * f, 0, 0]);
        }
      }
    }
  }
  pts.push([-0.08, 0.32, 0, 1], [0.08, 0.32, 0, 1]);
  return fitUnit(pts);
}

/** Neuron: a soma sprouting six forked dendrites and one long axon ending in a
 *  bright terminal cluster.
 *
 *  Ported because the donor has it and it is genuinely distinct — a branching
 *  asymmetric web is a silhouette nothing else in this file competes with — but
 *  it is NOT in CREATURE_MODELS: no type in the current roster reads as a
 *  neuron (see the fallback note on the map). It is kept exported and tested so
 *  a future type can claim it without a second port, and so the port itself is
 *  guarded rather than rotting untested.
 *
 *  74 soma + 138 dendrites (6 x [9 trunk + 2 forks x 7]) + 17 axon
 *  + 5 terminals = 234 points, 5 highlights. */
export function neuronPts(): ModelPoint[] {
  const pts: ModelPoint[] = [];
  const nline = (a: V3, b: V3, steps: number): void => {
    for (let s = 0; s <= steps; s++) {
      const f = s / steps;
      pts.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f, 0]);
    }
  };
  for (let i = 0; i < 74; i++) {
    const d = fibDir(i, 74);
    pts.push([d[0] * 0.22, d[1] * 0.22, d[2] * 0.22, 0]);
  }
  const dends: readonly V3[] = [
    [0.7, 0.8, 0.2],
    [-0.8, 0.6, -0.3],
    [-0.3, 0.9, 0.5],
    [0.2, -0.6, -0.7],
    [-0.6, -0.5, 0.5],
    [0.85, -0.1, -0.4],
  ];
  for (const dr of dends) {
    const d = normV(dr);
    const root: V3 = [d[0] * 0.2, d[1] * 0.2, d[2] * 0.2];
    const mid: V3 = [d[0] * 0.58, d[1] * 0.58, d[2] * 0.58];
    nline(root, mid, 8);
    // Two forks, mirrored through the trunk: a swizzle of d rather than a true
    // perpendicular. It is not orthonormal, and that is the point — a perfect
    // Y at every branch reads as a manufactured antenna, not as tissue.
    const jts: readonly V3[] = [
      [d[1], -d[0], d[2]],
      [-d[1], d[0], -d[2]],
    ];
    for (const jt of jts) {
      const j = normV([d[0] + jt[0] * 0.9, d[1] + jt[1] * 0.9, d[2] + jt[2] * 0.9]);
      nline(mid, [mid[0] + j[0] * 0.42, mid[1] + j[1] * 0.42, mid[2] + j[2] * 0.42], 6);
    }
  }
  const ax = normV([0.1, -1, 0.15]);
  const end: V3 = [ax[0], ax[1], ax[2]];
  nline([ax[0] * 0.2, ax[1] * 0.2, ax[2] * 0.2], end, 16);
  for (let j = 0; j < 5; j++) {
    const e = fibDir(j, 5);
    pts.push([end[0] + e[0] * 0.12, end[1] + e[1] * 0.12, end[2] + e[2] * 0.12, 1]);
  }
  return fitUnit(pts);
}

// ---- the roster lookup ------------------------------------------------------

/** Enemy TYPE (see core/sim/enemyspec.ts) -> its dedicated model generator.
 *
 *  Keys are exactly the `type` strings on ENEMIES; creatures.test.ts asserts
 *  that, so a typo here is a failing test rather than a unit that silently
 *  falls back. Generators are stored as thunks, not as arrays: a model is a few
 *  hundred points and the renderer should decide when to pay for one.
 *
 *  DELIBERATELY ABSENT — these four fall back to minePts():
 *    - rolling ("ROLLING MINE") and prime ("PRIME MINE") are literally mines.
 *      The spiked-ball model is the RIGHT art for them, not a stopgap; giving
 *      them something else would break the naming the help text relies on.
 *      They differ from each other by colour and by size (0.60 vs 0.65), which
 *      is the separation the epic tier needs, since both spawn sparse and are
 *      rarely on screen together.
 *    - drifter ("WAVE SATURN") wants a ringed body, and no ringed generator is
 *      in this port. It shares E_YELLOW with scoutufo, so it does need its own
 *      silhouette eventually — but scoutufo now has the saucer, which means the
 *      pair is already separated (saucer vs spiked ball) and the fallback is
 *      not currently hiding anything. Flagged, not urgent.
 *    - knot ("SOLVING TORUS") wants the donor's torusKnotPts, which is out of
 *      scope for this port. It is the boss and the only boss, so it is always
 *      alone on the announce card and never confusable with a sibling; a mine
 *      at 0.80 size reads as "the big one" adequately until the knot lands.
 *  Adding a model later means adding one line here — nothing else changes. */
export const CREATURE_MODELS: ReadonlyMap<string, () => ModelPoint[]> = new Map([
  ['phage', phagePts],
  ['ghost', batPts],
  ['scoutufo', ufoPts],
  ['amoeba', amoebaPts],
  ['jellyfish', jellyfishPts],
  ['gslime', slimePts],
  ['corona', coronaPts],
  ['barbed', spiderPts],
]);
