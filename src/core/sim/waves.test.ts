import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTuning } from '../tuning/store.ts';
import { stream } from './rng.ts';
import { planWave, makeWaveEngine } from './waves.ts';

describe('waves', () => {
  test('plan count follows wave.size and sizeGrowth', () => {
    const t = makeTuning(); t.set('wave.size', 10); t.set('wave.sizeGrowth', 1);
    assert.equal(planWave(1, t, stream(1, 'w'), [0, 1]).count, 10);
    assert.equal(planWave(3, t, stream(1, 'w'), [0, 1]).count, 12);
  });

  test('drip spreads spawns over time and is ordered', () => {
    const t = makeTuning(); t.set('wave.size', 8); t.set('wave.dripRate', 0.5); t.set('wave.dripJitter', 0);
    const p = planWave(1, t, stream(1, 'w'), [0, 1]);
    assert.equal(p.events.length, 8);
    const times = p.events.map((e) => e.at);
    assert.deepEqual(times, [...times].sort((a, b) => a - b), 'events out of order');
    assert.ok(Math.abs(times[7]! - 3.5) < 1e-6, `last spawn at ${times[7]}, expected 3.5`);
  });

  test('dripRate 0.1 vs 2.0 is the difference between a burst and a trickle', () => {
    const t = makeTuning(); t.set('wave.size', 10); t.set('wave.dripJitter', 0);
    t.set('wave.dripRate', 0.1);
    const burst = planWave(1, t, stream(1, 'w'), [0]);
    t.set('wave.dripRate', 2.0);
    const trickle = planWave(1, t, stream(1, 'w'), [0]);
    assert.ok(trickle.events[9]!.at > burst.events[9]!.at * 10);
  });

  test('jitter perturbs but keeps order and non-negativity', () => {
    const t = makeTuning(); t.set('wave.size', 20); t.set('wave.dripRate', 0.5); t.set('wave.dripJitter', 0.9);
    const p = planWave(1, t, stream(9, 'w'), [0]);
    const times = p.events.map((e) => e.at);
    assert.ok(times.every((x) => x >= 0));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
  });

  test('spawns round-robin across gates', () => {
    const t = makeTuning(); t.set('wave.size', 6);
    const p = planWave(1, t, stream(1, 'w'), [10, 20]);
    assert.deepEqual(p.events.map((e) => e.gate), [10, 20, 10, 20, 10, 20]);
  });

  test('hp follows hpGrowth compounding per wave', () => {
    const t = makeTuning(); t.set('enemy.hp', 10); t.set('wave.hpGrowth', 1.1);
    assert.ok(Math.abs(planWave(1, t, stream(1, 'w'), [0]).hp - 10) < 1e-9);
    assert.ok(Math.abs(planWave(3, t, stream(1, 'w'), [0]).hp - 12.1) < 1e-6);
  });

  test('overlap 0 waits for a clear before the next wave', () => {
    const t = makeTuning();
    t.set('wave.size', 3); t.set('wave.dripRate', 0.1); t.set('wave.overlap', 0); t.set('wave.gap', 2);
    const e = makeWaveEngine(t, stream(1, 'w'), [0]);
    let spawned = 0;
    for (let i = 0; i < 100; i++) e.tick(0.1, { enemiesAlive: 3, onSpawn: () => spawned++ });
    assert.equal(e.wave, 1, 'started wave 2 while the field was full');
  });

  test('overlap 1 does not wait for a clear', () => {
    const t = makeTuning();
    t.set('wave.size', 3); t.set('wave.dripRate', 0.1); t.set('wave.overlap', 1); t.set('wave.gap', 0);
    const e = makeWaveEngine(t, stream(1, 'w'), [0]);
    for (let i = 0; i < 200; i++) e.tick(0.1, { enemiesAlive: 99, onSpawn: () => {} });
    assert.ok(e.wave > 1, 'never advanced despite overlap=1');
  });

  test('overlap 0.25 waits longer than overlap 0.75', () => {
    // With same conditions, higher overlap = more waves completed
    const run = (ov: number) => {
      const t = makeTuning();
      t.set('wave.size', 10); t.set('wave.dripRate', 0.1); t.set('wave.overlap', ov); t.set('wave.gap', 0);
      const e = makeWaveEngine(t, stream(1, 'w'), [0]);
      for (let i = 0; i < 2000; i++) e.tick(0.1, { enemiesAlive: 5, onSpawn: () => {} });
      return e.wave;
    };
    assert.ok(run(0.75) > run(0.25), 'overlap=0.75 should complete more waves than overlap=0.25');
  });

  test('the engine emits exactly count spawns per wave', () => {
    const t = makeTuning();
    t.set('wave.size', 7); t.set('wave.dripRate', 0.2); t.set('wave.overlap', 0); t.set('wave.gap', 1);
    const e = makeWaveEngine(t, stream(1, 'w'), [0]);
    let spawned = 0;
    for (let i = 0; i < 100; i++) e.tick(0.05, { enemiesAlive: 1, onSpawn: () => spawned++ });
    assert.equal(spawned, 7);
  });
});
