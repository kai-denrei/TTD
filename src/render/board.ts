// board.ts — uploads the board's geometry and owns picking.
//
// The extrusion itself is pure and Node-tested in render/geometry.ts; this file
// is the thin three.js half. The edge overlay stays opted out of raycasting —
// it sits fractionally in front of the surface, so a recursive raycast hits it
// first and returns an intersection with no faceIndex, silently swallowing
// every tower placement. That was the M0b bug, and it is the reason the rule
// lives here beside cellFromFaceIndex rather than as a filter each caller has
// to remember.

import * as THREE from 'three';
import type { SphereMesh } from '../core/sphere/grid.ts';
import type { Dungeon } from '../core/sphere/dungeon.ts';
import { BLOCKED } from '../core/sphere/dungeon.ts';
import { buildBoardGeometry, WALL_HEIGHT } from './geometry.ts';

export { WALL_HEIGHT };

const COLOR_EDGE = new THREE.Color(0x0a0f1a);

let faceToCell: Int32Array = new Int32Array(0);

/** Resolve a raycast hit to the cell it belongs to. Covers floor, wall tops
 *  and skirts, so clicking the visible side of a wall selects that wall. */
export function cellFromFaceIndex(faceIndex: number): number {
  return faceToCell[faceIndex] ?? -1;
}

export function makeBoard(mesh: SphereMesh, dungeon: Dungeon): THREE.Group {
  const built = buildBoardGeometry(mesh, dungeon);
  faceToCell = built.faceCell;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(built.positions, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(built.colors, 3));
  geo.computeVertexNormals();

  const surface = new THREE.Mesh(
    geo,
    new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.FrontSide }),
  );
  surface.name = 'board-surface';

  const group = new THREE.Group();
  group.name = 'board';
  group.add(surface);
  group.add(makeEdges(mesh, dungeon));
  return group;
}

/** Cell outlines on the walkable floor only. Outlining wall tops as well turns
 *  a board that is ~73% wall into a wireframe and buries the corridors — which
 *  are the part you actually need to read, since that is where enemies walk
 *  and where a tower's field of fire matters. */
function makeEdges(mesh: SphereMesh, dungeon: Dungeon): THREE.LineSegments {
  const seen = new Set<number>();
  const pts: number[] = [];
  for (let cell = 0; cell < mesh.quads.length; cell++) {
    const quad = mesh.quads[cell];
    if (quad === undefined) continue;
    if (dungeon.tags[cell] === BLOCKED) continue;
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
  lines.raycast = () => {};
  return lines;
}
