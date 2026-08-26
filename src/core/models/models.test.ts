import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { fibDir, fitUnit, normV, crossV } from './helpers.ts';
import type { ModelPoint } from './helpers.ts';
import { turretPts } from './turret.ts';
import { minePts } from './mine.ts';

describe('model helpers', () => {
  test('fibDir returns unit vectors spread over the sphere', () => {
    for (let i = 0; i < 32; i++) {
      const d = fibDir(i, 32);
      assert.ok(Math.abs(Math.hypot(d[0], d[1], d[2]) - 1) < 1e-9, `fibDir(${i},32) not unit length`);
    }
    assert.ok(fibDir(0, 32)[1] > 0.9);
    assert.ok(fibDir(31, 32)[1] < -0.9);
  });

  test('normV of a zero vector does not divide by zero', () => {
    const n = normV([0, 0, 0]);
    assert.ok(Number.isFinite(n[0]) && Number.isFinite(n[1]) && Number.isFinite(n[2]));
  });

  test('crossV is perpendicular to both inputs', () => {
    assert.deepEqual(crossV([1, 0, 0], [0, 1, 0]), [0, 0, 1]);
  });

  test('fitUnit scales the farthest point to radius 1 and preserves the highlight flag', () => {
    const src: ModelPoint[] = [[2, 0, 0, 0], [0, 1, 0, 1]];
    const out = fitUnit(src);
    assert.equal(Math.hypot(out[0]![0], out[0]![1], out[0]![2]), 1);
    assert.equal(out[1]![3], 1, 'highlight flag lost');
  });
});

// Exact counts are derived from generator structure, not observed from a run.
// turret = 225 pedestal (9 rings x 22, + 27 of 54 dome dots with y >= 0)
//        + 294 housing (7x7 grid x 6 faces) + 71 barrel (10 rings x 7, + muzzle).
// mine   = 360 shell + 26 spikes x 5 segments.
// If a port produces different numbers, the PORT is wrong, not the test.
const MODELS = [
  { name: 'turret', fn: turretPts, points: 590, highlights: 1 },
  { name: 'mine', fn: minePts, points: 490, highlights: 26 },
] as const;

describe('M0 models', () => {
  for (const m of MODELS) {
    test(`${m.name} has exactly ${m.points} points`, () => {
      assert.equal(m.fn().length, m.points);
    });

    test(`${m.name} has exactly ${m.highlights} highlight dots`, () => {
      assert.equal(m.fn().filter((p) => p[3] === 1).length, m.highlights);
    });

    test(`${m.name} fits inside the unit sphere and touches it`, () => {
      let max = 0;
      for (const p of m.fn()) {
        const r = Math.hypot(p[0], p[1], p[2]);
        assert.ok(r <= 1 + 1e-9, `${m.name} point escapes the unit sphere at r=${r}`);
        if (r > max) max = r;
      }
      assert.ok(Math.abs(max - 1) < 1e-9, `${m.name} never reaches r=1; fitUnit did not normalise`);
    });

    test(`${m.name} every point has 4 finite components`, () => {
      for (const p of m.fn()) {
        assert.equal(p.length, 4);
        for (const c of p) assert.ok(Number.isFinite(c));
      }
    });

    test(`${m.name} is deterministic across calls`, () => {
      assert.deepEqual(m.fn(), m.fn());
    });
  }
});
