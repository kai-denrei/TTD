import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSphereMesh, squarenessError, valences } from './grid.ts';

const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 60 });

test('every face is a quad', () => {
  assert.ok(MESH.quads.length > 0);
  for (const q of MESH.quads) assert.equal(q.length, 4, 'non-quad face');
});

test('all vertices are on the unit sphere', () => {
  for (const v of MESH.verts) {
    const r = Math.hypot(v[0], v[1], v[2]);
    assert.ok(Math.abs(r - 1) < 1e-6, `vertex off sphere: r=${r}`);
  }
});

test('adjacency is symmetric and self-free', () => {
  MESH.adj.forEach((nbrs, i) => {
    for (const n of nbrs) {
      assert.notEqual(n, i, 'cell adjacent to itself');
      assert.ok(MESH.adj[n]?.includes(i), `adjacency not symmetric: ${i}<->${n}`);
    }
  });
});

test('centers and normals align per quad', () => {
  assert.equal(MESH.centers.length, MESH.quads.length);
  assert.equal(MESH.normals.length, MESH.quads.length);
});

test('generation is deterministic for a seed', () => {
  const a = generateSphereMesh({ seed: 11, points: 400, relaxIters: 20 });
  const b = generateSphereMesh({ seed: 11, points: 400, relaxIters: 20 });
  assert.deepEqual(a.centers, b.centers);
});

test('different seeds differ', () => {
  const a = generateSphereMesh({ seed: 11, points: 400, relaxIters: 20 });
  const b = generateSphereMesh({ seed: 12, points: 400, relaxIters: 20 });
  assert.notDeepEqual(a.centers, b.centers);
});

test('relaxation improves squareness and never produces NaN', () => {
  const raw = generateSphereMesh({ seed: 5, points: 400, relaxIters: 0 });
  const done = generateSphereMesh({ seed: 5, points: 400, relaxIters: 80 });
  const e0 = squarenessError(raw);
  const e1 = squarenessError(done);
  assert.ok(Number.isFinite(e0) && Number.isFinite(e1), 'NaN squareness');
  assert.ok(e1 < e0, `relax made it worse: ${e0} -> ${e1}`);
});

test('valence distribution is sane (mostly 4)', () => {
  const v = valences(MESH);
  const total = [...v.values()].reduce((a, b) => a + b, 0);
  const four = v.get(4) ?? 0;
  assert.ok(four / total > 0.6, `too few regular vertices: ${four}/${total}`);
});
