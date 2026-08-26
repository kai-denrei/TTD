import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeProjectile, stepProjectiles } from './projectiles.ts';
import type { Projectile } from './projectiles.ts';
import { makeTuning } from '../tuning/store.ts';
import type { Critter } from './critters.ts';

function critterAt(id: number, pos: readonly [number, number, number], alive = true): Critter {
  return {
    id, type: 'phage', alive, hp: 5, cur: 0, next: 0, prog: 0, pos,
    envValue: 1, envTarget: 1, envLeft: 1, reactMult: 1, reactLeft: 0,
    contactLeft: 0, slowFactor: 1, slowLeft: 0, bornAt: 0, firstHitAt: null, hpMax: 5, lastHitAt: -Infinity,
  };
}

/** A shot at the +Z pole heading toward +X along the surface. */
function shot(over: Partial<Projectile> = {}): Projectile {
  return {
    ...makeProjectile(1, {
      pos: [0, 0, 1], dir: [1, 0, 0], speed: 1, damage: 3,
      range: 0.5, source: 'tower', homingId: null,
    }),
    ...over,
  };
}

describe('projectile travel', () => {
  test('advances by speed * dt along the surface', () => {
    const ps = [shot()];
    stepProjectiles(ps, [], 0.1, makeTuning());
    assert.ok(Math.abs(ps[0]!.travelled - 0.1) < 1e-6, `travelled ${ps[0]!.travelled}`);
    assert.ok(ps[0]!.pos[0] > 0.09, 'did not move toward +X');
    assert.ok(Math.abs(Math.hypot(...ps[0]!.pos) - 1) < 1e-9, 'left the unit sphere');
  });

  test('damage lands on IMPACT, not at spawn', () => {
    // The target sits well beyond one step, so a hit on the first step would
    // mean damage is being resolved at fire time — the very thing projectiles
    // exist to stop.
    const far = critterAt(7, [Math.sin(0.3), 0, Math.cos(0.3)]);
    const ps = [shot()];
    const first = stepProjectiles(ps, [far], 1 / 60, makeTuning());
    assert.equal(first.hits.length, 0, 'damage resolved on the spawn tick');

    let hits = 0;
    for (let i = 0; i < 120 && hits === 0; i++) {
      hits = stepProjectiles(ps, [far], 1 / 60, makeTuning()).hits.length;
    }
    assert.equal(hits, 1, 'the shot never reached a target directly in its path');
  });

  test('a shot that outruns its range expires unhit', () => {
    const ps = [shot({ range: 0.2 })];
    let expired: number[] = [];
    for (let i = 0; i < 100 && expired.length === 0; i++) {
      expired = stepProjectiles(ps, [], 1 / 60, makeTuning()).expired;
    }
    assert.deepEqual(expired, [1], 'shot never expired despite exceeding its range');
  });

  test('a homing shot whose target dies keeps its last heading', () => {
    const dead = critterAt(7, [Math.sin(0.3), 0, Math.cos(0.3)], false);
    const ps = [shot({ homingId: 7 })];
    const before = ps[0]!.dir;
    stepProjectiles(ps, [dead], 1 / 60, makeTuning());
    assert.ok(Number.isFinite(ps[0]!.pos[0]), 'homing on a dead target produced NaN');
    assert.ok(ps[0]!.dir[0] > 0.9, `heading changed to ${JSON.stringify(ps[0]!.dir)} chasing a corpse`);
    assert.ok(Number.isFinite(before[0]));
  });

  test('a homing shot steers toward a living target', () => {
    const off = critterAt(7, [Math.sin(0.25), Math.sin(0.25), Math.cos(0.3)]);
    const ps = [shot({ homingId: 7 })];
    for (let i = 0; i < 10; i++) stepProjectiles(ps, [off], 1 / 60, makeTuning());
    assert.ok(ps[0]!.dir[1] > 0.01, 'homing never steered toward an off-axis target');
  });

  test('is deterministic — identical inputs, identical paths', () => {
    const a = [shot()];
    const b = [shot()];
    for (let i = 0; i < 30; i++) {
      stepProjectiles(a, [], 1 / 60, makeTuning());
      stepProjectiles(b, [], 1 / 60, makeTuning());
    }
    assert.deepEqual(a[0]!.pos, b[0]!.pos);
  });
});

describe('projectile collision is swept', () => {
  test('a fast shot does not tunnel through a critter in its path', () => {
    // At tower.projSpeed 4.0 a shot advances 0.067 per tick against a 0.02 hit
    // radius. A point test alone would pass straight through and the lever
    // would silently become "how reliably do I miss".
    const target = critterAt(7, [Math.sin(0.25), 0, Math.cos(0.25)]);
    const ps = [shot({ speed: 4, range: 1, homingId: null })];
    let hits = 0;
    for (let i = 0; i < 60 && hits === 0; i++) {
      hits = stepProjectiles(ps, [target], 1 / 60, makeTuning()).hits.length;
    }
    assert.equal(hits, 1, 'a fast shot tunnelled through its target');
  });
});
