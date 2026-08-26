// vec3.ts — pure TS 3D vector helpers over readonly [number, number, number].
// No three.js, no DOM, no Math.random.

export type Vec3 = readonly [number, number, number];

/** Component-wise addition. */
export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

/** Component-wise subtraction. */
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

/** Scalar multiplication. */
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

/** Dot product. */
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Cross product. */
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Euclidean length. */
export function len(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** Euclidean distance between two points. */
export function dist(a: Vec3, b: Vec3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Normalize to unit length.
 * Returns [1, 0, 0] for the zero vector to avoid NaN propagation.
 */
export function normalize(a: Vec3): Vec3 {
  const l = len(a);
  if (l === 0) return [1, 0, 0];
  return [a[0] / l, a[1] / l, a[2] / l];
}

/** Linear interpolation: a + t*(b−a). */
export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [
    a[0] + t * (b[0] - a[0]),
    a[1] + t * (b[1] - a[1]),
    a[2] + t * (b[2] - a[2]),
  ];
}

/** Mean / centroid of an array of points. */
export function mean(ps: readonly Vec3[]): Vec3 {
  let x = 0, y = 0, z = 0;
  for (const p of ps) { x += p[0]; y += p[1]; z += p[2]; }
  const n = ps.length || 1;
  return [x / n, y / n, z / n];
}

/**
 * Orthonormal tangent basis at a unit-length normal n.
 * Returns [u, v] where u ⊥ v ⊥ n, all unit length.
 */
export function tangentBasis(n: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(cross(n, ref));
  const v = cross(n, u); // already unit: n ⊥ u, both unit
  return [u, v];
}
