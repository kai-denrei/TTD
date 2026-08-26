import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTuning } from './tuning/store.ts';
import { makeWorld } from './sim/world.ts';
import { LEVERS } from './tuning/schema.ts';
import { nearestFrontierWall } from './sphere/dungeon.ts';
import { patrolInput } from './sim/runner.ts';

// Render-only levers: they cannot move sim telemetry by design, so the
// diff-the-telemetry gate below cannot judge them. They are NOT untested —
// src/render/bindings.test.ts gates them instead, asserting that each has
// exactly one declared binding, that min and max leave the render target in
// different states, and that readRenderState re-reads every key each frame
// (never caching). Verified by sabotage: making a binding a no-op fails both
// the effect and the per-frame-read assertions.
//
// Keep this set in sync with RENDER_ONLY_KEYS in src/render/bindings.ts; the
// coverage test there fails if one drifts.
//
// Residual gap, stated rather than hidden: bindings.test.ts proves the value
// reaches the property, not that three.js honours it. That is checked by eye
// and recorded in the M0b notes.
const RENDER_ONLY = new Set([
  'bloom.strength',
  'bloom.radius',
  'bloom.threshold',
  'shake.amount',
  'fx.flashDur',
  'fx.burstSize',
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
  // tower.damage and tank.damage saturate the upper half only because enemy.hp
  // defaults to 5 — both mid (~10) and max (20) one-shot enemies. With enemy.hp=20
  // the upper half is testable: mid(~10) chips, max(20) one-shots — telemetry differs.
  'tower.damage': { 'enemy.hp': 20 },
  'tank.damage':  { 'enemy.hp': 20 },
  // M0c-1: tower.rate is inert in its UPPER half at default damage. A kill
  // needs two hits on one critter (tower.damage 3 vs enemy.hp 5), and above
  // ~2 s between shots the critter has left range before the second — so the
  // tower kills NOTHING and every slow rate is indistinguishable from every
  // other (measured: rate 2.6 and 5.0 both give towerKillShare 0.000 and
  // byte-identical telemetry). tower.damage=20 one-shots a default critter,
  // which makes rate control kill throughput directly: 10 kills at 2.6 s
  // against 8 at 5.0 s.
  //
  // This guard passed before M0c-1 only incidentally. Fixing the tank's turn
  // inversion changed its path, hence which critters it killed, hence the
  // shared critter RNG stream — the comparability hazard M0a's brain notes §2
  // documents. The lever's upper half was always this marginal; the shift
  // merely stopped hiding it.
  'tower.rate':   { 'tower.damage': 20 },
  // M0c-2: at default offence NOTHING dies above ~10 HP — measured, enemy.hp=20
  // yields exactly 0 kills — so the upper half of both HP levers compares zero
  // against zero. Raising both damage levers puts kills back on the board so
  // the HP lever under test is what moves the needle.
  'enemy.hp':      { 'tower.damage': 20, 'tank.damage': 20 },
  // hpGrowth needs a NARROWER band than enemy.hp does, and for the opposite
  // reason. Too little damage and nothing dies at any HP; too much and
  // everything is one-shot, so growing HP changes nothing either. Measured:
  // live at damage 6 and 8, dead at 10 and above. 7 is the centre of that band
  // — chosen rather than an edge value because a lever sitting at the edge of
  // its observable region goes dead on any unrelated RNG shift, which is how
  // tower.rate died.
  'wave.hpGrowth': { 'tower.damage': 7, 'tank.damage': 7 },
  // The cap only binds once the streak is long enough to reach it. At the
  // default step of 0.05 a run's ~20 kills reach a multiplier of about 2, so
  // every cap above 2 is equally unreached and the lever reads dead. The max
  // step (0.2) puts the multiplier around 5 after the same 20 kills, which is
  // squarely inside the cap's range.
  'eco.streakCap': { 'eco.streakStep': 0.2 },
};

// NEW-B: Levers that legitimately saturate before their declared max.
// The telemetry effect flattens before the slider top, so the standard min-vs-max
// sweep passes but the mid-vs-max comparison may not.
// Each entry here is a documented exception with a rationale — not a silent skip.
// (I-2 fix: former entries tower.range, time.scale, tower.damage, tank.damage removed —
//  tower.range and time.scale pass the upper-half gate empirically; tower.damage and
//  tank.damage are now testable via COMPANION_OVERRIDES with enemy.hp=20.)
const SATURATING = new Set<string>([
  // eco.streakCap — live at min vs max (a cap of 1 pins the multiplier at 1),
  // but its UPPER half is unreachable in a harness run and the reason is the
  // design, not the test. The cap only binds once a streak is long enough to
  // hit it, and HokorobiTawaa needs 80 consecutive kills to reach its cap of 5.
  // Measured here: a 50-second run scores ~12 kills with a BEST STREAK OF 4,
  // because leaks keep resetting it — so the multiplier peaks near 1.8 and
  // every cap above that is equally unreached.
  //
  // Narrowing the lever's range to ~1-2 would make the gate pass while making
  // the lever useless and breaking parity with both references, which is the
  // wrong trade. This is a long-run mechanic being measured by a short run.
  // Re-verify if the harness ever runs long enough to sustain a real streak.
  'eco.streakCap',
]);

function runWith(overrides: Record<string, number>, seed = 42, ticks = 3000): Record<string, number> {
  const t = makeTuning();
  for (const [k, v] of Object.entries(overrides)) t.set(k, v);
  const w = makeWorld({ seed, tuning: t });
  // Towers stand on high ground only; the heart itself is open floor.
  const wall = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart);
  w.placeTower(wall);
  // A SECOND tower, sold partway through the run. Repositioning is a real part
  // of playing a tower defence, and it is the only way eco.sellRefund is
  // exercised at all — a refund lever with nothing ever sold is dead by
  // construction rather than by design.
  const second = nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.spawn);
  if (second !== wall) w.placeTower(second);
  for (let i = 0; i < ticks; i++) {
    // Shares the sweep's scripted session so the two harnesses cannot drift
    // apart. It aims and holds fire — see patrolInput for why both matter.
    w.tick(1 / 60, patrolInput(i, w));
    if (i === 1500 && second !== wall) w.sellTower(second);
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

    // NEW-B: also assert upper-half sensitivity — lever must differ across its top half
    // (50th percentile vs max). COMPANION_OVERRIDES are applied to BOTH arms identically,
    // so they do not contaminate the comparison and upper-half coverage is valid for them.
    // SATURATING levers skip with documented rationale above.
    if (!SATURATING.has(lever.key)) {
      test(`lever ${lever.key} is live in upper half`, () => {
        if (lever.min >= lever.max) return;
        const companion = COMPANION_OVERRIDES[lever.key] ?? {};
        const mid = lever.min + (lever.max - lever.min) * 0.5;
        const lo = runWith({ ...companion, [lever.key]: mid });
        const hi = runWith({ ...companion, [lever.key]: lever.max });
        assert.notDeepEqual(lo, hi, `lever ${lever.key} is SATURATED in upper half — add to SATURATING with rationale if this is intentional`);
      });
    }
  }

  // Targeted god-mode tests
  test('god.heartInvulnerable prevents HP loss but still counts leaks (I6 fix)', () => {
    // I6: leak = critter arrived (always); heartHit = also always (spec §5: god hits count normally)
    // I-1: heartHit now symmetric with tankHit — recorded unconditionally, HP loss gated separately.
    const t = makeTuning();
    t.set('god.heartInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
    const w = makeWorld({ seed: 42, tuning: t });
    const hp0 = w.heartHp;
    for (let i = 0; i < 8000; i++) w.tick(1 / 60, { forward: 1, turn: 0, fire: false });
    assert.ok(w.telemetry.data.leaks > 0, 'nothing reached the heart');
    assert.ok(w.telemetry.data.heartHits > 0, 'heartHit must fire in god mode — spec §5: hits always counted');
    assert.equal(w.heartHp, hp0, 'heart HP changed despite god mode');
  });

  test('god.tankInvulnerable prevents HP loss but still counts tank hits', () => {
    const t = makeTuning();
    t.set('god.tankInvulnerable', 1); t.set('enemy.speed', 3); t.set('wave.size', 20); t.set('wave.dripRate', 0.05);
    const w = makeWorld({ seed: 42, tuning: t });
    const hp0 = w.tank.hp;
    // Move tank through enemy territory so it collides with critters.
    // (Stationary at spawn won't get hits on seed 42 specifically — on that seed
    // all gates have distToHeart <= distToHeart[spawn], so critters always walk
    // away from spawn toward the heart and never return to the contact zone.
    // On ~11% of seeds (e.g. seed 3, seed 57) some gates have distToHeart >
    // distToHeart[spawn], so critters do walk through spawn; seed 42 avoids that.)
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
