import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ENEMIES, ENEMY_BY_TYPE, INTROS, HIT_REACT_DUR, REGEN_DELAY,
  typesByWave,
} from './enemyspec.ts';

describe('enemy roster', () => {
  test('has twelve enemies with unique types', () => {
    assert.equal(ENEMIES.length, 12);
    assert.equal(new Set(ENEMIES.map((e) => e.type)).size, 12);
  });

  test('every enemy is reachable by type', () => {
    for (const e of ENEMIES) assert.equal(ENEMY_BY_TYPE.get(e.type), e);
  });

  test('every enemy has positive hp, speed, size, heart damage and bounty', () => {
    for (const e of ENEMIES) {
      assert.ok(Number.isInteger(e.hp) && e.hp > 0, `${e.type} hp`);
      assert.ok(e.speed > 0, `${e.type} speed`);
      assert.ok(e.size > 0, `${e.type} size`);
      assert.ok(Number.isInteger(e.heartDmg) && e.heartDmg > 0, `${e.type} heartDmg`);
      assert.ok(Number.isInteger(e.bounty) && e.bounty > 0, `${e.type} bounty`);
      assert.ok(e.label.length > 0 && e.help.length > 0, `${e.type} text`);
    }
  });

  test('speed and size are MULTIPLIERS, not absolutes', () => {
    // They scale the base speed lever and cellSide respectively. A value that
    // wandered into world units would still "work" until the sphere is
    // re-tessellated or enemy.speed is swept, so pin the sane band here.
    for (const e of ENEMIES) {
      assert.ok(e.speed >= 0.25 && e.speed <= 4, `${e.type} speed ${e.speed} is not a multiplier`);
      assert.ok(e.size >= 0.1 && e.size <= 1.5, `${e.type} size ${e.size} is not a multiplier`);
    }
  });

  test('colors are 24-bit ints (and need NOT be unique — hue encodes class)', () => {
    for (const e of ENEMIES) {
      assert.ok(Number.isInteger(e.color), `${e.type} color`);
      assert.ok(e.color >= 0 && e.color <= 0xffffff, `${e.type} color out of range`);
    }
    // scoutufo and drifter deliberately share E_YELLOW; asserting uniqueness
    // here would be asserting a bug into the palette.
    assert.equal(ENEMY_BY_TYPE.get('scoutufo')!.color, ENEMY_BY_TYPE.get('drifter')!.color);
  });
});

describe('special abilities', () => {
  test('reaction fields are present only where the ability is claimed', () => {
    for (const e of ENEMIES) {
      if (e.slowOnHit !== undefined) {
        assert.ok(e.slowOnHit > 0 && e.slowOnHit < 1, `${e.type} slowOnHit ${e.slowOnHit} does not slow`);
      }
      if (e.accelOnHit !== undefined) {
        assert.ok(e.accelOnHit > 1, `${e.type} accelOnHit ${e.accelOnHit} does not accelerate`);
      }
      // The two reactions contradict each other; one creature cannot do both.
      assert.ok(
        !(e.slowOnHit !== undefined && e.accelOnHit !== undefined),
        `${e.type} both slows and accelerates on hit`,
      );
      if (e.regen !== undefined) assert.ok(e.regen > 0, `${e.type} regen`);
    }
  });

  test('every structural ability is actually used by someone', () => {
    // A roster that varies only in hp is one enemy with a difficulty knob. Each
    // of these invalidates a tactic that worked the wave before.
    assert.ok(ENEMIES.some((e) => e.rammable), 'nothing is rammable');
    assert.ok(ENEMIES.some((e) => !e.rammable), 'everything is rammable');
    assert.ok(ENEMIES.some((e) => e.erratic), 'nothing moves erratically');
    assert.ok(ENEMIES.some((e) => e.regen !== undefined), 'nothing regenerates');
    assert.ok(ENEMIES.some((e) => e.slowOnHit !== undefined), 'nothing slows on hit');
    assert.ok(ENEMIES.some((e) => e.accelOnHit !== undefined), 'nothing accelerates on hit');
    assert.ok(ENEMIES.some((e) => e.heavy), 'no epic tier');
  });

  test('exactly one boss, and boss and heavy are mutually exclusive', () => {
    const bosses = ENEMIES.filter((e) => e.boss);
    assert.equal(bosses.length, 1);
    for (const e of ENEMIES) {
      assert.ok(!(e.boss && e.heavy), `${e.type} is both boss and heavy — spawn density is ambiguous`);
    }
  });

  test('ramming stays the cheap answer only against cheap threats', () => {
    // The tank kills rammables for free. If a rammable type ever carried epic
    // hp or multi-heart damage, the tactical layer would trivialise the macro
    // layer — that inversion is the failure this guards.
    for (const e of ENEMIES) {
      if (!e.rammable) continue;
      assert.ok(e.hp <= 2, `${e.type} is rammable with ${e.hp} hp`);
      assert.equal(e.heartDmg, 1, `${e.type} is rammable but costs ${e.heartDmg} hearts`);
      assert.ok(!e.heavy && !e.boss, `${e.type} is rammable and epic/boss`);
    }
  });

  test('the shared reaction and regen windows are real durations', () => {
    assert.ok(HIT_REACT_DUR > 0 && HIT_REACT_DUR < 5);
    assert.ok(REGEN_DELAY > 0 && REGEN_DELAY < 5);
  });
});

