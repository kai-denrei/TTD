// shop.test.ts — the shop's pure half, tested with no DOM in sight.
//
// There is no jsdom in this project and there should not be: a DOM test would
// assert that a <button> exists, which is not a claim anyone doubts. What CAN
// be wrong is arithmetic the player then acts on — a shop that says "you can
// afford this" when the world will refuse the purchase, a stat line that
// quietly drops a number, an upgrade price that does not rise. Those are the
// assertions below.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { TOWERS, TOWER_BY_KEY, MAX_TIER, effectiveStats } from '../core/sim/towerspec.ts';
import {
  affordability, statLine, nextUpgrade, cellSize, rangeWorld, TANK_CONTACT_FRACTION,
} from './shop.ts';

describe('affordability', () => {
  test('exactly-equal credit IS affordable', () => {
    // The boundary is the whole point: one credit short is a decision, exactly
    // enough is a purchase. An off-by-one here reads to the player as a broken
    // button, not as a rule.
    assert.equal(affordability(40, 40), 'affordable');
    assert.equal(affordability(39, 40), 'tooExpensive');
    assert.equal(affordability(41, 40), 'affordable');
  });

  test('zero credit affords only a free thing', () => {
    assert.equal(affordability(0, 0), 'affordable');
    assert.equal(affordability(0, 1), 'tooExpensive');
  });

  test('a fractional cost is rounded UP, matching Economy.canAfford', () => {
    // economy.canAfford does `credit >= Math.ceil(cost)`. If the shop rounded
    // the other way it would offer a purchase placeTower then refuses, and the
    // credit would appear to vanish into nothing.
    assert.equal(affordability(40, 40.5), 'tooExpensive');
    assert.equal(affordability(41, 40.5), 'affordable');
  });

  test('every tower in the roster is affordable at exactly its own cost', () => {
    for (const spec of TOWERS) {
      assert.equal(affordability(spec.cost, spec.cost), 'affordable', spec.key);
      assert.equal(affordability(spec.cost - 1, spec.cost), 'tooExpensive', spec.key);
    }
  });
});

describe('statLine', () => {
  test('carries damage, range and rate for every tower', () => {
    for (const spec of TOWERS) {
      const line = statLine(spec);
      assert.ok(line.includes(`${spec.damage.toFixed(1)} dmg`), `${spec.key}: ${line}`);
      assert.ok(line.includes(`${spec.rangeCells.toFixed(1)} cells`), `${spec.key}: ${line}`);
      assert.ok(line.includes(`${spec.rate.toFixed(1)}/s`), `${spec.key}: ${line}`);
    }
  });

  test('the baseline tower reads exactly as specified', () => {
    const single = TOWER_BY_KEY.get('single');
    assert.ok(single !== undefined);
    assert.equal(statLine(single), '2.5 dmg · 3.7 cells · 1.4/s');
  });

  test('every line is one line and stays short enough for a phone', () => {
    for (const spec of TOWERS) {
      const line = statLine(spec);
      assert.ok(!line.includes('\n'), `${spec.key} wrapped`);
      assert.ok(line.length <= 40, `${spec.key} is ${line.length} chars: ${line}`);
    }
  });

  test('the structural difference is named, not just the numbers', () => {
    // A roster advertised only by damage/range/rate is one tower with a
    // slider. These tags are what makes the eight rows different CHOICES.
    const tag = (key: string): string => {
      const spec = TOWER_BY_KEY.get(key);
      assert.ok(spec !== undefined, key);
      return statLine(spec);
    };
    assert.ok(tag('spread').includes('x5'));
    assert.ok(tag('aoe').includes('splash 1.5'));
    assert.ok(tag('homing').includes('seeks'));
    assert.ok(tag('laser').includes('hitscan'));
  });

  test('the slow field advertises how much it slows, not its multiplier', () => {
    // slowFactor 0.45 multiplies speed (critters.ts) — that is a 55% slow.
    // Printing "45%" would advertise the exact opposite of what it does.
    const slow = TOWER_BY_KEY.get('slow');
    assert.ok(slow !== undefined);
    assert.equal(slow.slowFactor, 0.45);
    assert.ok(statLine(slow).includes('slow 55%'), statLine(slow));
  });
});

