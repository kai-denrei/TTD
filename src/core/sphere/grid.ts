// grid.ts — Stålberg organic quad grid on the surface of a sphere.
//
// Port of ~/Dev/spherical-stalberg-grid/src/grid.js (377 lines) to TypeScript.
// Pipeline:
//   1. best-candidate blue-noise sample on S²
//   2. spherical Delaunay = 3D convex hull (pure TS, no three.js)
//   3. dissolve edges: merge legal triangle pairs into quads
//   4. subdivide every face into quads; new vertices projected to sphere
//   4b. normalize winding: quad Newell normal must point outward
//   5. relax toward squareness in each quad's tangent plane, reproject
//   6. compute adjacency, centers, normals → SphereMesh
//
// Hull approach: incremental 3D convex hull (Beneath-Beyond / gift-wrap
// variant). On a sphere every point is extreme, so the convex hull IS the
// Delaunay triangulation.  The three.js ConvexHull cannot be used here
// because core/ must be pure and headless.
//
// No Math.random anywhere — all randomness from stream(seed, 'grid').

import { stream } from '../sim/rng.ts';
import type { Rng } from '../sim/rng.ts';
import {
  add, sub, scale, dot, cross, len, normalize, mean, tangentBasis,
} from './vec3.ts';
import type { Vec3 } from './vec3.ts';

// ---- Public types -----------------------------------------------------------

export type { Vec3 };

export type SphereMesh = {
  verts: Vec3[];
  quads: number[][];
  centers: Vec3[];
  normals: Vec3[];
  adj: number[][];
};

// Internal mutable vertex type — cast to Vec3 only when crossing the public boundary.
type MutVec3 = [number, number, number];

// ---- Constants --------------------------------------------------------------

const QUAD_ANGLE_MIN = 0.2 * Math.PI; // 36°
const QUAD_ANGLE_MAX = 0.9 * Math.PI; // 162°

// ---- Edge key ---------------------------------------------------------------

function edgeKey(a: number, b: number): string {
  return a < b ? `${a}-${b}` : `${b}-${a}`;
}

// ---- Blue-noise sampler on S² (voxel-hash best-candidate) ------------------
// Port of sample.js.

function uniformSpherePoint(rng: Rng): Vec3 {
  const z = 2 * rng() - 1;
  const theta = 2 * Math.PI * rng();
  const r = Math.sqrt(Math.max(0, 1 - z * z));
  return [r * Math.cos(theta), r * Math.sin(theta), z];
}

function bestCandidateSphere(rng: Rng, n: number, k: number): Vec3[] {
  const cell = Math.sqrt((4 * Math.PI) / Math.max(n, 1));
  const inv = 1 / cell;
  const res = Math.ceil(2 * inv) + 2;
  const buckets = new Map<number, number[]>();

  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const pz = new Float64Array(n);
  let count = 0;

  const voxOf = (v: number): number =>
    Math.min(res - 1, Math.max(0, Math.floor((v + 1) * inv) + 1));
  const keyOf = (ix: number, iy: number, iz: number): number =>
    (ix * res + iy) * res + iz;

  const insert = (i: number): void => {
    const key = keyOf(voxOf(px[i] ?? 0), voxOf(py[i] ?? 0), voxOf(pz[i] ?? 0));
    let list = buckets.get(key);
    if (list === undefined) { list = []; buckets.set(key, list); }
    list.push(i);
  };

  const BRUTE_LIMIT = 96;

  const nearestSq = (x: number, y: number, z: number): number => {
    let best = Infinity;
    if (count <= BRUTE_LIMIT) {
      for (let i = 0; i < count; i++) {
        const dx = x - (px[i] ?? 0);
        const dy = y - (py[i] ?? 0);
        const dz = z - (pz[i] ?? 0);
        const d = dx * dx + dy * dy + dz * dz;
        if (d < best) best = d;
      }
      return best;
    }
    const cx = voxOf(x), cy = voxOf(y), cz = voxOf(z);
    for (let ring = 0; ring < res; ring++) {
      if (ring > 1 && best <= ((ring - 1) * cell) ** 2) break;
      const x0 = Math.max(0, cx - ring), x1 = Math.min(res - 1, cx + ring);
      const y0 = Math.max(0, cy - ring), y1 = Math.min(res - 1, cy + ring);
      const z0 = Math.max(0, cz - ring), z1 = Math.min(res - 1, cz + ring);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let iz = z0; iz <= z1; iz++) {
            if (ring > 0
              && ix !== cx - ring && ix !== cx + ring
              && iy !== cy - ring && iy !== cy + ring
              && iz !== cz - ring && iz !== cz + ring) continue;
            const list = buckets.get(keyOf(ix, iy, iz));
            if (list === undefined) continue;
            for (const idx of list) {
              const dx = x - (px[idx] ?? 0);
              const dy = y - (py[idx] ?? 0);
              const dz = z - (pz[idx] ?? 0);
              const d = dx * dx + dy * dy + dz * dz;
              if (d < best) best = d;
            }
          }
        }
      }
    }
    return best;
  };

  const p0 = uniformSpherePoint(rng);
  px[0] = p0[0]; py[0] = p0[1]; pz[0] = p0[2];
  count = 1;
  insert(0);

  while (count < n) {
    let bx = 0, by = 0, bz = 0, bestD = -1;
    for (let c = 0; c < k; c++) {
      const cand = uniformSpherePoint(rng);
      const d = nearestSq(cand[0], cand[1], cand[2]);
      if (d > bestD) { bestD = d; bx = cand[0]; by = cand[1]; bz = cand[2]; }
    }
    px[count] = bx; py[count] = by; pz[count] = bz;
    insert(count);
    count++;
  }

  const points: Vec3[] = new Array(n);
  for (let i = 0; i < n; i++) {
    points[i] = [px[i] ?? 0, py[i] ?? 0, pz[i] ?? 0];
  }
  return points;
}

