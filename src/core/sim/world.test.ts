import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTuning } from '../tuning/store.ts';
import { BLOCKED, nearestFrontierWall } from '../sphere/dungeon.ts';
import { makeWorld } from './world.ts';
import { patrolInput } from './runner.ts';
import type { World } from './world.ts';

// Shares the sweep's scripted session rather than keeping a third copy. It
// aims and holds fire, which matters here: with a 45-degree fire arc a tank
// that merely sweeps its heading hits nothing, and "a non-degenerate session"
// then measures a tank that never fought. Deterministic — patrolInput reads
// world state, it does not roll dice.
const scripted = (w: World, steps: number) => {
  for (let i = 0; i < steps; i++) w.tick(1 / 60, patrolInput(i, w));
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
  // Since M0c-3 the global tower.* levers are SCALARS over the roster, not
  // absolute stats — 0.5 range means HALF range, which is why this test used to
  // pass values that now mean the opposite of what they did.
  t.set('tower.damage', 8); t.set('tower.range', 3); t.set('tower.rate', 4); t.set('enemy.speed', 2);
  const w = makeWorld({ seed: 1, tuning: t });
  // Towers need high ground; the spawn cell itself is open floor.
  // Enough credit to actually buy the tower: placement now charges.
  t.set('eco.startCredit', 1000);
  w.placeTower(nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.spawn));
  scripted(w, 3000);
  assert.ok(w.telemetry.data.killsByTower > 0, 'tower never killed anything');
});

test('god mode prevents heart death but still counts leaks (I6 fix)', () => {
  // I6: leak = critter reached heart (always); heartHit = also always (spec §5: god hits count)
  // I-1: heartHit is now unconditional (matches tankHit symmetry); only HP mutation is skipped.
  const t = makeTuning();
  t.set('god.heartInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
  const w = makeWorld({ seed: 2, tuning: t });
  const hp0 = w.heartHp;
  scripted(w, 8000);
  assert.ok(w.telemetry.data.leaks > 0, 'nothing ever reached the heart');
  assert.ok(w.telemetry.data.heartHits > 0, 'heartHit must fire in god mode — spec §5: hits always counted');
  assert.equal(w.heartHp, hp0, 'heart lost hp despite god mode');
});

// Renamed and inverted in M0c-1: the rule is now high-ground-only, so a test
// named "rejects blocked cells" would assert the opposite of the design.
test('placeTower rejects open cells and counts only successful placements', () => {
  const w = makeWorld({ seed: 3, tuning: makeTuning() });
  assert.equal(w.placeTower(w.dungeon.heart), false, 'open floor is not high ground');
  const wall = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart);
  assert.equal(w.placeTower(wall), true);
  assert.equal(w.telemetry.data.decisionsThisPhase, 1, 'a rejected placement must not count');
  assert.equal(w.telemetry.data.decisionsTotal, 1, 'decisionsTotal must match successful placements');
});

test('I10: placeTower enforces one tower per cell (occupancy)', () => {
  const w = makeWorld({ seed: 3, tuning: makeTuning() });
  const cell = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart);
  assert.equal(w.placeTower(cell), true, 'first tower should succeed');
  assert.equal(w.placeTower(cell), false, 'second tower on same cell must be rejected');
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
  // Towers stand on HIGH GROUND. This line used to pass dungeon.heart, which
  // is open floor and has been refused since M0c-1 — the test kept passing only
  // because the tank was doing all the killing, and it went red the moment a
  // build phase gave the tank ten fewer seconds. Assert the placement instead
  // of assuming it.
  const placed = w.placeTower(nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart));
  assert.ok(placed, 'baseline tower was never placed');
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
  t.set('tank.damage', 0.5);   // below enemy.hp (default 5) → contacts chip, nothing dies
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
  t.set('tank.damage', 20);    // above enemy.hp (default 5) → one-shot on contact
  t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
  const w = makeWorld({ seed: 3, tuning: t });
  for (let i = 0; i < 3000; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
  assert.ok(w.telemetry.data.tankHits > 0,
    'expected ram contacts from pass-through critters (seed 3), got 0 — contact path broken');
  assert.ok(w.telemetry.data.killsByPlayer > 0,
    'high damage should kill on contact; no kills means hitCritter path broken');
  // MINOR 3: one-shot contract — ttk must be 0 for all contact kills when damage=20 (one-shot).
  // Contract: firstHitAt is stamped before damage is applied (critters.ts:252-255), so
  // elapsed - firstHitAt = 0 on the same tick as the kill. Assert at least one ttk entry
  // is exactly 0 and that every player-kill ttk in this run is 0.
  assert.ok(w.telemetry.data.ttk.length > 0, 'expected kills to have ttk entries');
  assert.ok(
    w.telemetry.data.ttk.every((v) => v === 0),
    `one-shot kills must all have ttk=0; got non-zero ttk: ${w.telemetry.data.ttk.filter((v) => v !== 0).join(', ')}`,
  );
});

