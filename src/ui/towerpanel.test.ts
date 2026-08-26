// towerpanel.test.ts — the panel's pure half, tested with no DOM in sight.
//
// Same rule as shop.test.ts: there is no jsdom in this project and there should
// not be. That a <button> exists is not a claim anyone doubts. What CAN be
// wrong is arithmetic the player then acts on — an upgrade offered that the
// economy refuses, a delta row advertising a bonus that arrives one tier later
// than the panel says, a refund that pays back more than went in. Those are the
// assertions below.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOWERS, TOWER_BY_KEY, MAX_TIER, upgradeCost } from '../core/sim/towerspec.ts';
import type { TowerSpec } from '../core/sim/towerspec.ts';
import { planUpgrade, statDeltas, refundPreview } from './towerpanel.ts';

function spec(key: string): TowerSpec {
  const s = TOWER_BY_KEY.get(key);
  assert.ok(s !== undefined, `no tower named ${key}`);
  return s;
}

describe('planUpgrade', () => {
  test('refuses at MAX_TIER, and says it is maxed', () => {
    const p = planUpgrade(spec('single'), MAX_TIER, 100000);
    assert.equal(p.ok, false);
    assert.equal(p.reason, 'maxed');
    // No tier to move to, so the plan must not advertise one: a toTier above
    // fromTier is what makes the panel render a delta block, and a maxed tower
    // showing "next tier" rows would be inventing a tier 3.
    assert.equal(p.fromTier, MAX_TIER);
    assert.equal(p.toTier, MAX_TIER);
    assert.equal(p.cost, 0);
  });

  test('refuses past MAX_TIER too — a tier the roster cannot reach is still maxed', () => {
    const p = planUpgrade(spec('single'), MAX_TIER + 1, 100000);
    assert.equal(p.ok, false);
    assert.equal(p.reason, 'maxed');
  });

  test('refuses when credit is short, with a DIFFERENT reason than maxed', () => {
    const s = spec('single');
    const cost = upgradeCost(s, 0);
    assert.ok(cost !== null);
    const poor = planUpgrade(s, 0, cost - 1);
    assert.equal(poor.ok, false);
    assert.equal(poor.cost, cost);
    assert.notEqual(poor.reason, 'maxed');
    // The shortfall is the number the player needs; "you cannot afford this"
    // is a fact they already had.
    assert.equal(poor.reason, '1 cr short');
    // Being poor does not remove the tier that exists — the panel still shows
    // what the money would buy.
    assert.equal(poor.toTier, 1);
  });

  test('exactly-equal credit IS a purchase', () => {
    // The boundary is the whole decision: one credit short is a plan, exactly
    // enough is a click. An off-by-one here reads as a broken button, not as a
    // rule — and economy.spend uses the same ceiling, so the two must agree.
    for (const s of TOWERS) {
      for (let tier = 0; tier < MAX_TIER; tier++) {
        const cost = upgradeCost(s, tier);
        assert.ok(cost !== null, `${s.key} tier ${tier}`);
        const exact = planUpgrade(s, tier, cost);
        assert.equal(exact.ok, true, `${s.key} tier ${tier} at exactly ${cost}`);
        assert.equal(exact.cost, cost);
        assert.equal(exact.fromTier, tier);
        assert.equal(exact.toTier, tier + 1);
        assert.equal(exact.reason, undefined);
        assert.equal(planUpgrade(s, tier, cost - 1).ok, false, `${s.key} tier ${tier} one short`);
      }
    }
  });

  test('every quoted price is a whole credit', () => {
    // Credit is integral by design (economy.ts). A fractional quote would be
    // ceilinged by economy.spend and the panel would be off by one against the
    // money it just took.
    for (const s of TOWERS) {
      for (let tier = 0; tier < MAX_TIER; tier++) {
        const p = planUpgrade(s, tier, 0);
        assert.equal(p.cost, Math.ceil(p.cost), `${s.key} tier ${tier}`);
      }
    }
  });
});

