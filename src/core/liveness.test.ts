import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTuning } from './tuning/store.ts';
import { makeWorld } from './sim/world.ts';
import { LEVERS } from './tuning/schema.ts';

// Render-only levers: never read by sim, by design.
// These will be confirmed live in M0b (render layer).
const RENDER_ONLY = new Set([
  'bloom.strength',
  'bloom.radius',
  'bloom.threshold',
  'shake.amount',
]);

// God-mode levers: binary toggles — need targeted assertions, not a diff-telemetry check.
const GOD_LEVERS = new Set([
  'god.heartInvulnerable',
  'god.tankInvulnerable',
]);

// Companion-dependent levers: these levers require a specific test scenario to
// demonstrate liveness — the standard runWith (tower at heart, moving tank) does
// not create conditions where their effect is visible in telemetry.
const COMPANION_LEVERS = new Set([
  // Only live when enemy.accelOnHit !== 1.0 (identity); the standard sweep
  // uses the default accelOnHit=1.0 which is a no-op for reaction speed.
  'enemy.reactionDur',
  // Only live when towers accumulate multiple shots against the same critter.
  // The standard tower-at-heart placement kills nothing; this requires a
  // tower-at-spawn scenario with slow enemies.
  'wave.hpGrowth',
  // Only live when the tank actually fires projectiles at critters in range.
  // The standard input fires every 45 ticks but tank.range is small; the tank
  // must fire more frequently and have a wider range to accumulate a measurable
  // difference between slow and fast fire rates.
  'tank.fireRate',
]);

function runWith(overrides: Record<string, number>, seed = 42, ticks = 3000): Record<string, number> {
  const t = makeTuning();
  for (const [k, v] of Object.entries(overrides)) t.set(k, v);
  const w = makeWorld({ seed, tuning: t });
  // Place tower on a non-blocked cell near heart (heart cell is open)
  w.placeTower(w.dungeon.heart);
  for (let i = 0; i < ticks; i++) {
    w.tick(1 / 60, { forward: (i % 120) < 60 ? 1 : -1, turn: Math.sin(i / 30), fire: i % 45 === 0 });
  }
  return w.telemetry.summary();
}