// ---- 3D Convex Hull (incremental, pure TS) ---------------------------------
// For points on a sphere, the convex hull = spherical Delaunay triangulation.
//
// Algorithm: randomized incremental convex hull.
//  1. Bootstrap with the first 4 non-coplanar points forming a tetrahedron.
//  2. For each remaining point p:
//     - Find all faces visible from p (dot(normal, p - face_vertex) > 0).
//     - If none visible, p is inside → skip (shouldn't happen on sphere).
//     - Collect the horizon (boundary edges of visible faces).
//     - Remove visible faces, add new faces from horizon edges to p.
//
// Winding: all faces wound CCW as seen from outside (outward normals).

type HullFace = {
  verts: [number, number, number];  // CCW from outside
  normal: Vec3;                     // outward unit normal
};

function convexHull(pts: Vec3[]): Array<[number, number, number]> {
  const n = pts.length;
  if (n < 4) throw new Error('convexHull needs at least 4 points');

  // (faceNormal helper inlined into makeFace below)

  // Find first 4 non-coplanar points for initial tetrahedron.
  // Point 0 is always index 0; search for 3 more.
  let i1 = -1;
  for (let i = 1; i < n; i++) {
    if (len(cross(sub(pts[i]!, pts[0]!), [1, 0, 0])) > 1e-10 ||
        len(cross(sub(pts[i]!, pts[0]!), [0, 1, 0])) > 1e-10) {
      i1 = i; break;
    }
  }
  if (i1 < 0) throw new Error('all points collinear');

  let i2 = -1;
  const e01 = sub(pts[i1]!, pts[0]!);
  for (let i = 1; i < n; i++) {
    if (i === i1) continue;
    const c = cross(e01, sub(pts[i]!, pts[0]!));
    if (len(c) > 1e-10) { i2 = i; break; }
  }
  if (i2 < 0) throw new Error('all points coplanar (3-point degenerate)');

  let i3 = -1;
  const triNormal = cross(e01, sub(pts[i2]!, pts[0]!));
  for (let i = 1; i < n; i++) {
    if (i === i1 || i === i2) continue;
    const vol = dot(triNormal, sub(pts[i]!, pts[0]!));
    if (Math.abs(vol) > 1e-10) { i3 = i; break; }
  }
  if (i3 < 0) throw new Error('all points coplanar');

  // Interior reference: centroid of tetrahedron.
  const interior: Vec3 = scale(
    add(add(pts[0]!, pts[i1]!), add(pts[i2]!, pts[i3]!)),
    0.25,
  );

  // Make outward-facing tetrahedron faces.
  const makeFace = (a: number, b: number, c: number): HullFace => {
    const pA = pts[a]!;
    const pB = pts[b]!;
    const pC = pts[c]!;
    const ab = sub(pB, pA);
    const ac = sub(pC, pA);
    let nrm = normalize(cross(ab, ac));
    // If normal points toward interior, flip.
    if (dot(nrm, sub(interior, pA)) > 0) {
      nrm = normalize(cross(ac, ab));
      return { verts: [a, c, b], normal: nrm };
    }
    return { verts: [a, b, c], normal: nrm };
  };

  const faces: HullFace[] = [
    makeFace(0, i1, i2),
    makeFace(0, i1, i3),
    makeFace(0, i2, i3),
    makeFace(i1, i2, i3),
  ];

  // For each remaining point, extend the hull.
  const processed = new Set([0, i1, i2, i3]);

  for (let pi = 0; pi < n; pi++) {
    if (processed.has(pi)) continue;
    processed.add(pi);

    const p = pts[pi]!;

    // Find visible faces.
    const visible: boolean[] = faces.map(f =>
      dot(f.normal, sub(p, pts[f.verts[0]]!)) > 1e-12,
    );

    if (!visible.some(Boolean)) continue; // inside hull

    // Find horizon edges: edges shared between a visible and invisible face.
    // Edge (a,b) in visible face appears as (b,a) in adjacent invisible face if manifold.
    // Build a map from canonical edge key → edge as it appears in visible face.
    const horizonEdges = new Map<string, [number, number]>();
    for (let fi = 0; fi < faces.length; fi++) {
      if (!visible[fi]) continue;
      const f = faces[fi]!;
      const [va, vb, vc] = f.verts;
      const faceEdges: Array<[number, number]> = [[va, vb], [vb, vc], [vc, va]];
      for (const [ea, eb] of faceEdges) {
        const key = edgeKey(ea, eb);
        if (horizonEdges.has(key)) {
          horizonEdges.delete(key); // shared with another visible face → interior
        } else {
          horizonEdges.set(key, [ea, eb]);
        }
      }
    }

    // Remove visible faces.
    let writeIdx = 0;
    for (let fi = 0; fi < faces.length; fi++) {
      if (!visible[fi]) {
        faces[writeIdx++] = faces[fi]!;
      }
    }
    faces.length = writeIdx;

    // Add new faces from each horizon edge to pi.
    for (const [ea, eb] of horizonEdges.values()) {
      // The horizon edge (ea, eb) is wound in the visible face's CCW order.
      // The new face (ea, eb, pi) should be wound so its normal points outward.
      // From outside: the visible face's edge was CCW, so reversing gives us
      // the correct winding for the new face: (eb, ea, pi).
      const newFace = makeFace(eb, ea, pi);
      faces.push(newFace);
    }
  }

  return faces.map(f => f.verts);
}