describe('nextUpgrade', () => {
  test('returns null at MAX_TIER for every tower', () => {
    for (const spec of TOWERS) {
      assert.equal(nextUpgrade(spec, MAX_TIER), null, spec.key);
    }
  });

  test('below the cap it names the tier it buys', () => {
    for (const spec of TOWERS) {
      for (let tier = 0; tier < MAX_TIER; tier++) {
        const up = nextUpgrade(spec, tier);
        assert.ok(up !== null, `${spec.key} @${tier}`);
        assert.equal(up.tier, tier + 1);
        assert.ok(up.cost > 0);
        assert.equal(up.cost, Math.round(up.cost), 'costs must be whole credits');
      }
    }
  });

  test('the cost rises with tier, for every tower', () => {
    // The second upgrade costing more than the first is what pushes a player to
    // spread investment before deepening it. A flat curve would erase that.
    for (const spec of TOWERS) {
      const a = nextUpgrade(spec, 0);
      const b = nextUpgrade(spec, 1);
      assert.ok(a !== null && b !== null, spec.key);
      assert.ok(b.cost > a.cost, `${spec.key}: ${a.cost} -> ${b.cost}`);
    }
  });

  test('a nonsense tier is null rather than a price', () => {
    const single = TOWER_BY_KEY.get('single');
    assert.ok(single !== undefined);
    assert.equal(nextUpgrade(single, -1), null);
    assert.equal(nextUpgrade(single, MAX_TIER + 5), null);
  });
});

describe('cellSize / rangeWorld', () => {
  test('cellSize inverts the contact-radius fraction world.ts applies', () => {
    // world.ts: tankContactRadius = 0.4 * meanChord. If that factor ever
    // changes and this constant does not, every ring drawn is the wrong size —
    // so the relationship is asserted rather than assumed.
    const meanChord = 0.068;
    assert.equal(cellSize({ tankContactRadius: TANK_CONTACT_FRACTION * meanChord }), meanChord);
  });

  test('range in world units matches what towers.ts compares against', () => {
    // towers.ts: rangeWorld = effectiveStats(spec, tier).rangeCells * meanChord
    // * tuning('tower.range'). A ring computed any other way is a picture of a
    // tower that does not exist.
    const cell = 0.068;
    for (const spec of TOWERS) {
      for (let tier = 0; tier <= MAX_TIER; tier++) {
        for (const scale of [0.5, 1, 1.8]) {
          assert.equal(
            rangeWorld(spec, tier, cell, scale),
            effectiveStats(spec, tier).rangeCells * cell * scale,
            `${spec.key} @${tier} x${scale}`,
          );
        }
      }
    }
  });

  test('a higher tier reaches further, and the sniper still reaches furthest', () => {
    const sniper = TOWER_BY_KEY.get('sniper');
    const single = TOWER_BY_KEY.get('single');
    assert.ok(sniper !== undefined && single !== undefined);
    const cell = 0.068;
    assert.ok(rangeWorld(single, 1, cell, 1) > rangeWorld(single, 0, cell, 1));
    assert.ok(rangeWorld(sniper, 0, cell, 1) > rangeWorld(single, MAX_TIER, cell, 1));
  });

  test('range stays inside the sphere at default tuning', () => {
    // The chord between two points on a unit sphere can never exceed 2. A
    // range that does is the M0a "knob whose effect is an artifact" bug: the
    // tower hits everything everywhere and its range ring is meaningless.
    const cell = 0.068;
    for (const spec of TOWERS) {
      const r = rangeWorld(spec, MAX_TIER, cell, 1);
      assert.ok(r < 2, `${spec.key} reaches ${r.toFixed(3)} of a 2.0 diameter`);
    }
  });
});
