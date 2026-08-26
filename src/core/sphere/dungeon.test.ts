import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSphereMesh } from './grid.ts';
import { generateDungeon, bfsDist, openNeighbors, BLOCKED } from './dungeon.ts';

const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
const D = generateDungeon(MESH, { seed: 7, rooms: 12, roomRadius: 4,
  extraCorridors: 6, corridorWidth: 1, obstacles: 0.2 });

test('tags cover every cell', () => assert.equal(D.tags.length, MESH.quads.length));

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
  const a = generateDungeon(MESH, { seed: 3, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1, obstacles: 0.2 });
  const b = generateDungeon(MESH, { seed: 3, rooms: 10, roomRadius: 3, extraCorridors: 4, corridorWidth: 1, obstacles: 0.2 });
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
