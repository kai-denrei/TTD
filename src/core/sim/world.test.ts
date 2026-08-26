import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTuning } from '../tuning/store.ts';
import { BLOCKED } from '../sphere/dungeon.ts';
import { makeWorld } from './world.ts';
import type { World } from './world.ts';

const scripted = (w: World, steps: number) => {
  for (let i = 0; i < steps; i++) {
    w.tick(1 / 60, { forward: (i % 120) < 60 ? 1 : -1, turn: Math.sin(i / 30), fire: i % 45 === 0 });
  }
};

test('REPLAY DETERMINISM: same seed + preset + input => identical telemetry', () => {
  const mk = () => {
    const t = makeTuning(); t.import('enemy.speed=1.4;wave.size=8;wave.dripRate=0.4');
    const w = makeWorld({ seed: 42, tuning: t });
    w.placeTower(w.dungeon.heart);
    return w;
  };
  const a = mk(); const b = mk();
  scripted(a, 4000); scripted(b, 4000);
  assert.deepEqual(a.telemetry.summary(), b.telemetry.summary());
  assert.equal(a.critters.length, b.critters.length);
  assert.equal(a.heartHp, b.heartHp);
});

test('towers kill critters and it is attributed to the tower', () => {
  const t = makeTuning();
  t.set('tower.damage', 100); t.set('tower.range', 0.5); t.set('tower.rate', 10); t.set('enemy.speed', 2);
  const w = makeWorld({ seed: 1, tuning: t });
  w.placeTower(w.dungeon.spawn);
  scripted(w, 3000);
  assert.ok(w.telemetry.data.killsByTower > 0, 'tower never killed anything');
});

test('god mode prevents heart death but still counts hits', () => {
  const t = makeTuning();
  t.set('god.heartInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
  const w = makeWorld({ seed: 2, tuning: t });
  const hp0 = w.heartHp;
  scripted(w, 8000);
  assert.ok(w.telemetry.data.heartHits > 0, 'nothing ever reached the heart');
  assert.equal(w.heartHp, hp0, 'heart lost hp despite god mode');
});

test('placeTower rejects blocked cells and counts decisions', () => {
  const w = makeWorld({ seed: 3, tuning: makeTuning() });
  const blocked = w.dungeon.tags.findIndex((x) => x === BLOCKED);
  assert.equal(w.placeTower(blocked), false);
  const open = w.dungeon.heart;
  assert.equal(w.placeTower(open), true);
  assert.equal(w.telemetry.data.decisionsThisPhase, 1, 'a rejected placement must not count');
});

test('macro mode routes time to the macro counter', () => {
  const w = makeWorld({ seed: 4, tuning: makeTuning() });
  w.setMacro(true);
  for (let i = 0; i < 60; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
  assert.ok(w.telemetry.data.timeMacro > 0.9);
  assert.equal(w.telemetry.data.timeTactical, 0);
});

test('time.scale multiplies the step', () => {
  const t = makeTuning(); t.set('time.scale', 2);
  const w = makeWorld({ seed: 5, tuning: t });
  w.tick(1, { forward: 0, turn: 0, fire: false });
  assert.ok(Math.abs(w.elapsed - 2) < 1e-9);
});

test('a headless run produces a non-degenerate session', () => {
  const t = makeTuning(); t.set('enemy.speed', 1.5);
  const w = makeWorld({ seed: 6, tuning: t });
  w.placeTower(w.dungeon.heart);
  scripted(w, 6000);
  const s = w.telemetry.summary();
  assert.ok((s['elapsed'] ?? 0) > 90, 'sim did not advance');
  assert.ok(w.telemetry.data.kills > 0, 'nothing died in 100 seconds');
});

// C4 contact-ram coverage — seed 3 is a "pass-through" seed: some gates have
// distToHeart > distToHeart[spawn], so critters walk through the tank's start cell.
// Tank is stationary (forward=0), no tower, fire=false — only the contact path fires.
// Values measured after NEW-2 (radius floor) and NEW-3 (contact latch) landed.
test('C4 ram — low damage chips but does not kill (seed 3, damage=0.5)', () => {
  const t = makeTuning();
  t.set('tank.damage', 0.5);   // below enemy.hp (default 10) → contacts chip, nothing dies
  t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
  const w = makeWorld({ seed: 3, tuning: t });
  // No tower; tank stays at spawn (stationary)
  for (let i = 0; i < 3000; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
  assert.ok(w.telemetry.data.tankHits > 0,
    'expected ram contacts from pass-through critters (seed 3), got 0 — contact path broken');
  assert.equal(w.telemetry.data.killsByPlayer, 0,
    'low damage should chip but not kill; a kill means damage applied every tick (latch broken)');
});

test('C4 ram — high damage kills on contact (seed 3, damage=20)', () => {
  const t = makeTuning();
  t.set('tank.damage', 20);    // above enemy.hp (default 10) → one-shot on contact
  t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
  const w = makeWorld({ seed: 3, tuning: t });
  for (let i = 0; i < 3000; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
  assert.ok(w.telemetry.data.tankHits > 0,
    'expected ram contacts from pass-through critters (seed 3), got 0 — contact path broken');
  assert.ok(w.telemetry.data.killsByPlayer > 0,
    'high damage should kill on contact; no kills means hitCritter path broken');
});
