// dungeon.ts — rooms-and-hallways carved over the sphere grid's cell graph.
//
// Port of ~/Dev/spherical-stalberg-grid/src/dungeon.js to TypeScript.
// The method: all cells blocked by default; farthest-point room seeds;
// BFS corridors; rooms blown up as hop-radius blobs; double-BFS diameter
// for spawn & heart. No Math.random — uses stream(seed, 'dungeon') so
// grid changes don't reshuffle the dungeon.

import { stream } from '../sim/rng.ts';
import type { SphereMesh } from './grid.ts';
import type { Vec3 } from './vec3.ts';

// ---- Public constants & types -----------------------------------------------

export const BLOCKED = 0 as const;
export const PATH    = 1 as const;
export const ROOM    = 2 as const;

export type CellTag = typeof BLOCKED | typeof PATH | typeof ROOM;

export type Dungeon = {
  tags: CellTag[];
  heart: number;
  spawn: number;
  distToHeart: number[];
};

// ---- BFS primitives ---------------------------------------------------------

/** Multi-source BFS hop distances. Unreachable cells get -1. */
export function bfsDist(
  adj: number[][],
  sources: number[],
  passable?: (i: number) => boolean,
): number[] {
  const dist = new Int32Array(adj.length).fill(-1);
  const queue: number[] = [];
  for (const s of sources) { dist[s] = 0; queue.push(s); }
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    const neighbors = adj[cur] ?? [];
    for (const nb of neighbors) {
      if (dist[nb] !== -1) continue;
      if (passable !== undefined && !passable(nb)) continue;
      dist[nb] = (dist[cur] ?? 0) + 1;
      queue.push(nb);
    }
  }
  return Array.from(dist);
}

/** Shortest path from `start` to a cell satisfying `goal`, avoiding cells in
 *  `avoid` (endpoints are exempt). Returns null if unreachable. */
function bfsPath(
  adj: number[][],
  start: number,
  goal: (c: number) => boolean,
  avoid: Set<number> | null = null,
): number[] | null {
  const parent = new Int32Array(adj.length).fill(-2);
  parent[start] = -1;
  const queue: number[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head]!;
    if (goal(cur)) {
      const path: number[] = [];
      for (let c = cur; c !== -1; c = parent[c] ?? -1) path.push(c);
      return path.reverse();
    }
    const neighbors = adj[cur] ?? [];
    for (const nb of neighbors) {
      if ((parent[nb] ?? -2) !== -2) continue;
      if (avoid !== null && avoid.has(nb) && !goal(nb)) continue;
      parent[nb] = cur;
      queue.push(nb);
    }
  }
  return null;
}

/** Double-BFS diameter: find the two most-distant passable cells. */
function diameterEndpoints(adj: number[][], passable: (i: number) => boolean): [number, number] {
  let first = -1;
  for (let i = 0; i < adj.length; i++) { if (passable(i)) { first = i; break; } }
  if (first === -1) return [-1, -1];

  const argmax = (dist: number[]): number => {
    let best = -1, bd = -1;
    for (let i = 0; i < dist.length; i++) {
      if (passable(i) && (dist[i] ?? -1) > bd) { bd = dist[i] ?? -1; best = i; }
    }
    return best;
  };

  const a = argmax(bfsDist(adj, [first], passable));
  const b = argmax(bfsDist(adj, [a], passable));
  return [a, b];
}

// ---- Public API -------------------------------------------------------------

