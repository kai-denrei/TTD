// helpers.ts — the shared primitives every Braille point-cloud generator uses.
//
// Ported from ~/Dev/Braille/fun-shapes/index.html (vanilla JS, ~150 generators).
// Port, don't copy: the maths is the asset, the typing is ours. Every point
// carries exactly four components here — the source library used a ragged
// 3-or-4 shape, which forces a length check at every consumer. Normalising to
// [x, y, z, hi] once, at the port boundary, means the renderer can write
// straight into a Float32Array without branching per point.
//
// Pure by construction: no Math.random anywhere in the source library
// (verified: grep -c "Math.random" returns 0), so these satisfy core/'s
// determinism guard without needing a seeded stream.

/** A model point in unit-sphere space. The 4th component is the highlight
 *  flag: 1 = render brighter. It is the library's only "look here" channel,
 *  and it is free semantic weight (a muzzle, a spike tip, an eye). */
export type ModelPoint = readonly [number, number, number, number];

/** Plain 3-vector, used inside generators before the highlight flag is added. */
export type V3 = readonly [number, number, number];

/** The i-th of n directions on a Fibonacci sphere — an even, deterministic
 *  spread with no clustering at the poles. */
export function fibDir(i: number, n: number): V3 {
  const g = Math.PI * (3 - Math.sqrt(5));
  const y = 1 - (2 * (i + 0.5)) / n;
  const r = Math.sqrt(Math.max(0, 1 - y * y));
  const a = i * g;
  return [r * Math.cos(a), y, r * Math.sin(a)];
}

/** Normalise; a zero-length vector yields a finite result rather than NaN. */
export function normV(v: V3): V3 {
  const l = Math.sqrt(v[0] * v[0] + v[1] * v[1] + v[2] * v[2]) || 1e-6;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export function crossV(a: V3, b: V3): V3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Scale the cloud so its farthest point sits exactly on the unit sphere,
 *  preserving the highlight flag. Every generator ends with this, so all
 *  models share one coordinate convention: unit radius, +Y up. */
export function fitUnit(pts: readonly ModelPoint[]): ModelPoint[] {
  let m = 0;
  for (const p of pts) {
    const r = Math.hypot(p[0], p[1], p[2]);
    if (r > m) m = r;
  }
  const k = m || 1;
  return pts.map((p): ModelPoint => [p[0] / k, p[1] / k, p[2] / k, p[3]]);
}
