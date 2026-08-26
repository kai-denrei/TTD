// telemetry.test.ts — exact-count assertions over scripted runs.
// Telemetry that is even slightly wrong makes every tuning comparison a lie.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTelemetry } from './telemetry.ts';

test('counters are exact over a scripted run', () => {
  const t = makeTelemetry();
  t.heartHit(); t.heartHit(); t.tankHit(); t.leak();
  t.kill('tower', 2); t.kill('player', 4); t.kill('player', 6);
  assert.equal(t.data.heartHits, 2);
  assert.equal(t.data.tankHits, 1);
  assert.equal(t.data.leaks, 1);
  assert.equal(t.data.kills, 3);
  assert.equal(t.data.killsByTower, 1);
  assert.equal(t.data.killsByPlayer, 2);
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
  t.kill('tower', 1); t.kill('player', 1); t.kill('player', 1);
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