export function generateDungeon(
  mesh: SphereMesh,
  opts: {
    seed: number;
    rooms: number;
    roomRadius: number;
    extraCorridors: number;
    corridorWidth: number;
    // NOTE: no `obstacles`. The PoC exposed an obstacles slider that
    // dungeon.js never read — it only *appeared* to work because changing it
    // triggered a world rebuild, which changed the map anyway. A parameter
    // that does nothing is worse than a missing one, especially here: this
    // project's whole premise is that every lever is live. If wall-clump
    // density is wanted, it gets added the day it is implemented.
  },
): Dungeon {
  const { seed, rooms, roomRadius, extraCorridors, corridorWidth } = opts;
  const { adj } = mesh;
  const C = adj.length;
  const rng = stream(seed, 'dungeon');

  // 1. room seeds: farthest-point sampling over the full cell graph
  const seeds: number[] = [Math.floor(rng() * C)];
  while (seeds.length < rooms) {
    const dist = bfsDist(adj, seeds);
    let best = 0, bd = -1;
    for (let i = 0; i < C; i++) { if ((dist[i] ?? -1) > bd) { bd = dist[i] ?? -1; best = i; } }
    seeds.push(best);
  }

  const tagsRaw = new Uint8Array(C).fill(BLOCKED);

  // 2. spanning corridors: each new seed digs to the nearest carved cell
  const carved = new Set<number>([seeds[0]!]);
  tagsRaw[seeds[0]!] = PATH;
  for (let i = 1; i < seeds.length; i++) {
    const s = seeds[i]!;
    const path = bfsPath(adj, s, (c) => carved.has(c));
    if (path === null) continue; // cannot happen on a connected closed mesh
    for (const c of path) { tagsRaw[c] = PATH; carved.add(c); }
  }

  // 3. rooms: blob of cells within roomRadius hops of each seed
  for (const s of seeds) {
    const d = bfsDist(adj, [s]);
    for (let i = 0; i < C; i++) {
      if ((d[i] ?? -1) !== -1 && (d[i] ?? -1) <= roomRadius) {
        tagsRaw[i] = ROOM;
        carved.add(i);
      }
    }
  }

  // 4. extra corridors between random room pairs, avoiding existing paths
  for (let t = 0; t < extraCorridors; t++) {
    const a = seeds[Math.floor(rng() * seeds.length)]!;
    let b = seeds[Math.floor(rng() * seeds.length)]!;
    if (a === b) b = seeds[(seeds.indexOf(a) + 1) % seeds.length]!;
    const avoid = new Set<number>();
    for (let i = 0; i < C; i++) { if (tagsRaw[i] === PATH) avoid.add(i); }
    const path = bfsPath(adj, a, (c) => c === b, avoid);
    if (path === null) continue;
    for (const c of path) {
      if (tagsRaw[c] === BLOCKED) { tagsRaw[c] = PATH; carved.add(c); }
    }
  }

  // 4b. widen the whole open set by corridorWidth−1 hops
  if (corridorWidth > 1) {
    const openNow: number[] = [];
    for (let i = 0; i < C; i++) { if (tagsRaw[i] !== BLOCKED) openNow.push(i); }
    const d = bfsDist(adj, openNow);
    for (let i = 0; i < C; i++) {
      const di = d[i] ?? -1;
      if (tagsRaw[i] === BLOCKED && di !== -1 && di <= corridorWidth - 1) {
        tagsRaw[i] = PATH;
        carved.add(i);
      }
    }
  }

  // 5. spawn & heart: double-BFS diameter of the open subgraph
  const open = (i: number): boolean => tagsRaw[i] !== BLOCKED;
  const [spawn, heart] = diameterEndpoints(adj, open);
  const distToHeartRaw = bfsDist(adj, [heart], open);

  // Convert Uint8Array to typed CellTag[] for the public interface.
  const tags: CellTag[] = Array.from(tagsRaw) as CellTag[];

  return { tags, heart, spawn, distToHeart: distToHeartRaw };
}

/** Nav-graph primitive: open, edge-adjacent neighbors of `cell`. */
export function openNeighbors(d: Dungeon, mesh: SphereMesh, cell: number): number[] {
  return (mesh.adj[cell] ?? []).filter((n) => d.tags[n] !== BLOCKED);
}

// Keep Vec3 importable from this module for convenience (mirrors grid.ts pattern).
export type { Vec3 };
