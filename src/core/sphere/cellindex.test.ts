import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSphereMesh } from './grid.ts';
import { makeCellIndex } from './cellindex.ts';
import type { Vec3 } from './vec3.ts';

const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });

test('a cell centre resolves to its own cell', () => {
  const idx = makeCellIndex(MESH.centers, 0.05);
  MESH.centers.forEach((c, i) => assert.equal(idx(c), i, `centre of ${i} resolved elsewhere`));
});

test('a nudged point resolves to a nearby cell', () => {
  const idx = makeCellIndex(MESH.centers, 0.05);
  const i = 10;
  const c = MESH.centers[i]!;
  const near = idx([c[0] + 1e-4, c[1], c[2]] as Vec3);
  assert.ok(near === i || MESH.adj[i]?.includes(near), 'nudge jumped far away');
});