describe('liveness — every sim lever must move the telemetry needle', () => {
  for (const lever of LEVERS) {
    if (RENDER_ONLY.has(lever.key)) continue;
    if (GOD_LEVERS.has(lever.key)) continue;
    if (COMPANION_LEVERS.has(lever.key)) continue;
    test(`lever ${lever.key} is live`, () => {
      // Use min and max as the two extremes; if min===max skip (boolean/trivial)
      if (lever.min >= lever.max) return;
      const lo = runWith({ [lever.key]: lever.min });
      const hi = runWith({ [lever.key]: lever.max });
      assert.notDeepEqual(lo, hi, `lever ${lever.key} is DEAD — telemetry identical at min and max`);
    });
  }

  // Targeted companion-lever tests
  test('enemy.reactionDur is live when accelOnHit is not identity (1.0)', () => {
    // reactionDur only matters when accelOnHit ≠ 1.0; the standard sweep uses
    // the default accelOnHit=1.0 (identity → no speed change on hit).
    // Also requires tank.damage < enemy.hp (non-lethal hits to trigger reactions),
    // a large enough tank range to hit critters, and slow enemies so the stagger
    // duration has time to accumulate into a measurable path difference.
    const runScenario = (reactionDur: number) => {
      const t = makeTuning();
      t.set('enemy.reactionDur', reactionDur);
      t.set('enemy.accelOnHit', 0.5); // stagger: critters slow to 50% on hit
      t.set('tank.damage', 2);        // below enemy.hp → hits trigger reaction without killing
      t.set('tank.range', 0.5);       // wide range so tank can hit critters from afar
      t.set('enemy.speed', 0.3);      // slow critters so stagger has visible impact on path
      t.set('enemy.hp', 5);
      const w = makeWorld({ seed: 42, tuning: t });
      w.placeTower(w.dungeon.heart);
      for (let i = 0; i < 3000; i++) w.tick(1 / 60, { forward: (i % 120) < 60 ? 1 : -1, turn: Math.sin(i / 30), fire: i % 45 === 0 });
      return w.telemetry.summary();
    };
    const lo = runScenario(0); // no stagger → critters recover instantly
    const hi = runScenario(3); // long stagger → slowed for 3 s per hit
    assert.notDeepEqual(lo, hi, 'enemy.reactionDur is DEAD even with accelOnHit=0.5');
  });

  test('tank.fireRate is live when the tank fires frequently at slow critters', () => {
    // The standard input fires every 45 ticks (~0.75 s) and uses the default
    // tank.range=0.25 — the tank rarely encounters critters in that window.
    // This scenario uses a wider range, non-lethal damage, and frequent fire
    // so the cooldown between shots visibly changes kill counts.
    const runScenario = (fireRate: number) => {
      const t = makeTuning();
      t.set('tank.fireRate', fireRate);
      t.set('tank.range', 0.5);   // wide enough to find critters regularly
      t.set('tank.damage', 3);    // non-lethal: 2 shots needed (enemy.hp=5)
      t.set('enemy.speed', 0.3);  // slow critters: tank has multiple chances to fire
      t.set('enemy.hp', 5);
      t.set('wave.dripRate', 0.2); t.set('wave.size', 15);
      const w = makeWorld({ seed: 42, tuning: t });
      w.placeTower(w.dungeon.heart);
      for (let i = 0; i < 6000; i++) w.tick(1 / 60, { forward: (i % 120) < 60 ? 1 : -1, turn: Math.sin(i / 30), fire: i % 5 === 0 });
      return w.telemetry.summary();
    };
    const lo = runScenario(0.1); // fast fire → more tank kills
    const hi = runScenario(3.0); // slow fire → fewer tank kills
    assert.notDeepEqual(lo, hi, 'tank.fireRate is DEAD — telemetry identical at min and max');
  });

  test('wave.hpGrowth is live when a tower fires multiple shots per critter', () => {
    // The standard runWith (tower at heart, moving tank) produces no tower kills,
    // so HP growth has no observable effect. This scenario places the tower at
    // spawn with slow enemies so the tower fires multiple shots per critter.
    // Higher hpGrowth → harder-to-kill critters in later waves → fewer tower
    // kills, more heart hits — demonstrating the lever is genuinely wired up.
    const runScenario = (hpGrowth: number) => {
      const t = makeTuning();
      t.set('wave.hpGrowth', hpGrowth);
      t.set('wave.size', 5); t.set('wave.gap', 1); t.set('wave.dripRate', 0.5);
      t.set('wave.overlap', 0.5);
      t.set('tower.damage', 3); t.set('tower.range', 0.25); t.set('tower.rate', 0.3);
      t.set('enemy.speed', 0.1); t.set('enemy.hp', 5);
      const w = makeWorld({ seed: 42, tuning: t });
      w.placeTower(w.dungeon.spawn); // tower at spawn intercepts critters
      for (let i = 0; i < 10000; i++) w.tick(1 / 60, { forward: 0, turn: 0, fire: false });
      return w.telemetry.summary();
    };
    const lo = runScenario(1.0); // flat HP — tower kills easily
    const hi = runScenario(1.3); // compounding HP — tower kills struggle
    assert.notDeepEqual(lo, hi, 'wave.hpGrowth is DEAD — telemetry identical at min and max');
  });

  // Targeted god-mode tests
  test('god.heartInvulnerable prevents HP loss but still counts hits', () => {
    const t = makeTuning();
    t.set('god.heartInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
    const w = makeWorld({ seed: 42, tuning: t });
    const hp0 = w.heartHp;
    for (let i = 0; i < 8000; i++) w.tick(1 / 60, { forward: 1, turn: 0, fire: false });
    assert.ok(w.telemetry.data.heartHits > 0, 'nothing reached the heart');
    assert.equal(w.heartHp, hp0, 'heart HP changed despite god mode');
  });

  test('god.tankInvulnerable prevents HP loss but still counts tank hits', () => {
    const t = makeTuning();
    t.set('god.tankInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
    const w = makeWorld({ seed: 42, tuning: t });
    const hp0 = w.tank.hp;
    // Move tank through enemy territory so it collides with critters.
    // (Stationary at spawn won't get hits because critters spawn adjacent and
    // walk away toward heart — they never return to within contact radius.)
    for (let i = 0; i < 8000; i++) w.tick(1 / 60, { forward: 1, turn: Math.sin(i / 30), fire: false });
    assert.ok(w.telemetry.data.tankHits > 0, 'tank was never hit');
    assert.equal(w.tank.hp, hp0, 'tank HP changed despite god mode');
  });
});