describe('statDeltas', () => {
  test('the baseline upgrade lists exactly the three stats that grow', () => {
    const rows = statDeltas(spec('single'), 0, 1);
    assert.deepEqual(rows.map((r) => r.label), ['dmg', 'range', 'rate']);
    const dmg = rows[0];
    assert.ok(dmg !== undefined);
    assert.equal(dmg.from, '2.5');
    assert.equal(dmg.to, '3.9');
  });

  test('a mortar shows NO splash row on the first upgrade — splash arrives at tier 2', () => {
    // This is the one that matters. effectiveStats only multiplies splash at
    // t >= 2, so a panel listing splash on the 0 -> 1 upgrade would be selling
    // a bonus the player has not bought yet.
    const aoe = spec('aoe');
    const first = statDeltas(aoe, 0, 1).map((r) => r.label);
    assert.ok(!first.includes('splash'), `tier 0->1 leaked a splash row: ${first.join(',')}`);
    const second = statDeltas(aoe, 1, 2).map((r) => r.label);
    assert.ok(second.includes('splash'), `tier 1->2 lost the splash row: ${second.join(',')}`);
  });

  test('a spread tower shows NO pellet row until its tier-2 signature', () => {
    const sp = spec('spread');
    assert.ok(!statDeltas(sp, 0, 1).some((r) => r.label === 'pellets'));
    const second = statDeltas(sp, 1, 2);
    const pellets = second.find((r) => r.label === 'pellets');
    assert.ok(pellets !== undefined, 'tier 2 spread must gain pellets');
    assert.equal(pellets.from, '5');
    assert.equal(pellets.to, '7');
  });

  test('no tower ever shows a stat that is constant across every tier', () => {
    // projSpeed, slowFactor and slowDur are untouched by effectiveStats at any
    // tier. If one of them ever appears, either the panel is printing noise or
    // towerspec grew a bonus nobody told the panel about — both are findings.
    const frozen = new Set(['speed', 'slow', 'slow for']);
    for (const s of TOWERS) {
      for (let from = 0; from < MAX_TIER; from++) {
        for (const row of statDeltas(s, from, from + 1)) {
          assert.ok(!frozen.has(row.label), `${s.key} ${from}->${from + 1} printed ${row.label}`);
        }
      }
    }
  });

  test('a delta row never prints the same number twice', () => {
    // Rounding is what makes this possible: a change too small to survive one
    // decimal place would render "3.5 -> 3.5", which reads as a broken panel
    // rather than as a rounding artefact.
    for (const s of TOWERS) {
      for (let from = 0; from < MAX_TIER; from++) {
        for (const row of statDeltas(s, from, from + 1)) {
          assert.notEqual(row.from, row.to, `${s.key} ${row.label}`);
        }
      }
    }
  });

  test('every tower gains something on every upgrade it can buy', () => {
    // An upgrade that changes no visible number is a purchase with no story,
    // and the panel would be asking for credit while showing an empty block.
    for (const s of TOWERS) {
      for (let from = 0; from < MAX_TIER; from++) {
        assert.ok(statDeltas(s, from, from + 1).length > 0, `${s.key} ${from}->${from + 1}`);
      }
    }
  });

  test('no rows at all when the tier does not move', () => {
    assert.deepEqual(statDeltas(spec('single'), 1, 1), []);
  });
});

describe('refundPreview', () => {
  test('never pays back more than went in, at any fraction', () => {
    // Including fractions no lever should produce. A refund above `spent` turns
    // sell-and-rebuy into an income source, and a money printer invalidates
    // every economy reading taken after it — worse than a merely wrong number.
    for (const fraction of [-1, 0, 0.25, 0.75, 1, 1.5, 10]) {
      for (const s of TOWERS) {
        // Purchase plus every upgrade, exactly as world.placeTower accumulates.
        let spent = s.cost;
        for (let tier = 0; tier <= MAX_TIER; tier++) {
          const refund = refundPreview({ spent }, fraction);
          assert.ok(refund <= spent, `${s.key} tier ${tier} @ ${fraction}: ${refund} > ${spent}`);
          assert.ok(refund >= 0, `${s.key} tier ${tier} @ ${fraction}: negative refund`);
          const step = upgradeCost(s, tier);
          if (step === null) break;
          spent += step;
        }
      }
    }
  });

  test('the default lever returns three quarters of everything sunk in', () => {
    assert.equal(refundPreview({ spent: 40 }, 0.75), 30);
    assert.equal(refundPreview({ spent: 68 }, 0.75), 51);
  });

  test('a tower nothing was spent on refunds nothing', () => {
    assert.equal(refundPreview({ spent: 0 }, 0.75), 0);
    assert.equal(refundPreview({ spent: -5 }, 0.75), 0);
  });
});