// C-1 regression: parked tank contact radius must be speed-invariant.
// Before the fix, the swept-floor used tuning.get('tank.speed') * dt as the radius
// even when forward=0, so a high-speed parked tank got an inflated disc and accumulated
// contacts without moving. The fix measures actual displacement (always 0 when parked),
// so kill counts must be equal regardless of tank.speed setting.
// Seed 3 is the pass-through seed: critters walk through the spawn cell.
test('C-1: parked tank contacts are speed-invariant (forward=0 gets no swept radius)', () => {
  const run = (speed: number, dt: number) => {
    const t = makeTuning();
    t.set('tank.speed', speed);
    t.set('tank.damage', 20); // one-shot so kills are countable
    t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
    // This test is about contact radius, not wave timing: skip the build phase
    // so its pinned kill count measures the thing it claims to measure.
    t.set('wave.buildTime', 0);
    const w = makeWorld({ seed: 3, tuning: t });
    // Parked tank — forward=0 means no movement, no displacement, no swept radius
    const steps = Math.round(3000 * (1 / 60) / dt);
    for (let i = 0; i < steps; i++) w.tick(dt, { forward: 0, turn: 0, fire: false });
    return w.telemetry.data.killsByPlayer;
  };
  // Same dt, different speeds — must be equal
  const killsMinSpeed = run(0.5, 1 / 60);  // tank.speed min
  const killsMaxSpeed = run(10, 1 / 60);   // tank.speed max
  assert.equal(killsMinSpeed, killsMaxSpeed,
    `parked tank speed-invariance broken: kills at speed=0.5: ${killsMinSpeed}, at speed=10: ${killsMaxSpeed}`);
  // Baseline pin: confirms the count itself, not just equality — catches radius drift
  // that would inflate kills without breaking the speed-equality assertion above.
  // NOTE: this pin has a wide blind band (radius 0.5×–3× all yield 44 kills); use the
  // direct radius assertion below as the authoritative drift detector.
  assert.equal(killsMinSpeed, 44, `baseline kill count drifted from 44 — radius or critter flow changed`);
  // Direct radius assertion: asserts the computed tankContactRadius rather than
  // inferring it from kill counts (which have a blind band of 0.5×–3× the true radius).
  // Constructed from the same seed=3 world so we can inspect its radius.
  {
    const t = makeTuning();
    t.set('tank.speed', 1); t.set('tank.damage', 20);
    t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
    // This test is about contact radius, not wave timing: skip the build phase
    // so its pinned kill count measures the thing it claims to measure.
    t.set('wave.buildTime', 0);
    const wCheck = makeWorld({ seed: 3, tuning: t });
    assert.ok(
      Math.abs(wCheck.tankContactRadius - 0.027) < 0.002,
      `contact radius ${wCheck.tankContactRadius} drifted from the derived ~0.027`,
    );
  }
  // Same speed, different dt — must be equal (radius should not vary with dt when parked)
  // Reuse killsMaxSpeed (speed=10, dt=1/60) — avoids re-running the same sim.
  const kills30fps = run(10, 1 / 30);
  assert.equal(killsMaxSpeed, kills30fps,
    `parked tank dt-invariance broken: kills at dt=1/60: ${killsMaxSpeed}, at dt=1/30: ${kills30fps}`);
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
    // chip damage (damage=0.5 < enemy.hp=5): critter survives many ticks per contact
    // lethal damage (damage=20 > enemy.hp=5): critter dies on first contact
    t.set('tank.damage', damage);
    t.set('wave.size', 20); t.set('wave.dripRate', 0.05); t.set('enemy.speed', 1.0);
    // This test is about contact radius, not wave timing: skip the build phase
    // so its pinned kill count measures the thing it claims to measure.
    t.set('wave.buildTime', 0);
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

// I-1 regression: heartHits must never exceed HEART_MAX_HP — no post-mortem phantom hits.
// Before the fix, heartHit() fired even after heartHp reached 0, so leakers that arrive
// after death accumulate phantom hits (heartHits > HEART_MAX_HP=20). The fix gates the
// hit on (heartHp > 0). Reviewer-verified values on seed 42, 6000 ticks: heartHits=20, leaks=44.
test('I-1: heartHits never exceeds HEART_MAX_HP (no post-mortem phantom hits)', () => {
  const w = makeWorld({ seed: 42, tuning: makeTuning() });
  w.placeTower(w.dungeon.heart);
  scripted(w, 6000);
  assert.equal(w.heartHp, 0, 'heart should have died on this config');
  assert.ok(w.telemetry.data.leaks > w.telemetry.data.heartHits, 'leaks must outrun hits after death');
  assert.equal(w.telemetry.data.heartHits, 20,
    `heartHits must be exactly HEART_MAX_HP=20 (got ${w.telemetry.data.heartHits}) — post-mortem phantom hits or undercounting`);
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

// --- tower placement: high ground only -------------------------------------
// Reverts the M0b closeout's spec edit. Towers build on walls, never on open
// floor: walls carry no enemy pathing, so a tower on one can never dam a lane.

test('placement accepts a frontier wall cell', () => {
  const w = makeWorld({ seed: 42, tuning: makeTuning() });
  const cell = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart);
  assert.equal(w.placeTower(cell), true);
});

test('placement REFUSES an open cell — towers build on high ground', () => {
  const w = makeWorld({ seed: 42, tuning: makeTuning() });
  assert.equal(w.placeTower(w.dungeon.heart), false, 'the heart is open ground');
  assert.equal(w.towers.length, 0);
});

test('placement refuses a buried wall cell — it overlooks nothing', () => {
  const w = makeWorld({ seed: 42, tuning: makeTuning() });
  const buried = w.mesh.quads.findIndex(
    (_q, i) => w.dungeon.tags[i] === BLOCKED
      && (w.mesh.adj[i] ?? []).every((n) => w.dungeon.tags[n] === BLOCKED),
  );
  assert.ok(buried >= 0, 'fixture has no buried wall');
  assert.equal(w.placeTower(buried), false);
});
