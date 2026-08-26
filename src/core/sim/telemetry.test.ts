// telemetry.test.ts — exact-count assertions over scripted runs.
// Telemetry that is even slightly wrong makes every tuning comparison a lie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTelemetry } from './telemetry.ts';

test('counters are exact over a scripted run', () => {
  const t = makeTelemetry();
  // heartHit = damage applied; leak = critter reached heart (these are now distinct)
  t.heartHit(); t.heartHit(); t.tankHit(); t.leak();
  // kill(by, lifespan, ttk): lifespan = age at death, ttk = first-hit-to-death
  // (0 for one-shots — firstHitAt is stamped before damage, so elapsed - firstHitAt = 0 on kill).
  t.kill('tower', 2, 1.5); t.kill('player', 4, 0); t.kill('player', 6, 2.0);
  assert.equal(t.data.heartHits, 2);
  assert.equal(t.data.tankHits, 1);
  assert.equal(t.data.leaks, 1);
  assert.equal(t.data.kills, 3);
  assert.equal(t.data.killsByTower, 1);
  assert.equal(t.data.killsByPlayer, 2);
  // lifespan and ttk arrays both have all 3 kills (ttk is always a plain number now)
  assert.equal(t.data.lifespan.length, 3);
  assert.equal(t.data.ttk.length, 3);
});

test('macro/tactical time splits by mode', () => {
  const t = makeTelemetry();
  for (let i = 0; i < 10; i++) t.tick(0.1, { macro: true, enemiesAlive: 0, tankActing: false });
  for (let i = 0; i < 30; i++) t.tick(0.1, { macro: false, enemiesAlive: 2, tankActing: true });
  assert.ok(Math.abs(t.data.timeMacro - 1) < 1e-6);
  assert.ok(Math.abs(t.data.timeTactical - 3) < 1e-6);
});

test('mode switches counted on transitions only', () => {
  const t = makeTelemetry();
  const seq = [true, true, false, false, true];
  for (const macro of seq) t.tick(0.1, { macro, enemiesAlive: 0, tankActing: false });
  assert.equal(t.data.modeSwitches, 2);
});

test('tank idle-under-threat only accrues with enemies alive and tank idle', () => {
  const t = makeTelemetry();
  t.tick(1, { macro: false, enemiesAlive: 0, tankActing: false });  // no threat
  t.tick(1, { macro: false, enemiesAlive: 3, tankActing: true });   // acting
  t.tick(1, { macro: false, enemiesAlive: 3, tankActing: false });  // counts
  assert.ok(Math.abs(t.data.tankIdleUnderThreat - 1) < 1e-6);
});

test('peak concurrency is a high-water mark', () => {
  const t = makeTelemetry();
  for (const n of [1, 5, 3, 9, 2]) t.tick(0.1, { macro: false, enemiesAlive: n, tankActing: false });
  assert.equal(t.data.peakConcurrent, 9);
});

test('summary derives the balance ratios', () => {
  const t = makeTelemetry();
  for (let i = 0; i < 10; i++) t.tick(0.1, { macro: true, enemiesAlive: 0, tankActing: false });
  for (let i = 0; i < 10; i++) t.tick(0.1, { macro: false, enemiesAlive: 0, tankActing: false });
  t.kill('tower', 1, 0.5); t.kill('player', 1, 0); t.kill('player', 1, 0.3);
  const s = t.summary();
  assert.ok(Math.abs(s['macroShare']! - 0.5) < 1e-6);
  assert.ok(Math.abs(s['playerKillShare']! - 2 / 3) < 1e-6);
});

test('reset clears everything', () => {
  const t = makeTelemetry();
  t.heartHit(); t.tick(1, { macro: true, enemiesAlive: 1, tankActing: false });
  t.reset();
  assert.equal(t.data.heartHits, 0);
  assert.equal(t.data.elapsed, 0);
});

// NEW-A: heart death telemetry
test('heartDeathAt is set exactly once when heart dies', () => {
  const t = makeTelemetry();
  assert.equal(t.data.heartDeathAt, null);
  t.recordHeartDeath(15.5);
  assert.equal(t.data.heartDeathAt, 15.5);
  // second call is a no-op
  t.recordHeartDeath(20.0);
  assert.equal(t.data.heartDeathAt, 15.5, 'second call must not overwrite');
  const s = t.summary();
  assert.equal(s['survived'], 0);
  assert.ok(Math.abs(s['survivedFor']! - 15.5) < 1e-9);
});

test('heartDeathAt is null and survived=1 when heart never dies', () => {
  const t = makeTelemetry();
  t.tick(5, { macro: false, enemiesAlive: 0, tankActing: false });
  const s = t.summary();
  assert.equal(s['survived'], 1);
  assert.ok(Math.abs(s['survivedFor']! - 5) < 1e-9);
});

test('reset clears heartDeathAt', () => {
  const t = makeTelemetry();
  t.recordHeartDeath(10);
  t.reset();
  assert.equal(t.data.heartDeathAt, null);
});

// I5: decisionsThisPhase vs decisionsTotal
test('decisionsTotal tracks lifetime across phase resets', () => {
  const t = makeTelemetry();
  t.decision(); t.decision();
  assert.equal(t.data.decisionsThisPhase, 2);
  assert.equal(t.data.decisionsTotal, 2);
  t.resetPhaseCounters();
  assert.equal(t.data.decisionsThisPhase, 0, 'phase counter reset');
  assert.equal(t.data.decisionsTotal, 2, 'lifetime total unchanged');
  t.decision();
  assert.equal(t.data.decisionsThisPhase, 1);
  assert.equal(t.data.decisionsTotal, 3);
});
