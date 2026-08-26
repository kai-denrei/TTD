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

describe('tank aimed fire — the barrel finally matters', () => {
  function fireAt(offsetRad: number, arcDeg: number) {
    const t = makeTuning();
    t.set('tank.fireArc', arcDeg);
    t.set('tank.range', 0.6);
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    // A critter on the surface, `offsetRad` around the pole from the heading.
    const a = 0.2; // arc distance from the tank
    const dir: [number, number, number] = [Math.cos(offsetRad), Math.sin(offsetRad), 0];
    const pos: [number, number, number] = [
      dir[0] * Math.sin(a), dir[1] * Math.sin(a), Math.cos(a),
    ];
    const critter = {
      id: 1, type: 'phage', alive: true, hp: 5, cur: 0, next: 0, prog: 0, pos,
      envValue: 1, envTarget: 1, envLeft: 1, reactMult: 1, reactLeft: 0,
      contactLeft: 0, slowFactor: 1, slowLeft: 0, bornAt: 0, firstHitAt: null, hpMax: 5, lastHitAt: -Infinity,
    };
    return stepTank(tank, 1 / 60, { forward: 0, turn: 0, fire: true }, [critter], t).events;
  }

  test('a critter straight ahead is hit', () => {
    assert.equal(fireAt(0, 45).length, 1);
  });

  test('a critter 90 degrees off the barrel is NOT hit at a 45 degree arc', () => {
    assert.equal(fireAt(Math.PI / 2, 45).length, 0, 'the tank shot something it was not pointing at');
  });

  test('a critter directly behind is never hit at a narrow arc', () => {
    assert.equal(fireAt(Math.PI, 45).length, 0);
  });

  test('an arc of 180 degrees reproduces the old omnidirectional behaviour', () => {
    assert.equal(fireAt(Math.PI / 2, 180).length, 1);
  });
});

describe('tank heat and lockout — you cannot hold the trigger', () => {
  function sustained(seconds: number, heatMax: number, coolRate: number) {
    const t = makeTuning();
    t.set('tank.heatMax', heatMax);
    t.set('tank.coolRate', coolRate);
    t.set('tank.fireArc', 180);
    t.set('tank.fireRate', 0.1);
    t.set('tank.range', 0.6);
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    const critter = {
      id: 1, type: 'phage', alive: true, hp: 1e9, cur: 0, next: 0, prog: 0,
      pos: [Math.sin(0.2), 0, Math.cos(0.2)] as [number, number, number],
      envValue: 1, envTarget: 1, envLeft: 1, reactMult: 1, reactLeft: 0,
      contactLeft: 0, slowFactor: 1, slowLeft: 0, bornAt: 0, firstHitAt: null, hpMax: 5, lastHitAt: -Infinity,
    };
    let shots = 0;
    const steps = Math.round(seconds * 60);
    for (let i = 0; i < steps; i++) {
      shots += stepTank(tank, 1 / 60, { forward: 0, turn: 0, fire: true }, [critter], t).events.length;
    }
    return { tank, shots };
  }

  test('heat accumulates while firing', () => {
    const { tank } = sustained(0.5, 2.4, 1.4);
    assert.ok(tank.heat > 0, 'firing generated no heat');
  });

  test('sustained fire trips the lockout', () => {
    const { tank } = sustained(4, 2.4, 1.4);
    assert.equal(tank.lockedOut, true, 'held the trigger for 4s at heatMax 2.4 without locking out');
  });

  test('a locked-out tank stops firing', () => {
    const long = sustained(6, 1.0, 0.2).shots;   // locks out early, cools slowly
    const free = sustained(6, 100, 0.2).shots;   // effectively never locks out
    assert.ok(long < free, `lockout did not reduce shots (${long} vs ${free})`);
  });

  test('heat sheds and fire resumes after cooling', () => {
    const t = makeTuning();
    t.set('tank.heatMax', 1.0);
    t.set('tank.coolRate', 4.0);
    t.set('tank.fireArc', 180);
    const tank = makeTank([0, 0, 1], 0);
    tank.heading = [1, 0, 0];
    for (let i = 0; i < 120; i++) stepTank(tank, 1 / 60, { forward: 0, turn: 0, fire: true }, [], t);
    for (let i = 0; i < 120; i++) stepTank(tank, 1 / 60, { forward: 0, turn: 0, fire: false }, [], t);
    assert.equal(tank.lockedOut, false, 'never recovered from lockout');
    assert.ok(tank.heat < 0.01, `heat did not shed: ${tank.heat}`);
  });
});