describe('the introduction ladder', () => {
  test('covers every enemy exactly once', () => {
    assert.equal(INTROS.length, ENEMIES.length);
    assert.deepEqual(
      INTROS.map((i) => i.type).sort(),
      ENEMIES.map((e) => e.type).sort(),
    );
  });

  test('every intro names a real type and carries flavor', () => {
    for (const i of INTROS) {
      assert.ok(ENEMY_BY_TYPE.has(i.type), `intro for unknown type ${i.type}`);
      assert.ok(i.role.length > 0, `${i.type} has no role line`);
    }
  });

  test('waves are consecutive from one — the ladder IS the wave counter', () => {
    INTROS.forEach((i, idx) => assert.equal(i.wave, idx + 1, `intro ${idx} wave`));
  });

  test('the boss is introduced last', () => {
    const last = INTROS[INTROS.length - 1]!;
    assert.ok(ENEMY_BY_TYPE.get(last.type)!.boss, 'the ladder does not end on the boss');
  });

  test('ramming is revoked partway up the ladder, not at the top', () => {
    // The difficulty cliff is the wave the tank's free answer disappears. If it
    // moved to the last wave or two, eleven waves would all pose one question.
    const ram = INTROS.map((i) => ENEMY_BY_TYPE.get(i.type)!.rammable);
    const firstNonRam = ram.indexOf(false);
    assert.ok(firstNonRam > 2, 'ramming is revoked before the tank is ever taught');
    assert.ok(firstNonRam < ram.length - 3, 'ramming is revoked too late to matter');
    // ...and once revoked it never comes back — otherwise the cliff is a dip.
    assert.ok(!ram.slice(firstNonRam).some(Boolean), 'ramming returns after being revoked');
  });
});

describe('the difficulty spread', () => {
  // Broad trend assertions, not row-by-row restatements of the table. Individual
  // types deliberately break monotonicity (the amoeba out-pays two later types;
  // the boss has less hp than the prime) — what must hold is that the back half
  // of the ladder is a materially harder set than the front half.
  const half = INTROS.length / 2;
  const specsInOrder = INTROS.map((i) => ENEMY_BY_TYPE.get(i.type)!);
  const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const early = specsInOrder.slice(0, half);
  const late = specsInOrder.slice(half);

  test('the back half is substantially tougher', () => {
    assert.ok(
      mean(late.map((e) => e.hp)) > 2 * mean(early.map((e) => e.hp)),
      'late hp is not meaningfully above early hp',
    );
  });

  test('the back half pays substantially more', () => {
    // Bounty must track threat or the economy rewards farming the tutorial.
    assert.ok(
      mean(late.map((e) => e.bounty)) > 2 * mean(early.map((e) => e.bounty)),
      'late bounty does not track the rising threat',
    );
  });

  test('tough enemies are slow — hp and speed trade against each other', () => {
    assert.ok(
      mean(late.map((e) => e.speed)) < mean(early.map((e) => e.speed)),
      'the back half is both tankier AND faster, which leaves no counterplay',
    );
    // No single enemy may be both top-tier hp and top-tier speed.
    const maxHp = Math.max(...ENEMIES.map((e) => e.hp));
    for (const e of ENEMIES) {
      if (e.hp >= maxHp / 2) assert.ok(e.speed < 1, `${e.type} is both tanky and fast`);
    }
  });

  test('leaking gets more expensive as the ladder climbs', () => {
    assert.ok(
      Math.max(...late.map((e) => e.heartDmg)) > Math.max(...early.map((e) => e.heartDmg)),
      'heart damage never escalates',
    );
  });

  test('the epic tier sits above everything introduced before it', () => {
    const heavyStart = INTROS.findIndex((i) => ENEMY_BY_TYPE.get(i.type)!.heavy);
    assert.ok(heavyStart > 0, 'no epic tier on the ladder');
    const beforeMaxHp = Math.max(...specsInOrder.slice(0, heavyStart).map((e) => e.hp));
    for (const e of specsInOrder.slice(heavyStart)) {
      assert.ok(e.hp > beforeMaxHp, `${e.type} arrives at the epic tier with only ${e.hp} hp`);
    }
  });
});

describe('typesByWave', () => {
  test('wave N offers the first N types of the ladder', () => {
    assert.deepEqual(typesByWave(1), ['phage']);
    assert.deepEqual(typesByWave(3), INTROS.slice(0, 3).map((i) => i.type));
    assert.equal(typesByWave(12).length, 12);
  });

  test('clamps at both ends rather than throwing — endless mode keeps drawing', () => {
    assert.deepEqual(typesByWave(0), typesByWave(1));
    assert.deepEqual(typesByWave(-5), typesByWave(1));
    assert.deepEqual(typesByWave(999), typesByWave(INTROS.length));
    assert.deepEqual(typesByWave(4.9), typesByWave(4));
  });

  test('only ever names types that exist', () => {
    for (let w = 1; w <= 20; w++) {
      for (const t of typesByWave(w)) assert.ok(ENEMY_BY_TYPE.has(t), `wave ${w} names ${t}`);
    }
  });
});
