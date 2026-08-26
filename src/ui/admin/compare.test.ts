import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { diffPresets, diffSummaries, COMPARE_METRICS, COMPARE_SEEDS } from './compare.ts';

describe('preset diff', () => {
  test('reports only the keys that differ', () => {
    assert.deepEqual(diffPresets('enemy.speed=1;wave.gap=8', 'enemy.speed=2;wave.gap=8'),
      [{ key: 'enemy.speed', a: '1', b: '2' }]);
  });
  test('identical presets produce no rows', () => {
    assert.deepEqual(diffPresets('a=1;b=2', 'a=1;b=2'), []);
  });
  test('a key present on one side only is reported', () => {
    assert.deepEqual(diffPresets('a=1', 'a=1;b=2'), [{ key: 'b', a: '—', b: '2' }]);
  });
});

describe('summary diff', () => {
  test('computes b - a for the requested metrics only', () => {
    assert.deepEqual(diffSummaries({ x: 10, y: 1 }, { x: 25, y: 9 }, ['x']),
      [{ key: 'x', a: 10, b: 25, delta: 15 }]);
  });
  test('a metric missing from a summary reads as 0 rather than NaN', () => {
    const d = diffSummaries({}, { x: 4 }, ['x']);
    assert.equal(d[0]!.delta, 4);
    assert.ok(!Number.isNaN(d[0]!.a));
  });
});

describe('compare configuration', () => {
  test('uses at least three seeds — one seed is not evidence', () => {
    assert.ok(COMPARE_SEEDS.length >= 3);
    assert.equal(new Set(COMPARE_SEEDS).size, COMPARE_SEEDS.length, 'duplicate seeds inflate confidence');
  });
  test('reports survivedFor and the kill share', () => {
    assert.ok(COMPARE_METRICS.includes('survivedFor'));
    assert.ok(COMPARE_METRICS.includes('playerKillShare'));
  });
  test('excludes heartHits — it saturates at heart HP once runs truncate at death', () => {
    assert.ok(
      !COMPARE_METRICS.includes('heartHits'),
      'heartHits reads 20 vs 20 for any two runs that both end in death: it looks measured but cannot move',
    );
    assert.ok(COMPARE_METRICS.includes('survived'), 'survived carries what heartHits used to imply');
  });
});
