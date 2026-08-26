import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeHitstop, traumaFor, dangerLevel, FEEL_DEFAULTS } from './feel.ts';
import type { DangerLevel } from './feel.ts';
import type { WorldEvent } from '../core/sim/events.ts';

const DT = 1 / 60;
const ORIGIN: [number, number, number] = [0, 0, 1];

/** Run `update` until it reports full speed again, returning how many frames
 *  that took. Everything about hitstop is observable through this — the module
 *  exposes no `remaining`, on purpose. */
function framesUntilFullSpeed(h: { update(dt: number): number }, dt = DT, cap = 1000): number {
  for (let i = 1; i <= cap; i++) {
    if (h.update(dt) >= 1) return i;
  }
  return cap;
}

describe('hitstop', () => {
  test('idle is a no-op: full render speed before anything happens', () => {
    const h = makeHitstop();
    assert.equal(h.update(DT), 1);
    assert.equal(h.update(DT), 1);
  });

  test('the frame after a punch is frozen', () => {
    const h = makeHitstop();
    h.punch(FEEL_DEFAULTS.hitstopHeart);
    const scale = h.update(DT);
    assert.ok(scale < 0.05, `expected a near-stopped frame, got ${scale}`);
  });

  test('returns to full speed once the punch has run its course', () => {
    const h = makeHitstop();
    h.punch(0.05);
    const frames = framesUntilFullSpeed(h);
    // 0.05s is three 60Hz frames; allow the +1 the ease-out costs.
    assert.ok(frames <= 5, `hitstop overstayed: ${frames} frames`);
    assert.equal(h.update(DT), 1, 'must stay at full speed afterwards');
    assert.equal(h.update(DT), 1);
  });

  test('never returns a scale outside [0,1] — including absurd input', () => {
    const h = makeHitstop();
    const dts = [DT, 0, 0.5, DT, DT, -1, 2, DT];
    for (const punch of [0, -1, 0.02, 5, FEEL_DEFAULTS.hitstopImpact]) {
      h.punch(punch);
      for (const dt of dts) {
        const s = h.update(dt);
        assert.ok(s >= 0 && s <= 1, `scale ${s} out of range (punch ${punch}, dt ${dt})`);
      }
    }
  });

  test('eases back out rather than snapping', () => {
    const h = makeHitstop();
    h.punch(0.1);
    const scales: number[] = [];
    for (let i = 0; i < 8; i++) scales.push(h.update(DT));
    // Monotone non-decreasing, and it passes through the middle of the range
    // instead of jumping 0 -> 1 in one frame.
    for (let i = 1; i < scales.length; i++) {
      assert.ok(scales[i]! >= scales[i - 1]! - 1e-9, `scale went backwards at ${i}: ${scales}`);
    }
    assert.ok(
      scales.some((s) => s > 0.1 && s < 0.9),
      `no intermediate frame — that is a snap, not an ease: ${scales}`,
    );
  });

  test('a second punch during an active hitstop EXTENDS it', () => {
    // MEASURE FROM THE SECOND PUNCH, NOT FROM THE FIRST. Counting total frames
    // from the first punch does NOT discriminate: `remaining = seconds` cuts
    // the freeze short but also restarts the ease-out at zero, so the run can
    // come out longer overall while still being the bug. What must hold is
    // that the time LEFT after the second punch grew.
    const fine = 0.005; // finer than 60Hz so a few ms of difference is visible
    const spent = 4; // frames burned before the second hit lands

    const solo = makeHitstop();
    solo.punch(0.05);
    for (let i = 0; i < spent; i++) solo.update(fine);
    const soloRemainingFrames = framesUntilFullSpeed(solo, fine);

    const stacked = makeHitstop();
    stacked.punch(0.05);
    for (let i = 0; i < spent; i++) stacked.update(fine);
    stacked.punch(0.02); // a SMALLER hit lands mid-freeze
    const stackedRemainingFrames = framesUntilFullSpeed(stacked, fine);

    assert.ok(
      stackedRemainingFrames > soloRemainingFrames,
      `a smaller second punch shortened the freeze (${stackedRemainingFrames} frames left vs ${soloRemainingFrames} with no second punch) — it restarted instead of extending`,
    );

    // And it re-freezes rather than continuing to ease out.
    const re = makeHitstop();
    re.punch(0.05);
    re.update(DT);
    re.update(DT);
    const easing = re.update(DT);
    re.punch(0.02);
    assert.ok(re.update(DT) < easing, 'a fresh hit mid-freeze must stop the frame again');
  });

  test('accumulation is capped — a busy frame does not hang the view', () => {
    const h = makeHitstop();
    for (let i = 0; i < 50; i++) h.punch(FEEL_DEFAULTS.hitstopImpact);
    const frames = framesUntilFullSpeed(h);
    const maxFrames = Math.ceil(FEEL_DEFAULTS.hitstopMax / DT) + 2;
    assert.ok(frames <= maxFrames, `50 impacts froze for ${frames} frames (cap ~${maxFrames})`);
  });
});

