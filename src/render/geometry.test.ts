import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildBoardGeometry, WALL_HEIGHT } from './geometry.ts';
import { generateSphereMesh } from '../core/sphere/grid.ts';
import { generateDungeon, BLOCKED } from '../core/sphere/dungeon.ts';

const mesh = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
const dungeon = generateDungeon(mesh, {
  seed: 7, rooms: 12, roomRadius: 4, extraCorridors: 6, corridorWidth: 1,
});
const geo = buildBoardGeometry(mesh, dungeon);

type V = [number, number, number];
function tri(i: number): [V, V, V] {
  const p = geo.positions;
  const o = i * 9;
  return [
    [p[o]!, p[o + 1]!, p[o + 2]!],
    [p[o + 3]!, p[o + 4]!, p[o + 5]!],
    [p[o + 6]!, p[o + 7]!, p[o + 8]!],
  ];
}
function radius(v: V): number { return Math.hypot(v[0], v[1], v[2]); }
function normalOf(t: [V, V, V]): V {
  const [a, b, c] = t;
  const u: V = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const w: V = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
  return [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
}
function centroid(t: [V, V, V]): V {
  return [(t[0][0] + t[1][0] + t[2][0]) / 3, (t[0][1] + t[1][1] + t[2][1]) / 3, (t[0][2] + t[1][2] + t[2][2]) / 3];
}

const TOTAL = geo.counts.floor + geo.counts.wallTop + geo.counts.skirt;

// positions is a Float32Array, whose relative precision is ~1.2e-7. Asserting
// radii to 1e-9 would be unsatisfiable however correct the code is — the
// storage type, not the maths, sets the floor. 1e-6 is two orders inside
// float32 noise and still far tighter than WALL_HEIGHT (0.03), so a surface
// placed on the wrong radius cannot slip through.
const EPS = 1e-6;

describe('board geometry — structure', () => {
  test('arrays are consistent with the triangle count', () => {
    assert.equal(geo.positions.length, TOTAL * 9);
    assert.equal(geo.colors.length, TOTAL * 9);
    assert.equal(geo.faceCell.length, TOTAL);
  });

  test('every triangle names a real cell', () => {
    for (let i = 0; i < TOTAL; i++) {
      const cell = geo.faceCell[i]!;
      assert.ok(cell >= 0 && cell < mesh.quads.length, `triangle ${i} -> cell ${cell}`);
    }
  });

  test('is deterministic — two builds are byte-identical', () => {
    const again = buildBoardGeometry(mesh, dungeon);
    assert.deepEqual(Array.from(again.positions), Array.from(geo.positions));
    assert.deepEqual(Array.from(again.faceCell), Array.from(geo.faceCell));
  });
});

describe('board geometry — surfaces sit at the right radius', () => {
  test('floor triangles are on the unit sphere and belong to open cells', () => {
    for (let i = 0; i < geo.counts.floor; i++) {
      assert.notEqual(dungeon.tags[geo.faceCell[i]!], BLOCKED, `floor tri ${i} on a BLOCKED cell`);
      for (const v of tri(i)) assert.ok(Math.abs(radius(v) - 1) < EPS, `floor r=${radius(v)}`);
    }
  });

  test('wall tops are lifted by exactly WALL_HEIGHT and belong to BLOCKED cells', () => {
    const start = geo.counts.floor;
    for (let i = start; i < start + geo.counts.wallTop; i++) {
      assert.equal(dungeon.tags[geo.faceCell[i]!], BLOCKED, `wall tri ${i} on an open cell`);
      for (const v of tri(i)) {
        assert.ok(Math.abs(radius(v) - (1 + WALL_HEIGHT)) < EPS, `wall top r=${radius(v)}`);
      }
    }
  });

  test('skirt vertices sit at exactly one of the two radii, never between', () => {
    const start = geo.counts.floor + geo.counts.wallTop;
    for (let i = start; i < TOTAL; i++) {
      for (const v of tri(i)) {
        const r = radius(v);
        const onFloor = Math.abs(r - 1) < EPS;
        const onTop = Math.abs(r - (1 + WALL_HEIGHT)) < EPS;
        assert.ok(onFloor || onTop, `skirt vertex at r=${r} is neither floor nor top`);
      }
    }
  });
});

describe('board geometry — the skirt filter', () => {
  // Derived from the dungeon, NOT observed from the build.
  test('emits exactly two triangles per BLOCKED-open edge and none elsewhere', () => {
    const owners = new Map<number, number[]>();
    mesh.quads.forEach((q, ci) => {
      for (let i = 0; i < q.length; i++) {
        const a = q[i]!;
        const b = q[(i + 1) % q.length]!;
        const k = a < b ? a * 1e6 + b : b * 1e6 + a;
        const list = owners.get(k);
        if (list === undefined) owners.set(k, [ci]); else list.push(ci);
      }
    });
    let expected = 0;
    for (const cells of owners.values()) {
      if (cells.length !== 2) continue;
      const bx = dungeon.tags[cells[0]!] === BLOCKED;
      const by = dungeon.tags[cells[1]!] === BLOCKED;
      if (bx !== by) expected += 1;
    }
    assert.ok(expected > 0, 'the test fixture has no wall-open boundary at all');
    assert.equal(geo.counts.skirt, expected * 2, 'skirt triangle count does not match the boundary');
  });

  test('every skirt triangle is attributed to its BLOCKED cell, not the open one', () => {
    const start = geo.counts.floor + geo.counts.wallTop;
    for (let i = start; i < TOTAL; i++) {
      assert.equal(dungeon.tags[geo.faceCell[i]!], BLOCKED, `skirt tri ${i} attributed to an open cell`);
    }
  });
});

describe('board geometry — winding', () => {
  test('floor and wall-top triangles face outward from the sphere', () => {
    for (let i = 0; i < geo.counts.floor + geo.counts.wallTop; i++) {
      const t = tri(i);
      const n = normalOf(t);
      const c = centroid(t);
      assert.ok(n[0] * c[0] + n[1] * c[1] + n[2] * c[2] > 0, `triangle ${i} faces inward`);
    }
  });

  test('skirt triangles face away from their wall cell', () => {
    // A backwards skirt is invisible from outside and reads as a hole.
    const start = geo.counts.floor + geo.counts.wallTop;
    for (let i = start; i < TOTAL; i++) {
      const t = tri(i);
      const n = normalOf(t);
      const wc = mesh.centers[geo.faceCell[i]!]!;
      const c = centroid(t);
      const away: V = [c[0] - wc[0], c[1] - wc[1], c[2] - wc[2]];
      assert.ok(
        n[0] * away[0] + n[1] * away[1] + n[2] * away[2] > 0,
        `skirt ${i} faces into its own wall — invisible from outside`,
      );
    }
  });
});
