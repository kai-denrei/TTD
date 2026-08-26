// cellindex.ts — voxel-hash nearest-cell lookup over sphere cell centers.
//
// Port of ~/Dev/spherical-stalberg-grid/src/cellindex.js to TypeScript.
// This is the collision oracle: free (off-graph) motion asks "which cell am
// I over?" and needs a fast, correct answer at arbitrary positions.
//
// The voxel trick: surface points live in [-1,1]³. We hash each center into
// a voxel bucket, then for a query point scan expanding rings of voxels until
// we find the nearest centre. One extra ring after the first hit guarantees
// correctness at borders.
//
// cellSize choice: centers on a unit sphere with N cells have typical
// centre-to-centre spacing of ~sqrt(4π/N). For N=600 that's ~0.145.
// cellSize=0.05 gives ~3 voxels per spacing — fine enough that each center
// maps to its own bucket, coarse enough that the ring search terminates in
// 1–2 iterations.

import type { Vec3 } from './vec3.ts';

export function makeCellIndex(
  centers: readonly Vec3[],
  cellSize: number,
): (p: Vec3) => number {
  const inv = 1 / cellSize;
  const res = Math.ceil(2 * inv) + 2;

  const vox = (v: number): number =>
    Math.min(res - 1, Math.max(0, Math.floor((v + 1) * inv) + 1));

  const key = (x: number, y: number, z: number): number =>
    (x * res + y) * res + z;

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < centers.length; i++) {
    const c = centers[i]!;
    const k = key(vox(c[0]), vox(c[1]), vox(c[2]));
    let list = buckets.get(k);
    if (list === undefined) { list = []; buckets.set(k, list); }
    list.push(i);
  }

  // Returns the index of the nearest cell center to `p`.
  // Scans expanding voxel shells; one extra ring after the first hit
  // guarantees correctness at voxel borders.
  return (p: Vec3): number => {
    const cx = vox(p[0]), cy = vox(p[1]), cz = vox(p[2]);
    let best = -1, bd = Infinity;
    let foundAt = -1;
    for (let ring = 0; ring < res; ring++) {
      if (foundAt !== -1 && ring > foundAt + 1) break;
      const x0 = Math.max(0, cx - ring), x1 = Math.min(res - 1, cx + ring);
      const y0 = Math.max(0, cy - ring), y1 = Math.min(res - 1, cy + ring);
      const z0 = Math.max(0, cz - ring), z1 = Math.min(res - 1, cz + ring);
      for (let ix = x0; ix <= x1; ix++) {
        for (let iy = y0; iy <= y1; iy++) {
          for (let iz = z0; iz <= z1; iz++) {
            // Skip interior voxels (only scan the shell)
            if (ring > 0
              && ix !== cx - ring && ix !== cx + ring
              && iy !== cy - ring && iy !== cy + ring
              && iz !== cz - ring && iz !== cz + ring) continue;
            const list = buckets.get(key(ix, iy, iz));
            if (list === undefined) continue;
            for (const i of list) {
              const c = centers[i]!;
              const dx = c[0] - p[0], dy = c[1] - p[1], dz = c[2] - p[2];
              const d2 = dx * dx + dy * dy + dz * dz;
              if (d2 < bd) { bd = d2; best = i; }
            }
            if (best !== -1 && foundAt === -1) foundAt = ring;
          }
        }
      }
    }
    return best;
  };
}