describe('traumaFor', () => {
  const heartHit: WorldEvent = { kind: 'heartHit', at: ORIGIN };
  const critterDied: WorldEvent = { kind: 'critterDied', at: ORIGIN, by: 'tower' };

  test('a heart hit outweighs a critter death by a wide margin', () => {
    const heart = traumaFor(heartHit, 1);
    const critter = traumaFor(critterDied, 1);
    assert.ok(heart > critter, `heart ${heart} <= critter ${critter}`);
    assert.ok(heart > critter * 3, 'the gap is too small to read as a different kind of event');
  });

  test('a heart hit hurts more as the heart empties — the danger state', () => {
    const full = traumaFor(heartHit, 1);
    const half = traumaFor(heartHit, 0.5);
    const last = traumaFor(heartHit, 0.05);
    assert.ok(half > full, `half-health hit ${half} not stronger than full ${full}`);
    assert.ok(last > half, `near-death hit ${last} not stronger than half ${half}`);
  });

  test('impact trauma scales with damage and is capped', () => {
    const at = (damage: number): WorldEvent => ({ kind: 'impact', at: ORIGIN, damage, source: 'tower' });
    const small = traumaFor(at(1), 1);
    const ref = traumaFor(at(FEEL_DEFAULTS.impactRefDamage), 1);
    const sniper = traumaFor(at(11.2), 1);
    const absurd = traumaFor(at(1e6), 1);
    assert.ok(small < ref, 'a chip hit must be worth less than a reference hit');
    assert.ok(sniper > ref, 'a sniper hit must be worth more than a reference hit');
    assert.equal(absurd, FEEL_DEFAULTS.traumaImpactMax, 'impact trauma is not capped');
  });

  test('tower fire is silent, tank fire kicks', () => {
    const tower: WorldEvent = { kind: 'shotFired', at: ORIGIN, dir: ORIGIN, source: 'tower' };
    const tank: WorldEvent = { kind: 'shotFired', at: ORIGIN, dir: ORIGIN, source: 'tank' };
    assert.equal(traumaFor(tower, 1), 0, 'constant tower fire must not hum the camera');
    assert.ok(traumaFor(tank, 1) > 0, 'the player gun should recoil');
  });

  test('every event kind stays inside the rig trauma range [0,1]', () => {
    const all: WorldEvent[] = [
      { kind: 'shotFired', at: ORIGIN, dir: ORIGIN, source: 'tower' },
      { kind: 'shotFired', at: ORIGIN, dir: ORIGIN, source: 'tank' },
      { kind: 'beam', from: ORIGIN, to: ORIGIN },
      { kind: 'impact', at: ORIGIN, damage: 500, source: 'tank' },
      { kind: 'critterDied', at: ORIGIN, by: 'tank' },
      { kind: 'heartHit', at: ORIGIN },
      { kind: 'tankHit', at: ORIGIN },
    ];
    for (const frac of [1, 0.5, 0, -1, 2]) {
      for (const e of all) {
        const t = traumaFor(e, frac);
        assert.ok(t >= 0 && t <= 1, `${e.kind} at frac ${frac} gave ${t}`);
      }
    }
  });
});

describe('dangerLevel', () => {
  test('cold reads land in the obvious buckets', () => {
    assert.equal(dangerLevel(1), 0);
    assert.equal(dangerLevel(0.8), 0);
    assert.equal(dangerLevel(0.5), 1);
    assert.equal(dangerLevel(0.2), 2);
    assert.equal(dangerLevel(0), 2);
  });

  test('escalates the instant a threshold is earned', () => {
    let d = dangerLevel(0.9);
    d = dangerLevel(FEEL_DEFAULTS.dangerThreatened, d);
    assert.equal(d, 1, 'threatened must arrive without a hysteresis delay');
    d = dangerLevel(FEEL_DEFAULTS.dangerCritical, d);
    assert.equal(d, 2, 'critical must arrive without a hysteresis delay');
  });

  // THE IMPORTANT ONE. A value parked on a threshold and jittering — which is
  // exactly what a smoothed heartFrac does, and what 12/20 does to float
  // comparison — must not toggle the state every frame.
  test('does not flicker when heartFrac oscillates around a threshold', () => {
    for (const threshold of [FEEL_DEFAULTS.dangerThreatened, FEEL_DEFAULTS.dangerCritical]) {
      let d: DangerLevel = dangerLevel(threshold - 1e-4);
      const settled = d;
      const seen = new Set<DangerLevel>([d]);
      for (let i = 0; i < 200; i++) {
        const jitter = (i % 2 === 0 ? 1 : -1) * 0.004;
        d = dangerLevel(threshold + jitter, d);
        seen.add(d);
      }
      assert.equal(
        seen.size,
        1,
        `level flickered around ${threshold}: saw ${[...seen].join(',')} (settled at ${settled})`,
      );
      assert.equal(d, settled);
    }
  });

  test('relaxing requires climbing clear of the threshold, not just touching it', () => {
    const F = FEEL_DEFAULTS;
    let d: DangerLevel = dangerLevel(0.2); // critical
    assert.equal(d, 2);
    d = dangerLevel(F.dangerCritical + 0.01, d);
    assert.equal(d, 2, 'a hair above the threshold must not clear critical');
    // One heart HP step (1/20) must not be enough either: dread earns out slowly.
    d = dangerLevel(F.dangerCritical + 0.05, d);
    assert.equal(d, 2, 'a single point of heart should not switch the danger state off');
    d = dangerLevel(F.dangerCritical + F.dangerHysteresis + 0.01, d);
    assert.equal(d, 1, 'clearing the hysteresis band must actually relax the level');
    d = dangerLevel(F.dangerThreatened + F.dangerHysteresis + 0.01, d);
    assert.equal(d, 0);
  });

  test('a monotone drain visits every level exactly once, in order', () => {
    let d: DangerLevel = 0;
    const transitions: DangerLevel[] = [];
    for (let hp = 20; hp >= 0; hp--) {
      const next = dangerLevel(hp / 20, d);
      if (next !== d) transitions.push(next);
      d = next;
    }
    assert.deepEqual(transitions, [1, 2]);
  });
});
