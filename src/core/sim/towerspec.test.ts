import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOWERS, TOWER_BY_KEY, TOWER_ORDER, MAX_TIER,
  upgradeCost, effectiveStats, sellRefund,
} from './towerspec.ts';

describe('tower roster', () => {
  test('has eight towers with unique keys', () => {
    assert.equal(TOWERS.length, 8);
    assert.equal(new Set(TOWERS.map((t) => t.key)).size, 8);
  });

  test('the unlock ladder covers every tower exactly once', () => {
    assert.equal(TOWER_ORDER.length, TOWERS.length);
    assert.deepEqual([...TOWER_ORDER].sort(), TOWERS.map((t) => t.key).sort());
  });

  test('every tower is reachable by key', () => {
    for (const t of TOWERS) assert.equal(TOWER_BY_KEY.get(t.key), t);
  });

  test('every tower has positive cost, damage, range and rate', () => {
    for (const t of TOWERS) {
      assert.ok(t.cost > 0, `${t.key} cost`);
      assert.ok(t.damage > 0, `${t.key} damage`);
      assert.ok(t.rangeCells > 0, `${t.key} range`);
      assert.ok(t.rate > 0, `${t.key} rate`);
    }
  });

  test('every attack kind in the roster is represented, and each is used', () => {
    // A roster whose members differ only in numbers is one tower with a
    // slider. The structural variety is the design.
    const kinds = new Set(TOWERS.map((t) => t.attack));
    for (const k of ['single', 'spread', 'homing', 'slowfield', 'mortar', 'beam']) {
      assert.ok(kinds.has(k as never), `no tower uses the ${k} attack`);
    }
  });

  test('attack-specific fields are present exactly where they are used', () => {
    for (const t of TOWERS) {
      if (t.attack === 'spread') assert.ok((t.pellets ?? 0) > 1, `${t.key} spread with no pellets`);
      if (t.attack === 'mortar') assert.ok((t.splashCells ?? 0) > 0, `${t.key} mortar with no splash`);
      if (t.attack === 'slowfield') {
        assert.ok((t.slowFactor ?? 1) < 1, `${t.key} slowfield that does not slow`);
        assert.ok((t.slowDur ?? 0) > 0, `${t.key} slowfield with no duration`);
      }
    }
  });

  test('damage lands on TTD\'s 1-20 critter HP scale, not the reference 1-90', () => {
    for (const t of TOWERS) {
      assert.ok(t.damage <= 20, `${t.key} damage ${t.damage} is off TTD's scale`);
    }
    // The sniper is the heavy hitter and must still one-shot a default critter.
    assert.ok(TOWER_BY_KEY.get('sniper')!.damage >= 4);
    // ...and rapid must NOT, or its tempo advantage is meaningless.
    assert.ok(TOWER_BY_KEY.get('rapid')!.damage < 1);
  });

  test('the roster preserves the reference damage RATIOS', () => {
    // The absolute scale changed; the design is the ratios between towers.
    const sniper = TOWER_BY_KEY.get('sniper')!.damage;
    const single = TOWER_BY_KEY.get('single')!.damage;
    assert.ok(Math.abs(sniper / single - 62 / 14) < 0.01, 'sniper:single ratio drifted');
  });
});

describe('upgrades', () => {
  test('two tiers, then nothing', () => {
    const t = TOWER_BY_KEY.get('single')!;
    assert.equal(typeof upgradeCost(t, 0), 'number');
    assert.equal(typeof upgradeCost(t, 1), 'number');
    assert.equal(upgradeCost(t, MAX_TIER), null);
  });

  test('the second upgrade costs more than the first AND more than the tower', () => {
    // This curve is what pushes you to spread investment before deepening it.
    for (const t of TOWERS) {
      const a = upgradeCost(t, 0)!;
      const b = upgradeCost(t, 1)!;
      assert.ok(b > a, `${t.key}: tier2 (${b}) not dearer than tier1 (${a})`);
      assert.ok(b > t.cost, `${t.key}: tier2 (${b}) not dearer than the tower (${t.cost})`);
    }
  });

  test('every stat grows with tier', () => {
    for (const t of TOWERS) {
      const t0 = effectiveStats(t, 0);
      const t2 = effectiveStats(t, 2);
      assert.ok(t2.damage > t0.damage, `${t.key} damage did not grow`);
      assert.ok(t2.rangeCells > t0.rangeCells, `${t.key} range did not grow`);
      assert.ok(t2.rate > t0.rate, `${t.key} rate did not grow`);
    }
  });

  test('tier 0 returns the base spec unchanged', () => {
    const t = TOWER_BY_KEY.get('single')!;
    const s = effectiveStats(t, 0);
    assert.equal(s.damage, t.damage);
    assert.equal(s.rangeCells, t.rangeCells);
    assert.equal(s.rate, t.rate);
  });

  test('tier is clamped rather than extrapolated', () => {
    const t = TOWER_BY_KEY.get('single')!;
    assert.deepEqual(effectiveStats(t, 99), effectiveStats(t, MAX_TIER));
    assert.deepEqual(effectiveStats(t, -5), effectiveStats(t, 0));
  });

  test('the tier-2 signature deepens what each tower already is', () => {
    // Uniform growth alone would make every tower converge on the same shape.
    const spread = TOWER_BY_KEY.get('spread')!;
    assert.equal(effectiveStats(spread, 2).pellets, (spread.pellets ?? 0) + 2);

    const mortar = TOWER_BY_KEY.get('aoe')!;
    const m1 = effectiveStats(mortar, 1).splashCells;
    const m2 = effectiveStats(mortar, 2).splashCells;
    assert.ok(m2 > m1 * 1.3, 'mortar splash got no tier-2 bump');

    const laser = TOWER_BY_KEY.get('laser')!;
    const l1 = effectiveStats(laser, 1).rangeCells;
    const l2 = effectiveStats(laser, 2).rangeCells;
    assert.ok(l2 > l1 * 1.2, 'beam range got no tier-2 bump');
  });
});

describe('selling', () => {
  test('refunds a fraction of everything sunk in, including upgrades', () => {
    assert.equal(sellRefund(100, 0.75), 75);
    const t = TOWER_BY_KEY.get('single')!;
    const fullySunk = t.cost + upgradeCost(t, 0)! + upgradeCost(t, 1)!;
    assert.equal(sellRefund(fullySunk, 0.75), Math.round(fullySunk * 0.75));
  });

  test('never refunds more than was spent', () => {
    for (let spent = 0; spent < 500; spent += 37) {
      assert.ok(sellRefund(spent, 0.75) <= spent);
    }
  });
});
