// geometry.ts — the board's third dimension, as plain arrays.
//
// WHY THIS IS PURE. Skirt classification is exactly the kind of logic that
// fails silently: a skirt on the wrong edge, wound backwards so it is
// invisible from outside, or a faceCell entry off by one that makes clicking a
// wall select its neighbour. None of those look broken on screen. M0b already
// shipped one bug of that shape — a decorative edge overlay that swallowed
// every tower placement, invisible until the app was driven and the live world
// read back. So the extrusion imports nothing from three and is Node-tested;
// board.ts shrinks to uploading these arrays.
//
// THE SKIRT FILTER IS THE POINT. An edge between two BLOCKED cells is interior
// to a wall mass and its skirt would be geometry buried inside solid rock. On
// this board ~73% of cells are BLOCKED, so skirting every wall edge would emit
// several times the triangles for nothing visible.
//
// NON-INDEXED, like M0b: vertices are shared between adjacent quads, so a
// per-vertex colour bleeds one cell's dungeon tag into its neighbours.
//
// SURFACES ARE GROUPED, NOT INTERLEAVED: [floor][wallTop][skirt]. Consumers
// index by surface range, and the renderer can give each its own draw range.

import type { SphereMesh } from '../core/sphere/grid.ts';
import type { Dungeon } from '../core/sphere/dungeon.ts';
import { BLOCKED, PATH, isFrontierWall } from '../core/sphere/dungeon.ts';

/** Mean chord here is 0.068, so a wall stands ~0.66 of a cell wide.
 *  The PoC used 0.03; raised after looking at it, because at 0.03 the relief
 *  vanished from the orbit cameras and the board read as flat colour. Still low
 *  enough that the chase camera sees over the wall it sits beside. */
export const WALL_HEIGHT = 0.045;

// Relief has to come from authored colour: the board uses MeshBasicMaterial,
// so there is no light to shade it. The scheme fakes a single overhead source —
// wall TOPS catch it, SKIRTS are the shadowed vertical faces, and the floor
// sits between. Skirts are near-black on purpose: they are what draws the
// silhouette of every wall run, and a weak top/skirt contrast makes the board
// read as flat colour from orbit however tall the walls actually are.
//
// The floor is also the SATURATED half of the palette and the walls the neutral
// half. Walls are ~73% of the board, so if both are the same blue the corridors
// — the only part where anything walks or gets shot — disappear into the mass.
//
// EVERY TERRAIN COLOUR STAYS UNDER THE BLOOM THRESHOLD (default 0.5). Bloom is
// for emissive things: units, and later shots and impacts. Brightening the
// floor to make corridors pop pushes it over the threshold, at which point the
// terrain blooms, clips to white, and loses both its colour AND its relief —
// tried, and it looked worse than the dark version it was meant to fix. So the
// board is deliberately dim and reads by CONTRAST OF RELIEF rather than by
// brightness; the only things allowed to glow are the things that matter.
const C_PATH: readonly [number, number, number] = [0x2c / 255, 0x4c / 255, 0x7c / 255];
const C_ROOM: readonly [number, number, number] = [0x3a / 255, 0x63 / 255, 0x9c / 255];
const C_WALLTOP: readonly [number, number, number] = [0x23 / 255, 0x2b / 255, 0x3d / 255];
// Buildable high ground — a wall that borders open floor. Only ~26% of walls
// qualify (509 of 1964 on seed 7), and without a cue the other 74% are dead
// clicks: you tap the rock and nothing happens, with nothing to tell you why.
// A distinct top tone turns the placement rule into something you can read off
// the board instead of discovering by trial.
const C_WALLTOP_BUILD: readonly [number, number, number] = [0x3a / 255, 0x46 / 255, 0x63 / 255];
const C_SKIRT: readonly [number, number, number] = [0x07 / 255, 0x0b / 255, 0x14 / 255];

export type BoardGeometry = {
  positions: Float32Array;
  colors: Float32Array;
  faceCell: Int32Array;
  counts: { floor: number; wallTop: number; skirt: number };
};

type Vec = [number, number, number];