// Spherical Delaunay via convex hull.
// Returns triangles wound CCW as seen from outside (matches three.js hull).
function sphericalDelaunay(points: Vec3[]): Array<[number, number, number]> {
  return convexHull(points);
}

// ---- Tangent-plane projection -----------------------------------------------

type TangentProjection = {
  c: Vec3;
  u: Vec3;
  v: Vec3;
  pts2: Array<[number, number]>;
};

function projectToTangent(corners: Vec3[]): TangentProjection {
  const c = mean(corners);
  const n = normalize(c);
  const [u, v] = tangentBasis(n);
  const pts2: Array<[number, number]> = corners.map(p => {
    const d = sub(p, c);
    return [dot(d, u), dot(d, v)];
  });
  return { c, u, v, pts2 };
}

// ---- Stage 3: merge triangle pairs into quads --------------------------------

function legitQuad(points: Vec3[], quad: number[]): boolean {
  const corners = quad.map(vi => points[vi]!);
  const { pts2 } = projectToTangent(corners);
  const signs = new Set<number>();
  let minAng = Infinity;
  let maxAng = -Infinity;
  for (let i = 0; i < 4; i++) {
    const prev = pts2[(i - 1 + 4) % 4]!;
    const cur = pts2[i]!;
    const next = pts2[(i + 1) % 4]!;
    const d1: [number, number] = [cur[0] - prev[0], cur[1] - prev[1]];
    const d2: [number, number] = [next[0] - cur[0], next[1] - cur[1]];
    signs.add(Math.sign(d1[0] * d2[1] - d1[1] * d2[0]));
    const l1 = Math.hypot(d1[0], d1[1]);
    const l2 = Math.hypot(d2[0], d2[1]);
    if (l1 < 1e-12 || l2 < 1e-12) return false;
    let cos = (d1[0] * d2[0] + d1[1] * d2[1]) / (l1 * l2);
    cos = Math.max(-1, Math.min(1, cos));
    const ang = Math.acos(cos);
    if (ang < minAng) minAng = ang;
    if (ang > maxAng) maxAng = ang;
  }
  return signs.size === 1 && maxAng <= QUAD_ANGLE_MAX && minAng >= QUAD_ANGLE_MIN;
}

