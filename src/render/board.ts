// board.ts — the sphere board: one non-indexed mesh plus an edge overlay.
//
// NON-INDEXED ON PURPOSE. Vertices are shared between adjacent quads, so a
// per-vertex colour bleeds one cell's dungeon tag into its neighbours and the
// board turns to mush. Duplicating vertices per face gives every cell a flat,
// exact colour. ~2,700 quads -> ~16,200 verts, which is nothing.
//
// THE EDGE OVERLAY IS NOT DECORATION. Tower placement is per-cell, so a player
// who cannot see where one cell ends cannot aim. Edges are deduplicated by
// sorted vertex-index key so shared borders are drawn once.

import * as THREE from 'three';
import type { SphereMesh } from '../core/sphere/grid.ts';
import type { Dungeon } from '../core/sphere/dungeon.ts';
import { BLOCKED, PATH } from '../core/sphere/dungeon.ts';

const COLOR_BLOCKED = new THREE.Color(0x141b2c);
const COLOR_PATH = new THREE.Color(0x2b4a7a);
const COLOR_ROOM = new THREE.Color(0x3f6ea8);
const COLOR_EDGE = new THREE.Color(0x0a0f1a);

/** faceIndex -> cell index, filled while triangles are emitted. Raycast tower
 *  placement resolves a hit face to the cell it belongs to. This is the only
 *  place that mapping is available for free. */
let faceToCell: Int32Array = new Int32Array(0);

export function cellFromFaceIndex(faceIndex: number): number {
  return faceToCell[faceIndex] ?? -1;
}

export function makeBoard(mesh: SphereMesh, dungeon: Dungeon): THREE.Group {
  const positions: number[] = [];
  const colors: number[] = [];
  const faces: number[] = [];

  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined || quad.length < 3) continue;

    const tag = dungeon.tags[cell];
    const c = tag === BLOCKED ? COLOR_BLOCKED : tag === PATH ? COLOR_PATH : COLOR_ROOM;

    // Fan-triangulate: generic over polygon size, because the mesh pipeline
    // merges cells and a stray 5-gon must not throw.
    for (let i = 1; i + 1 < quad.length; i++) {
      const a = mesh.verts[quad[0]!];
      const b = mesh.verts[quad[i]!];
      const d = mesh.verts[quad[i + 1]!];
      if (a === undefined || b === undefined || d === undefined) continue;
      for (const v of [a, b, d]) {
        positions.push(v[0], v[1], v[2]);
        colors.push(c.r, c.g, c.b);
      }
      faces.push(cell);
    }
  }

  faceToCell = Int32Array.from(faces);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();

  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
  );
  surface.name = 'board-surface';

  const group = new THREE.Group();
  group.name = 'board';
  group.add(surface);
  group.add(makeEdges(mesh));
  return group;
}

function makeEdges(mesh: SphereMesh): THREE.LineSegments {
  const seen = new Set<number>();
  const pts: number[] = [];
  for (const quad of mesh.quads) {
    if (quad === undefined) continue;
    for (let i = 0; i < quad.length; i++) {
      const a = quad[i]!;
      const b = quad[(i + 1) % quad.length]!;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a;
      if (seen.has(key)) continue;
      seen.add(key);
      const va = mesh.verts[a];
      const vb = mesh.verts[b];
      if (va === undefined || vb === undefined) continue;
      pts.push(va[0], va[1], va[2], vb[0], vb[1], vb[2]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  const lines = new THREE.LineSegments(geo, new THREE.LineBasicMaterial({ color: COLOR_EDGE }));
  lines.name = 'board-edges';
  return lines;
}
