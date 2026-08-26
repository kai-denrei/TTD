import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateSphereMesh } from '../sphere/grid.ts';
import { generateDungeon, BLOCKED } from '../sphere/dungeon.ts';
import { makeTuning } from '../tuning/store.ts';
import { stream } from './rng.ts';
import { spawnCritter, stepCritter, effectiveSpeed, hitCritter } from './critters.ts';

const MESH = generateSphereMesh({ seed: 7, points: 600, relaxIters: 40 });
const D = generateDungeon(MESH, { seed: 7, rooms: 12, roomRadius: 4,
  extraCorridors: 6, corridorWidth: 1 });

test('speed envelope stays within [1-amp, 1+amp]', () => {
  const t = makeTuning(); t.set('enemy.surgeAmp', 0.5);
  const c = spawnCritter(0, D.spawn, t, stream(1, 'x'), 0);
  for (let i = 0; i < 3000; i++) {
    stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng: stream(1, 'x') , now: 0 });
    assert.ok(c.envValue >= 0.5 - 1e-6 && c.envValue <= 1.5 + 1e-6, `envelope escaped: ${c.envValue}`);
  }
});

test('zero amplitude means constant speed', () => {
  const t = makeTuning(); t.set('enemy.surgeAmp', 0);
  const c = spawnCritter(0, D.spawn, t, stream(1, 'x'), 0);
  for (let i = 0; i < 200; i++) stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng: stream(1, 'x') , now: 0 });
  assert.ok(Math.abs(c.envValue - 1) < 1e-6);
});

test('the envelope actually varies when amplitude is high', () => {
  const t = makeTuning(); t.set('enemy.surgeAmp', 0.6); t.set('enemy.surgeCadence', 0.3);
  const rng = stream(2, 'env');
  const c = spawnCritter(0, D.spawn, t, rng, 0);
  const seen = new Set<string>();
  for (let i = 0; i < 600; i++) {
    stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng, now: 0 });
    seen.add(c.envValue.toFixed(2));
  }
  assert.ok(seen.size > 5, 'envelope is not varying');
});

test('enemy.speed is read live — changing it mid-flight changes pace', () => {
  const t = makeTuning();
  t.set('enemy.surgeAmp', 0);
  const c = spawnCritter(0, D.spawn, t, stream(3, 'x'), 0);
  t.set('enemy.speed', 1.0);
  const slow = effectiveSpeed(c, t);
  t.set('enemy.speed', 2.0);
  const fast = effectiveSpeed(c, t);
  assert.ok(Math.abs(fast - slow * 2) < 1e-9, 'lever was captured, not read live');
});

test('accelOnHit applies for reactionDur then expires', () => {
  const t = makeTuning();
  t.set('enemy.surgeAmp', 0); t.set('enemy.accelOnHit', 2); t.set('enemy.reactionDur', 1); t.set('enemy.hp', 10);
  const c = spawnCritter(0, D.spawn, t, stream(4, 'x'), 0);
  hitCritter(c, 1, t);
  assert.equal(c.reactMult, 2);
  for (let i = 0; i < 40; i++) stepCritter(c, 0.05, { mesh: MESH, dungeon: D, tuning: t, rng: stream(4, 'x') , now: 0 });
  assert.equal(c.reactMult, 1, 'reaction never expired');
});

test('a critter walks downhill to the heart and arrives', () => {
  const t = makeTuning(); t.set('enemy.speed', 3); t.set('enemy.surgeAmp', 0);
  const rng = stream(5, 'walk');
  const c = spawnCritter(0, D.spawn, t, rng, 0);
  let result: string = 'moving';
  for (let i = 0; i < 20000 && result === 'moving'; i++) {
    result = stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng, now: 0 });
  }
  assert.equal(result, 'arrived', 'critter never reached the heart');
});

test('a critter never enters a blocked cell', () => {
  const t = makeTuning(); t.set('enemy.speed', 3);
  const rng = stream(6, 'walk');
  const c = spawnCritter(0, D.spawn, t, rng, 0);
  for (let i = 0; i < 5000; i++) {
    if (stepCritter(c, 0.016, { mesh: MESH, dungeon: D, tuning: t, rng, now: 0 }) === 'arrived') break;
    assert.notEqual(D.tags[c.cur], BLOCKED, 'walked into a wall');
  }
});

test('hitCritter returns true exactly when hp runs out', () => {
  const t = makeTuning(); t.set('enemy.hp', 3);
  const c = spawnCritter(0, D.spawn, t, stream(7, 'x'), 0);
  assert.equal(hitCritter(c, 1, t), false);
  assert.equal(hitCritter(c, 1, t), false);
  assert.equal(hitCritter(c, 1, t), true);
  assert.equal(c.alive, false);
});
