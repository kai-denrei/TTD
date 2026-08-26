import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32, hashSeed, stream, range, int, pick, shuffle } from './rng.ts';

test('mulberry32 is deterministic for a seed', () => {
  const a = mulberry32(7);
  const b = mulberry32(7);
  const seqA = Array.from({ length: 16 }, () => a());
  const seqB = Array.from({ length: 16 }, () => b());
  assert.deepEqual(seqA, seqB);
});

test('different seeds diverge', () => {
  const a = mulberry32(7);
  const b = mulberry32(8);
  const seqA = Array.from({ length: 16 }, () => a());
  const seqB = Array.from({ length: 16 }, () => b());
  assert.notDeepEqual(seqA, seqB);
});

test('output stays in [0,1)', () => {
  const r = mulberry32(12345);
  for (let i = 0; i < 5000; i++) {
    const v = r();
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
  }
});

test('hashSeed is stable and distinguishes names', () => {
  assert.equal(hashSeed('waves'), hashSeed('waves'));
  assert.notEqual(hashSeed('waves'), hashSeed('minds'));
});

test('named streams are independent but reproducible', () => {
  const waves1 = stream(7, 'waves');
  const waves2 = stream(7, 'waves');
  const minds = stream(7, 'minds');
  const w1 = Array.from({ length: 8 }, () => waves1());
  const w2 = Array.from({ length: 8 }, () => waves2());
  const m = Array.from({ length: 8 }, () => minds());
  assert.deepEqual(w1, w2, 'same seed+name must replay');
  assert.notDeepEqual(w1, m, 'different names must not correlate');
});

test('range respects bounds', () => {
  const r = mulberry32(99);
  for (let i = 0; i < 1000; i++) {
    const v = range(r, -3, 5);
    assert.ok(v >= -3 && v < 5, `out of range: ${v}`);
  }
});

test('int is inclusive on both ends and covers them', () => {
  const r = mulberry32(4);
  const seen = new Set<number>();
  for (let i = 0; i < 2000; i++) {
    const v = int(r, 1, 4);
    assert.ok(Number.isInteger(v) && v >= 1 && v <= 4, `bad int: ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [1, 2, 3, 4]);
});

test('pick returns a member and throws on empty', () => {
  const r = mulberry32(11);
  const items = ['a', 'b', 'c'] as const;
  for (let i = 0; i < 200; i++) assert.ok(items.includes(pick(r, items)));
  assert.throws(() => pick(r, []), /empty list/);
});

test('shuffle permutes without mutating the input', () => {
  const r = mulberry32(21);
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  const out = shuffle(r, src);
  assert.deepEqual(src, [1, 2, 3, 4, 5, 6, 7, 8], 'input must be untouched');
  assert.deepEqual(out.slice().sort((x, y) => x - y), src, 'same multiset');
});

test('shuffle is reproducible for a seed', () => {
  const src = [1, 2, 3, 4, 5, 6, 7, 8];
  assert.deepEqual(shuffle(mulberry32(5), src), shuffle(mulberry32(5), src));
});
