import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSphereMesh } from './grid.ts';
import { generateDungeon, bfsDist, openNeighbors, BLOCKED } from './dungeon.ts';

const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
const D = generateDungeon(MESH, { seed: 7, rooms: 12, roomRadius: 4,
  extraCorridors: 6, corridorWidth: 1 });

test('tags cover every cell', () => assert.equal(D.tags.length, MESH.quads.length));

// --- the soft-lock invariant ----------------------------------------------
// A stranded open region means critters can spawn somewhere with no path to
// the heart, and the run cannot be completed. It is the single most damaging
// generation bug available to us, it is silent, and it is seed-dependent —
// so one seed proves nothing. Sweep a spread of seeds and shapes.

function strandedCells(mesh: ReturnType<typeof generateSphereMesh>, d: ReturnType<typeof generateDungeon>): number {
  const open = (i: number) => d.tags[i] !== BLOCKED;
  const first = d.tags.findIndex((t) => t !== BLOCKED);
  if (first === -1) return -1; // nothing open at all is its own failure
  const dist = bfsDist(mesh.adj, [first], open);
  return d.tags.reduce<number>((n, t, i) => (t !== BLOCKED && dist[i] === -1 ? n + 1 : n), 0);
}

test('the open subgraph stays connected across seeds and shapes', () => {
  const shapes = [
    { rooms: 6, roomRadius: 2, extraCorridors: 0, corridorWidth: 1 },
    { rooms: 12, roomRadius: 4, extraCorridors: 6, corridorWidth: 1 },
    { rooms: 20, roomRadius: 3, extraCorridors: 10, corridorWidth: 2 },
  ];
  for (const seed of [1, 2, 3, 7, 13, 29, 101]) {
    const mesh = generateSphereMesh({ seed, points: 400, relaxIters: 20 });
    for (const shape of shapes) {
      const d = generateDungeon(mesh, { seed, ...shape });
      const stranded = strandedCells(mesh, d);
      assert.equal(stranded, 0, `seed=${seed} rooms=${shape.rooms} left ${stranded} cells stranded`);
    }
  }
});

test('every open cell can reach the heart across seeds', () => {
  // distToHeart is the nav field every critter walks down. -1 on an OPEN cell
  // means a spawn there can never arrive — the same soft-lock, seen from the
  // field rather than the graph.
  for (const seed of [1, 5, 17, 44]) {
    const mesh = generateSphereMesh({ seed, points: 400, relaxIters: 20 });
    const d = generateDungeon(mesh, { seed, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1 });
    d.tags.forEach((t, i) => {
      if (t !== BLOCKED) {
        assert.ok((d.distToHeart[i] ?? -1) >= 0, `seed=${seed}: open cell ${i} has no route to the heart`);
      }
    });
  }
});

test('the open subgraph is fully connected', () => {
  const open = (i: number) => D.tags[i] !== BLOCKED;
  const first = D.tags.findIndex((t) => t !== BLOCKED);
  const dist = bfsDist(MESH.adj, [first], open);
  const unreachable = D.tags.filter((t, i) => t !== BLOCKED && dist[i] === -1);
  assert.equal(unreachable.length, 0, 'open cells stranded from the rest');
});

test('heart and spawn are open and distinct', () => {
  assert.notEqual(D.heart, D.spawn);
  assert.notEqual(D.tags[D.heart], BLOCKED);
  assert.notEqual(D.tags[D.spawn], BLOCKED);
});

test('distToHeart is 0 at the heart and -1 only where blocked/unreachable', () => {
  assert.equal(D.distToHeart[D.heart], 0);
  D.distToHeart.forEach((d, i) => {
    if (D.tags[i] !== BLOCKED) assert.ok(d >= 0, `open cell ${i} has no path to the heart`);
  });
});

test('the journey is non-trivial', () => {
  assert.ok((D.distToHeart[D.spawn] ?? 0) > 10, 'spawn is too close to the heart');
});

test('deterministic for a seed', () => {
  const a = generateDungeon(MESH, { seed: 3, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1 });
  const b = generateDungeon(MESH, { seed: 3, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1 });
  assert.deepEqual(a.tags, b.tags);
});

test('openNeighbors returns only open, adjacent cells', () => {
  for (const c of [D.heart, D.spawn]) {
    for (const n of openNeighbors(D, MESH, c)) {
      assert.ok(MESH.adj[c]?.includes(n), 'not adjacent');
      assert.notEqual(D.tags[n], BLOCKED, 'not open');
    }
  }
});