function mergeToQuads(
  points: Vec3[],
  triangles: Array<[number, number, number]>,
  rng: Rng,
  quadBias = 1,
): { triangles: number[][]; prequads: number[][] } {
  const alive = new Uint8Array(triangles.length).fill(1);

  const edgeTris = new Map<string, number[]>();
  for (let ti = 0; ti < triangles.length; ti++) {
    const t = triangles[ti]!;
    for (let i = 0; i < 3; i++) {
      const key = edgeKey(t[i]!, t[(i + 1) % 3]!);
      let list = edgeTris.get(key);
      if (list === undefined) { list = []; edgeTris.set(key, list); }
      list.push(ti);
    }
  }

  const pool: string[] = [];
  const poolPos = new Map<string, number>();
  const poolAdd = (key: string): void => {
    if (!poolPos.has(key)) { poolPos.set(key, pool.length); pool.push(key); }
  };
  const poolRemove = (key: string): void => {
    const pos = poolPos.get(key);
    if (pos === undefined) return;
    const last = pool.pop()!;
    poolPos.delete(key);
    if (pos < pool.length) { pool[pos] = last; poolPos.set(last, pos); }
  };
  for (const [key, list] of edgeTris) {
    if (list.length === 2) poolAdd(key);
  }

  const prequads: number[][] = [];
  while (pool.length > 0) {
    const key = pool[Math.floor(rng() * pool.length)]!;
    const [eaStr, ebStr] = key.split('-');
    const ea = Number(eaStr), eb = Number(ebStr);
    const [ta, tb] = edgeTris.get(key)!;

    const opp: number[] = [];
    for (const ti of [ta!, tb!]) {
      for (const v of triangles[ti]!) {
        if (v !== ea && v !== eb) opp.push(v);
      }
    }
    const candQuad = [ea, opp[0]!, eb, opp[1]!];

    if (legitQuad(points, candQuad) && rng() < quadBias) {
      prequads.push(candQuad);
      alive[ta!] = 0;
      alive[tb!] = 0;
      for (const ti of [ta!, tb!]) {
        const t = triangles[ti]!;
        for (let i = 0; i < 3; i++) poolRemove(edgeKey(t[i]!, t[(i + 1) % 3]!));
      }
    } else {
      poolRemove(key);
    }
  }

  const leftover: number[][] = [];
  for (let ti = 0; ti < triangles.length; ti++) {
    if (alive[ti]) leftover.push(Array.from(triangles[ti]!));
  }
  return { triangles: leftover, prequads };
}

// ---- Stage 4: subdivide every face into quads --------------------------------

function subdivide(
  points: Vec3[],
  faces: number[][],
): { vertices: MutVec3[]; quads: number[][] } {
  const vertices: MutVec3[] = points.map(p => [p[0], p[1], p[2]]);
  const midCache = new Map<string, number>();

  const onSphere = (p: Vec3): MutVec3 => {
    const l = len(p) || 1;
    return [p[0] / l, p[1] / l, p[2] / l];
  };

  const midpointIndex = (a: number, b: number): number => {
    const key = edgeKey(a, b);
    let mi = midCache.get(key);
    if (mi === undefined) {
      const m = onSphere(mean([vertices[a]!, vertices[b]!]));
      mi = vertices.length;
      vertices.push(m);
      midCache.set(key, mi);
    }
    return mi;
  };

  const quads: number[][] = [];
  for (const face of faces) {
    const n = face.length; // 3 or 4
    const centroid = onSphere(mean(face.map(vi => vertices[vi]!)));
    const ci = vertices.length;
    vertices.push(centroid);

    const edges: Array<[number, number]> = [];
    for (let i = 0; i < n; i++) {
      edges.push([face[i]!, face[(i + 1) % n]!]);
    }

    for (let j = 0; j < n; j++) {
      const e1 = edges[j]!;
      const e2 = edges[(j + 1) % n]!;
      const m1 = midpointIndex(e1[0], e1[1]);
      const m2 = midpointIndex(e2[0], e2[1]);
      let corner = e1[0];
      if (!e2.includes(corner)) corner = e1[1];
      quads.push([corner, m1, ci, m2]);
    }
  }

  return { vertices, quads };
}

