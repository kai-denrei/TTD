import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTank, stepTank } from './tank.ts';
import { makeTuning } from '../tuning/store.ts';

describe('tank steering', () => {
  // Tank at the +Z pole heading +X. Seen from outside (camera on +Z looking at
  // the origin) screen-right is +X and screen-up is +Y. A RIGHT turn must
  // therefore rotate the heading toward -Y: clockwise on screen.
  //
  // Pinned by a number rather than by an argument about winding, because an
  // argument about winding is exactly what produced the bug.
  function turned(turn: number): readonly [number, number, number] {
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    stepTank(tank, 0.25, { forward: 0, turn, fire: false }, [], makeTuning());
    return tank.heading;
  }

  test('right turns RIGHT (clockwise seen from outside)', () => {
    const h = turned(1);
    assert.ok(h[1] < -0.5, `right turn gave heading ${JSON.stringify(h)} — rotated toward +Y, i.e. left`);
  });

  test('left turns LEFT', () => {
    const h = turned(-1);
    assert.ok(h[1] > 0.5, `left turn gave heading ${JSON.stringify(h)}`);
  });

  test('turning stays on the tangent plane and keeps unit length', () => {
    const h = turned(1);
    assert.ok(Math.abs(h[2]) < 1e-9, 'heading left the tangent plane at the +Z pole');
    assert.ok(Math.abs(Math.hypot(h[0], h[1], h[2]) - 1) < 1e-9, 'heading is not unit length');
  });
});

describe('tank acting — feeds tankIdleUnderThreat', () => {
  function acting(input: { forward: number; turn: number; fire: boolean }): boolean {
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    return stepTank(tank, 1 / 60, input, [], makeTuning()).acting;
  }

  test('turning counts as acting', () => {
    assert.equal(
      acting({ forward: 0, turn: 1, fire: false }), true,
      'a tank pivoting to bring guns to bear was recorded as idle',
    );
  });

  test('driving and firing count as acting', () => {
    assert.equal(acting({ forward: 1, turn: 0, fire: false }), true);
    assert.equal(acting({ forward: 0, turn: 0, fire: true }), true);
  });

  test('a completely idle tank is idle', () => {
    assert.equal(acting({ forward: 0, turn: 0, fire: false }), false);
  });
});
