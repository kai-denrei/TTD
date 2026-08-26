import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeLoop, FIXED_DT, MAX_STEPS_PER_FRAME } from './loop.ts';

function counter(doneAfter = Infinity) {
  const state = { steps: 0, dts: [] as number[] };
  return {
    state,
    stepper: {
      step(dt: number) { state.steps++; state.dts.push(dt); },
      done() { return state.steps >= doneAfter; },
    },
  };
}

describe('fixed-timestep loop', () => {
  test('every step receives exactly FIXED_DT regardless of frame time', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    loop.advance(0.0163);
    loop.advance(0.0211);
    loop.advance(0.0092);
    assert.ok(c.state.dts.length > 0, 'no steps ran at all');
    for (const dt of c.state.dts) assert.equal(dt, FIXED_DT);
  });

  test('accumulates leftover time across frames instead of dropping it', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    loop.advance(0.01);
    loop.advance(0.01);
    assert.equal(c.state.steps, 1, 'two 10ms frames should yield exactly one 16.67ms step');
    loop.advance(0.01);
    assert.equal(c.state.steps, 1, 'leftover 3.3ms + 10ms is still under one step');
    loop.advance(0.01);
    assert.equal(c.state.steps, 2, 'the carried remainder must eventually produce a step');
  });

  test('one second of frames yields ~60 steps', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    for (let i = 0; i < 60; i++) loop.advance(1 / 60);
    assert.ok(Math.abs(c.state.steps - 60) <= 1, `expected ~60 steps, got ${c.state.steps}`);
  });

  test('clamps a long stall to MAX_STEPS_PER_FRAME — no spiral of death', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    loop.advance(10); // a backgrounded tab returning after 10 seconds
    assert.equal(c.state.steps, MAX_STEPS_PER_FRAME);
    // dropped time must NOT be carried over, or the next frame stalls too
    loop.advance(1 / 60);
    assert.equal(c.state.steps, MAX_STEPS_PER_FRAME + 1);
  });

  test('halts permanently once done() reports true', () => {
    const c = counter(3);
    const loop = makeLoop(c.stepper);
    loop.advance(1);
    assert.equal(c.state.steps, 3);
    assert.equal(loop.halted, true);
    loop.advance(1);
    assert.equal(c.state.steps, 3, 'stepped after halt — the terminal condition leaked');
  });

  test('reports how many steps a frame actually ran', () => {
    const c = counter();
    const loop = makeLoop(c.stepper);
    assert.equal(loop.advance(0.001), 0);
    assert.equal(loop.advance(0.05), 3);
    assert.equal(loop.stepped, 3);
  });
});
