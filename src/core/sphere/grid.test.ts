import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSphereMesh, squarenessError, valences } from './grid.ts';

const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 60 });

test('every face is a quad', () => {
  assert.ok(MESH.quads.length > 0);
  for (const q of MESH.quads) assert.equal(q.length, 4, 'non-quad face');
});

// --- topology -------------------------------------------------------------
// The strongest guarantees we have that the hull -> merge -> subdivide -> dual
// chain produced a valid closed surface. A hole, a duplicated face or a
// non-manifold edge would sail past every geometric check above and then
// silently poison pathfinding, collision and everything built on the graph.

/** Undirected edge key, orientation-independent. */
const edgeKey = (a: number, b: number) => (a < b ? `${a}:${b}` : `${b}:${a}`);

function edgeUse(mesh: typeof MESH): Map<string, number> {
  const uses = new Map<string, number>();
  for (const q of mesh.quads) {
    for (let i = 0; i < q.length; i++) {
      const a = q[i]!;
      const b = q[(i + 1) % q.length]!;
      const k = edgeKey(a, b);
      uses.set(k, (uses.get(k) ?? 0) + 1);
    }
  }
  return uses;
}

test('the mesh is closed and manifold — every edge joins exactly 2 faces', () => {
  const uses = edgeUse(MESH);
  const boundary = [...uses.entries()].filter(([, n]) => n === 1);
  const nonManifold = [...uses.entries()].filter(([, n]) => n > 2);
  assert.equal(boundary.length, 0, `${boundary.length} boundary edges — the surface has a hole`);
  assert.equal(nonManifold.length, 0, `${nonManifold.length} edges shared by >2 faces — non-manifold`);
});

test('Euler characteristic V - E + F = 2 (a sphere, genus 0)', () => {
  const V = MESH.verts.length;
  const E = edgeUse(MESH).size;
  const F = MESH.quads.length;
  assert.equal(V - E + F, 2, `V=${V} E=${E} F=${F} gives chi=${V - E + F}, expected 2`);
});

test('a closed quad mesh satisfies E = 2F', () => {
  // Follows from every face having 4 edges and every edge being shared twice.
  // Stated separately because it localises WHICH assumption broke if chi != 2.
  assert.equal(edgeUse(MESH).size, 2 * MESH.quads.length);
});

test('no quad repeats a vertex (no degenerate faces)', () => {
  MESH.quads.forEach((q, i) => {
    assert.equal(new Set(q).size, q.length, `quad ${i} reuses a vertex: ${q}`);
  });
});

test('topology holds across several seeds and densities', () => {
  for (const [seed, points] of [[3, 300], [11, 500], [19, 800]] as const) {
    const m = generateSphereMesh({ seed, points, relaxIters: 20 });
    const V = m.verts.length;
    const E = edgeUse(m).size;
    const F = m.quads.length;
    assert.equal(V - E + F, 2, `seed=${seed} points=${points}: chi=${V - E + F}`);
  }
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