// ---- Stage 4b: normalize winding ---------------------------------------------

function normalizeWinding(vertices: MutVec3[], quads: number[][]): void {
  for (const q of quads) {
    let nx = 0, ny = 0, nz = 0;
    for (let i = 0; i < 4; i++) {
      const a = vertices[q[i]!]!;
      const b = vertices[q[(i + 1) % 4]!]!;
      nx += (a[1] - b[1]) * (a[2] + b[2]);
      ny += (a[2] - b[2]) * (a[0] + b[0]);
      nz += (a[0] - b[0]) * (a[1] + b[1]);
    }
    const c = mean(q.map(vi => vertices[vi]!));
    if (dot([nx, ny, nz], c) < 0) q.reverse();
  }
}

// ---- Stage 5: relaxation -----------------------------------------------------
// Port of relaxStep from grid.js.
// Clockwise sign convention in the (u,v) frame is decided by checking
// the projected signed area — load-bearing, must match the PoC exactly.

function relaxStep(
  vertices: MutVec3[],
  quads: number[][],
  defaultSide: number,
  PULL_RATE = 0.3,
): void {
  const side = defaultSide;
  const r = side / Math.SQRT2;

  const forces: MutVec3[] = vertices.map(() => [0, 0, 0]);

  for (const quad of quads) {
    const corners3 = quad.map(vi => vertices[vi]!);
    const { u, v, pts2 } = projectToTangent(corners3);

    // signed area of the projected quad in the (u,v) frame
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts2[i]!;
      const b = pts2[(i + 1) % 4]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    // order for the formula: clockwise in the (u,v) frame
    const order = area > 0 ? [quad[0]!, quad[3]!, quad[2]!, quad[1]!] : quad.slice();
    const q2 = area > 0
      ? [pts2[0]!, pts2[3]!, pts2[2]!, pts2[1]!]
      : pts2.slice();

    let denom = q2[0]![0] - q2[1]![1] - q2[2]![0] + q2[3]![1];
    const num = q2[0]![1] + q2[1]![0] - q2[2]![1] - q2[3]![0];
    const s = Math.sign(denom) || 1;
    denom = s * Math.max(1e-10, Math.abs(denom));

    let alpha = Math.atan(num / denom);
    if (Math.cos(alpha) * denom + Math.sin(alpha) * num < 0) alpha += Math.PI;

    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const target: Array<[number, number]> = [
      [r * ca, r * sa],
      [r * sa, -r * ca],
      [-r * ca, -r * sa],
      [-r * sa, r * ca],
    ];

    for (let i = 0; i < 4; i++) {
      const tgt = target[i]!;
      const cur = q2[i]!;
      const fx = tgt[0] - cur[0];
      const fy = tgt[1] - cur[1];
      // back to 3D: force lives in the tangent plane
      const f3 = add(scale(u, fx), scale(v, fy));
      const vi = order[i]!;
      const fv = forces[vi]!;
      fv[0] += f3[0];
      fv[1] += f3[1];
      fv[2] += f3[2];
    }
  }

  for (let i = 0; i < vertices.length; i++) {
    const p = vertices[i]!;
    const f = forces[i]!;
    // MutVec3 is a mutable tuple — direct assignment is safe.
    p[0] = p[0] + f[0] * PULL_RATE;
    p[1] = p[1] + f[1] * PULL_RATE;
    p[2] = p[2] + f[2] * PULL_RATE;
    // constraint: back onto the unit sphere
    const l = len(p) || 1;
    p[0] = p[0] / l;
    p[1] = p[1] / l;
    p[2] = p[2] / l;
  }
}

// ---- Public API -------------------------------------------------------------

