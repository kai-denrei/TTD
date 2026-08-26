// vec3.test.ts — invariant tests for every Vec3 helper.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  add, sub, scale, dot, cross, len, dist, normalize, lerp, mean, tangentBasis,
} from './vec3.ts';
import type { Vec3 } from './vec3.ts';

const EPS = 1e-10;
const near = (a: number, b: number, eps = EPS) =>
  assert.ok(Math.abs(a - b) < eps, `expected ${a} ≈ ${b} (eps=${eps})`);
const nearV = (a: Vec3, b: Vec3, eps = EPS) => {
  near(a[0], b[0], eps);
  near(a[1], b[1], eps);
  near(a[2], b[2], eps);
};

test('add', () => {
  nearV(add([1, 2, 3], [4, 5, 6]), [5, 7, 9]);
  nearV(add([0, 0, 0], [1, -1, 0]), [1, -1, 0]);
});

test('sub', () => {
  nearV(sub([4, 5, 6], [1, 2, 3]), [3, 3, 3]);
  nearV(sub([1, 1, 1], [1, 1, 1]), [0, 0, 0]);
});

test('scale', () => {
  nearV(scale([1, 2, 3], 2), [2, 4, 6]);
  nearV(scale([1, 2, 3], 0), [0, 0, 0]);
  nearV(scale([1, 2, 3], -1), [-1, -2, -3]);
});

test('dot', () => {
  near(dot([1, 0, 0], [0, 1, 0]), 0); // perpendicular
  near(dot([1, 2, 3], [4, 5, 6]), 32); // 4+10+18
  near(dot([1, 0, 0], [1, 0, 0]), 1);
});

test('cross', () => {
  nearV(cross([1, 0, 0], [0, 1, 0]), [0, 0, 1]); // x × y = z
  nearV(cross([0, 1, 0], [0, 0, 1]), [1, 0, 0]); // y × z = x
  nearV(cross([0, 0, 1], [1, 0, 0]), [0, 1, 0]); // z × x = y
  nearV(cross([1, 0, 0], [1, 0, 0]), [0, 0, 0]); // parallel → zero
});

test('len', () => {
  near(len([1, 0, 0]), 1);
  near(len([0, 0, 0]), 0);
  near(len([3, 4, 0]), 5);
  near(len([1, 1, 1]), Math.sqrt(3));
});

test('dist', () => {
  near(dist([0, 0, 0], [1, 0, 0]), 1);
  near(dist([1, 2, 3], [1, 2, 3]), 0);
  near(dist([0, 0, 0], [3, 4, 0]), 5);
});

test('normalize — unit result', () => {
  const u = normalize([3, 0, 0]);
  near(len(u), 1);
  nearV(u, [1, 0, 0]);

  const v = normalize([1, 1, 1]);
  near(len(v), 1, 1e-9);
});

test('normalize — zero vector returns fallback axis, not NaN', () => {
  const z = normalize([0, 0, 0]);
  assert.ok(Number.isFinite(z[0]) && Number.isFinite(z[1]) && Number.isFinite(z[2]),
    'NaN from normalize([0,0,0])');
  near(len(z), 1, 1e-9);
});

test('lerp', () => {
  nearV(lerp([0, 0, 0], [1, 1, 1], 0), [0, 0, 0]);
  nearV(lerp([0, 0, 0], [1, 1, 1], 1), [1, 1, 1]);
  nearV(lerp([0, 0, 0], [2, 0, 0], 0.5), [1, 0, 0]);
});

test('mean', () => {
  nearV(mean([[1, 0, 0], [0, 1, 0], [-1, 0, 0], [0, -1, 0]]), [0, 0, 0]);
  nearV(mean([[1, 2, 3]]), [1, 2, 3]);
  nearV(mean([[1, 1, 1], [3, 3, 3]]), [2, 2, 2]);
});

test('tangentBasis — orthogonality and unit length', () => {
  const axes: Vec3[] = [
    [1, 0, 0], [0, 1, 0], [0, 0, 1],
    normalize([1, 1, 1]), normalize([0.5, -0.5, 0.7071]),
  ];
  for (const n of axes) {
    const [u, v] = tangentBasis(n);
    near(len(u), 1, 1e-9);
    near(len(v), 1, 1e-9);
    near(dot(n, u), 0, 1e-9);
    near(dot(n, v), 0, 1e-9);
    near(dot(u, v), 0, 1e-9);
  }
});
