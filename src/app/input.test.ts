import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { applyStick, clampZoom } from './input.ts';

describe('virtual stick', () => {
  test('centre is dead — no drift', () => {
    assert.deepEqual(applyStick(0, 0), { forward: 0, turn: 0 });
  });

  test('inside the deadzone produces no movement', () => {
    const r = applyStick(3, 3, 0.2);
    assert.equal(r.forward, 0);
    assert.equal(r.turn, 0);
  });

  test('pushing up drives forward, pushing down reverses', () => {
    // screen y grows downward, so "up" is a negative dy
    assert.ok(applyStick(0, -60).forward > 0.9);
    assert.ok(applyStick(0, 60).forward < -0.9);
  });

  test('pushing right turns right', () => {
    assert.ok(applyStick(60, 0).turn > 0.9);
    assert.ok(applyStick(-60, 0).turn < -0.9);
  });

  test('output is clamped however far the finger travels', () => {
    const r = applyStick(5000, -5000);
    assert.ok(r.forward <= 1 && r.forward >= -1);
    assert.ok(r.turn <= 1 && r.turn >= -1);
  });
});

describe('zoom clamp', () => {
  test('stays inside sane bounds', () => {
    assert.ok(clampZoom(0.0001) >= 0.35);
    assert.ok(clampZoom(1000) <= 3);
    assert.equal(clampZoom(1), 1);
  });
});