export function generateSphereMesh(opts: {
  seed: number;
  points: number;
  relaxIters?: number;
}): SphereMesh {
  const { seed, points: n, relaxIters = 0 } = opts;
  const k = 12;
  const rng = stream(seed, 'grid');

  // Stage 1: blue-noise sample
  const rawPoints = bestCandidateSphere(rng, n, k);

  // Stage 2: spherical Delaunay via convex hull
  const triangles = sphericalDelaunay(rawPoints);

  // Stage 3: merge to quads
  const { triangles: leftover, prequads } = mergeToQuads(rawPoints, triangles, rng, 1);
  const faces = [...leftover, ...prequads];

  // Stage 4: subdivide
  const { vertices, quads } = subdivide(rawPoints, faces);

  // Stage 4b: normalize winding
  normalizeWinding(vertices, quads);

  // Stage 5: relax
  const defaultSide = Math.sqrt((4 * Math.PI) / quads.length);
  const iters = relaxIters;
  for (let i = 0; i < iters; i++) {
    relaxStep(vertices, quads, defaultSide, 0.3);
  }

  // Build SphereMesh: centers, normals, adjacency
  const centers: Vec3[] = quads.map(q =>
    normalize(mean(q.map(vi => vertices[vi]!))),
  );
  const normals: Vec3[] = centers; // on a unit sphere, centre == outward normal

  // Adjacency: quads sharing an edge are adjacent
  const edgeToQuad = new Map<string, number[]>();
  for (let qi = 0; qi < quads.length; qi++) {
    const q = quads[qi]!;
    for (let i = 0; i < 4; i++) {
      const key = edgeKey(q[i]!, q[(i + 1) % 4]!);
      let list = edgeToQuad.get(key);
      if (list === undefined) { list = []; edgeToQuad.set(key, list); }
      list.push(qi);
    }
  }

  const adj: number[][] = quads.map(() => []);
  for (const list of edgeToQuad.values()) {
    if (list.length === 2) {
      const [qa, qb] = list as [number, number];
      adj[qa]!.push(qb);
      adj[qb]!.push(qa);
    }
  }

  return { verts: vertices, quads, centers, normals, adj };
}

// ---- Diagnostics -------------------------------------------------------------

export function squarenessError(mesh: SphereMesh): number {
  const { verts, quads } = mesh;
  const defaultSide = Math.sqrt((4 * Math.PI) / quads.length);
  const side = defaultSide;
  const r = side / Math.SQRT2;
  let total = 0;

  for (const quad of quads) {
    const corners = quad.map(vi => verts[vi]!);
    const { pts2 } = projectToTangent(corners);
    let area = 0;
    for (let i = 0; i < 4; i++) {
      const a = pts2[i]!;
      const b = pts2[(i + 1) % 4]!;
      area += a[0] * b[1] - b[0] * a[1];
    }
    const q2 = area > 0
      ? [pts2[0]!, pts2[3]!, pts2[2]!, pts2[1]!]
      : pts2.slice();

    let denom = q2[0]![0] - q2[1]![1] - q2[2]![0] + q2[3]![1];
    const num = q2[0]![1] + q2[1]![0] - q2[2]![1] - q2[3]![0];
    const s = Math.sign(denom) || 1;
    denom = s * Math.max(1e-10, Math.abs(denom));
    let alpha = Math.atan(num / denom);
    if (Math.cos(alpha) * denom + Math.sin(alpha) * num < 0) alpha += Math.PI;
    const ca = Math.cos(alpha);
    const sa = Math.sin(alpha);
    const target: Array<[number, number]> = [
      [r * ca, r * sa],
      [r * sa, -r * ca],
      [-r * ca, -r * sa],
      [-r * sa, r * ca],
    ];
    let sum = 0;
    for (let i = 0; i < 4; i++) {
      const tgt = target[i]!;
      const cur = q2[i]!;
      sum += (tgt[0] - cur[0]) ** 2 + (tgt[1] - cur[1]) ** 2;
    }
    total += Math.sqrt(sum / 4) / side;
  }
  return total / quads.length;
}

export function valences(mesh: SphereMesh): Map<number, number> {
  const val = new Map<number, number>();
  for (const q of mesh.quads) {
    for (const vi of q) {
      val.set(vi, (val.get(vi) ?? 0) + 1);
    }
  }
  // Convert from vertex→count to valence→count histogram
  const hist = new Map<number, number>();
  for (const v of val.values()) {
    hist.set(v, (hist.get(v) ?? 0) + 1);
  }
  return hist;
}