export function buildBoardGeometry(
  mesh: SphereMesh,
  dungeon: Dungeon,
  opts?: { wallHeight?: number },
): BoardGeometry {
  const h = opts?.wallHeight ?? WALL_HEIGHT;
  const positions: number[] = [];
  const colors: number[] = [];
  const faceCell: number[] = [];

  const isWall = (c: number): boolean => dungeon.tags[c] === BLOCKED;

  function emit(a: Vec, b: Vec, c: Vec, col: readonly [number, number, number], cell: number): void {
    positions.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let i = 0; i < 3; i++) colors.push(col[0], col[1], col[2]);
    faceCell.push(cell);
  }

  function at(vi: number, radius: number): Vec {
    const v = mesh.verts[vi]!;
    return [v[0] * radius, v[1] * radius, v[2] * radius];
  }

  /** Fan-triangulate one cell's polygon at `radius`. mesh.quads winding is
   *  already outward (M0b renders correctly with FrontSide), so these inherit
   *  correct facing. Generic over polygon size: the pipeline merges cells, and
   *  a stray 5-gon must not throw. */
  function face(cell: number, radius: number, col: readonly [number, number, number]): number {
    const quad = mesh.quads[cell];
    if (quad === undefined || quad.length < 3) return 0;
    let n = 0;
    for (let i = 1; i + 1 < quad.length; i++) {
      emit(at(quad[0]!, radius), at(quad[i]!, radius), at(quad[i + 1]!, radius), col, cell);
      n += 1;
    }
    return n;
  }

  // ── 1. floor ─────────────────────────────────────────────────────────────
  let floorTris = 0;
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    if (isWall(cell)) continue;
    floorTris += face(cell, 1, dungeon.tags[cell] === PATH ? C_PATH : C_ROOM);
  }

  // ── 2. wall tops ─────────────────────────────────────────────────────────
  let wallTris = 0;
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    if (!isWall(cell)) continue;
    const buildable = isFrontierWall(mesh, dungeon, cell);
    wallTris += face(cell, 1 + h, buildable ? C_WALLTOP_BUILD : C_WALLTOP);
  }

  // ── 3. skirts ────────────────────────────────────────────────────────────
  // The mesh is a clean quad manifold: every edge is shared by exactly two
  // quads (measured), so the cell across an edge is unambiguous.
  const owners = new Map<number, number[]>();
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined) continue;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % quad.length]!;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      const list = owners.get(key);
      if (list === undefined) owners.set(key, [cell]);
      else list.push(cell);
    }
  }

  let skirtTris = 0;
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined || !isWall(cell)) continue;
    const wc = mesh.centers[cell]!;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % quad.length]!;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      const pair = owners.get(key);
      if (pair === undefined || pair.length !== 2) continue;
      const other = pair[0] === cell ? pair[1]! : pair[0]!;
      if (isWall(other)) continue; // interior wall edge: buried in solid rock

      const aTop = at(a, 1 + h);
      const bTop = at(b, 1 + h);
      const aBot = at(a, 1);
      const bBot = at(b, 1);

      // Face the open cell. A backwards skirt is invisible from outside and
      // reads as a hole in the wall rather than as an error, so the winding is
      // computed rather than assumed.
      const oc = mesh.centers[other]!;
      const away: Vec = [oc[0] - wc[0], oc[1] - wc[1], oc[2] - wc[2]];
      if (dot(normal(aBot, bBot, bTop), away) < 0) {
        emit(bBot, aBot, aTop, C_SKIRT, cell);
        emit(bBot, aTop, bTop, C_SKIRT, cell);
      } else {
        emit(aBot, bBot, bTop, C_SKIRT, cell);
        emit(aBot, bTop, aTop, C_SKIRT, cell);
      }
      skirtTris += 2;
    }
  }

  return {
    positions: Float32Array.from(positions),
    colors: Float32Array.from(colors),
    faceCell: Int32Array.from(faceCell),
    counts: { floor: floorTris, wallTop: wallTris, skirt: skirtTris },
  };
}

function normal(a: Vec, b: Vec, c: Vec): Vec {
  const u: Vec = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: Vec = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}

function dot(a: Vec, b: Vec): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
