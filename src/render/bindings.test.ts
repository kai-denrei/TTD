import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { RENDER_BINDINGS, RENDER_ONLY_KEYS, makeRenderTarget, readRenderState } from './bindings.ts';
import { makeTuning, LEVERS } from '../core/tuning/store.ts';

describe('render bindings — coverage', () => {
  test('every render-only lever has exactly one binding', () => {
    for (const key of RENDER_ONLY_KEYS) {
      const hits = RENDER_BINDINGS.filter((b) => b.key === key);
      assert.equal(hits.length, 1, `${key} has ${hits.length} bindings; expected exactly 1`);
    }
  });

  test('every binding names a lever that exists in the schema', () => {
    for (const b of RENDER_BINDINGS) {
      assert.ok(LEVERS.some((l) => l.key === b.key), `binding "${b.key}" is not a lever in LEVERS`);
    }
  });

  test('no binding is declared twice', () => {
    const keys = RENDER_BINDINGS.map((b) => b.key);
    assert.equal(new Set(keys).size, keys.length, 'duplicate binding keys');
  });
});

describe('render bindings — effect', () => {
  test('applying min and max leaves the target in different states', () => {
    for (const b of RENDER_BINDINGS) {
      const lever = LEVERS.find((l) => l.key === b.key)!;
      const lo = makeRenderTarget();
      const hi = makeRenderTarget();
      b.apply(lo, lever.min);
      b.apply(hi, lever.max);
      assert.notDeepEqual(lo, hi, `binding "${b.key}" is DEAD — target identical at min and max`);
    }
  });
});

describe('render bindings — read per frame, never cached', () => {
  test('readRenderState reflects a value changed between calls', () => {
    const tuning = makeTuning();
    const target = makeRenderTarget();
    for (const b of RENDER_BINDINGS) {
      const lever = LEVERS.find((l) => l.key === b.key)!;
      tuning.set(b.key, lever.min);
      readRenderState(tuning, target);
      const atMin = JSON.stringify(target);
      tuning.set(b.key, lever.max);
      readRenderState(tuning, target);
      assert.notEqual(atMin, JSON.stringify(target), `"${b.key}" did not update on the second read — it is cached`);
    }
  });

  test('readRenderState reads every bound key on every call', () => {
    const real = makeTuning();
    const seen: string[] = [];
    const recording = { get(key: string): number { seen.push(key); return real.get(key); } };
    readRenderState(recording, makeRenderTarget());
    for (const b of RENDER_BINDINGS) {
      assert.ok(seen.includes(b.key), `readRenderState never read "${b.key}"`);
    }
  });
});
