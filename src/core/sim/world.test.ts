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

test('god mode prevents heart death but still counts leaks (I6 fix)', () => {
  // I6: leak = critter reached heart (always); heartHit = damage applied (skipped in god mode)
  // This test formerly asserted heartHits > 0 in god mode — that encoded the bug.
  // Now: leaks > 0 (critters arrived), heartHits === 0 (no damage applied).
  const t = makeTuning();
  t.set('god.heartInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
  const w = makeWorld({ seed: 2, tuning: t });
  const hp0 = w.heartHp;
  scripted(w, 8000);
  assert.ok(w.telemetry.data.leaks > 0, 'nothing ever reached the heart');
  assert.equal(w.telemetry.data.heartHits, 0, 'heartHit must not fire in god mode — damage was not applied');
  assert.equal(w.heartHp, hp0, 'heart lost hp despite god mode');
});

test('placeTower rejects blocked cells and counts decisions', () => {
  const w = makeWorld({ seed: 3, tuning: makeTuning() });
  const blocked = w.dungeon.tags.findIndex((x) => x === BLOCKED);
  assert.equal(w.placeTower(blocked), false);
  const open = w.dungeon.heart;
  assert.equal(w.placeTower(open), true);
  assert.equal(w.telemetry.data.decisionsThisPhase, 1, 'a rejected placement must not count');
  assert.equal(w.telemetry.data.decisionsTotal, 1, 'decisionsTotal must match successful placements');
});

test('I10: placeTower enforces one tower per cell (occupancy)', () => {
  const w = makeWorld({ seed: 3, tuning: makeTuning() });
  const open = w.dungeon.heart;
  assert.equal(w.placeTower(open), true, 'first tower should succeed');
  assert.equal(w.placeTower(open), false, 'second tower on same cell must be rejected');
  assert.equal(w.telemetry.data.decisionsTotal, 1, 'only one successful placement = one decision');
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

// Guard for NEW-3 — contact latch (TANK_CONTACT_COOLDOWN).
// Before the latch, tankHits was a per-tick sample: a critter with low damage survives
// many ticks inside the radius and each tick counted as a hit, so lower tank.damage
// inflated tankHits (backwards relationship). After the latch, tankHits is an event
// count (one per cooldown window per critter); the hit count should not inflate when
// damage decreases.
//
// Sabotage: comment out `if (c.contactLeft > 0) continue;` and the
// `c.contactLeft = TANK_CONTACT_COOLDOWN;` line in world.ts step 7d.
// Without the latch, hits_lo will be ≫ hits_hi (the backwards relationship returns)
// and the ratio assertion fails.
test('C4 latch — tankHits is an event count, not inflated by low damage (NEW-3 guard)', () => {
  const run = (damage: number) => {
    const t = makeTuning();
    // chip damage (damage=0.5 < enemy.hp=10): critter survives many ticks per contact
    // lethal damage (damage=20 > enemy.hp=10): critter dies on first contact
    t.set('tank.damage', damage);
    t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
    const w = makeWorld({ seed: 3, tuning: t });
    for (let i = 0; i < 3000; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
    return w.telemetry.data.tankHits;
  };
  const hitsLo = run(0.5);   // chip damage
  const hitsHi = run(20);    // lethal damage
  // With the latch both values are event-based: the hit counts should be nearly equal
  // (bounded by how many critters walk through, not by how long each critter survives).
  // Measured with latch intact (seed 3, 3000 ticks): hitsLo≈43, hitsHi≈44 (ratio ~1).
  // Without the latch: hitsLo≈189, hitsHi≈44 (ratio ~4.3) — the backwards inflation.
  // A threshold of 2 safely separates the fixed (~1×) from the broken (~4×) ratio.
  assert.ok(hitsLo > 0, 'expected tank contacts from pass-through critters (seed 3)');
  assert.ok(hitsHi > 0, 'expected tank contacts from pass-through critters (seed 3)');
  assert.ok(
    hitsLo < hitsHi * 2,
    `tankHits backwards: hitsLo=${hitsLo} >= 2×hitsHi=${hitsHi} — latch removed or broken (pre-latch ratio was ~4.3×)`,
  );
});

// Guard for NEW-2 — swept-radius floor.
// At tank.speed=10 the per-tick step is ~0.167, which is 6× the static tankContactRadius
// (~0.027). Without the floor (bare tankContactRadius), a fast tank tunnels through
// nearly stationary critters on certain seeds and registers 0 contacts.
//
// Scenario: tank.speed=10, enemy.speed=0.01 (critters nearly stationary), seed 1.
// Measured: floor intact → 40 contacts; floor removed → 0 contacts (100% tunneling).
// r = Math.max(~0.027, 0.5×10×0.0167) = max(0.027, 0.083) = 0.083 covers the step.
//
// Sabotage: replace `Math.max(tankContactRadius, 0.5 * tuning.get('tank.speed') * dt)`
// with bare `tankContactRadius` in world.ts step 7d.
// Without the floor, tankHits stays 0 on seed 1 at speed=10 and this assertion fails.
test('C4 swept-radius floor — fast moving tank still registers contacts (NEW-2 guard)', () => {
  const t = makeTuning();
  // speed=10 (max): per-tick step 6× the static radius — triggers tunneling without floor.
  // enemy.speed=0.01 (near-stationary critters): removes relative motion that could
  // accidentally produce contacts even without the floor on other seeds.
  t.set('tank.speed', 10);
  t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 0.01);
  t.set('tank.damage', 20);
  const w = makeWorld({ seed: 1, tuning: t });
  // Drive forward continuously — tank sweeps through the critter population
  for (let i = 0; i < 3000; i++) w.tick(1 / 60, { forward: 1, turn: 0, fire: false });
  assert.ok(
    w.telemetry.data.tankHits > 0,
    `moving tank at speed=10 registered 0 contacts — swept-radius floor removed or broken (bare static radius tunnels at this speed; floor removed: 0 contacts vs 40 with floor)`,
  );
});

// NEW-A: heart death telemetry
test('NEW-A: heartDeathAt is stamped when heart reaches 0 HP', () => {
  // High enemy speed, small drip rate → fast heart death; run 100s.
  const t = makeTuning();
  t.set('enemy.speed', 2.0);
  t.set('wave.dripRate', 0.1);
  t.set('wave.size', 20);
  const w = makeWorld({ seed: 42, tuning: t });
  w.placeTower(w.dungeon.heart);
  scripted(w, 6000); // 100s
  const s = w.telemetry.summary();
  // survivedFor must always be <= elapsed + epsilon
  assert.ok((s['survivedFor'] ?? 0) <= (s['elapsed'] ?? 0) + 1e-6);
  // survived must be 0 or 1
  assert.ok(s['survived'] === 0 || s['survived'] === 1);
  // If it died, heartDeathAt must be positive and heartDied must be true
  if (s['survived'] === 0) {
    assert.ok((s['heartDeathAt'] ?? 0) > 0, 'heartDeathAt should be > 0 when survived=0');
    assert.equal(w.heartDied, true, 'world.heartDied must be true');
  }
});
