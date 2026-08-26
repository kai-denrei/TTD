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

// Levers that are mathematically inert at default settings: they need a companion
// lever moved off its identity value before they can affect anything. The override
// is applied to BOTH arms of the sweep, so the lever under test is still the only
// thing that differs.
const COMPANION_OVERRIDES: Record<string, Record<string, number>> = {
  // reactMult = accelOnHit; the default 1.0 is an identity multiplier, so the
  // duration of a 1.0x multiplier is unobservable by construction.
  'enemy.reactionDur': { 'enemy.accelOnHit': 0.5 },
};

function runWith(overrides: Record<string, number>, seed = 42, ticks = 3000): Record<string, number> {
  const t = makeTuning();
  for (const [k, v] of Object.entries(overrides)) t.set(k, v);
  const w = makeWorld({ seed, tuning: t });
  // Place tower on a non-blocked cell near heart (heart cell is open)
  w.placeTower(w.dungeon.heart);
  for (let i = 0; i < ticks; i++) {
    w.tick(1 / 60, { forward: (i % 120) < 60 ? 1 : -1, turn: Math.sin(i / 30), fire: i % 5 === 0 });
  }
  return w.telemetry.summary();
}

describe('liveness — every sim lever must move the telemetry needle', () => {
  for (const lever of LEVERS) {
    if (RENDER_ONLY.has(lever.key)) continue;
    if (GOD_LEVERS.has(lever.key)) continue;
    test(`lever ${lever.key} is live`, () => {
      // Use min and max as the two extremes; if min===max skip (boolean/trivial)
      if (lever.min >= lever.max) return;
      const companion = COMPANION_OVERRIDES[lever.key] ?? {};
      const lo = runWith({ ...companion, [lever.key]: lever.min });
      const hi = runWith({ ...companion, [lever.key]: lever.max });
      assert.notDeepEqual(lo, hi, `lever ${lever.key} is DEAD — telemetry identical at min and max`);
    });
  }

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

  // Targeted companion-lever test — the one case where the generic sweep cannot detect
  // liveness without a companion override that's already wired into COMPANION_OVERRIDES.
  // This test asserts the same property with a more explicit scenario for documentation.
  test('enemy.reactionDur is live when accelOnHit is not identity (1.0)', () => {
    // reactionDur governs how long the accelOnHit multiplier is held after a hit.
    // With accelOnHit=1.0 (identity) the multiplier has no effect regardless of duration;
    // the companion override sets accelOnHit=0.5 so the stagger is observable.
    // Ram hits now go through hitCritter (Critical 1), so both projectile and contact
    // damage trigger the reaction — the scenario below uses projectile hits (non-lethal)
    // to accumulate observable path differences between short and long stagger windows.
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
});
