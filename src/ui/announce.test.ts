// announce.test.ts — the narrator's pure half, with no DOM in sight.
//
// Same argument as shop.test.ts: there is no jsdom here and there should not
// be. A DOM test would assert that a <div> exists, which nobody doubts. What
// CAN be wrong is what the card SAYS and WHEN — a run-over card upstaged by a
// wave card, a new type arriving unnamed, a countdown reading "-3s". Those are
// the assertions below.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { INTROS, ENEMY_BY_TYPE } from '../core/sim/enemyspec.ts';
import { newTypesInWave, announcementFor, formatCountdown } from './announce.ts';

describe('newTypesInWave', () => {
  test('every wave on the ladder introduces exactly its own one type', () => {
    // The ladder is one new idea per wave (enemyspec.ts). If a wave ever
    // introduced two, the card would name both — but the claim being tested is
    // that the announcement matches the ladder, whatever the ladder says.
    for (const intro of INTROS) {
      const fresh = newTypesInWave(intro.wave);
      assert.deepEqual(fresh, [intro.type], `wave ${intro.wave}`);
    }
  });

  test('waves past the end of the ladder introduce nothing', () => {
    const last = INTROS[INTROS.length - 1];
    assert.ok(last !== undefined);
    for (const wave of [last.wave + 1, last.wave + 5, 100]) {
      assert.deepEqual(newTypesInWave(wave), [], `wave ${wave}`);
    }
  });

  test('wave 0 and nonsense introduce nothing rather than throwing', () => {
    assert.deepEqual(newTypesInWave(0), []);
    assert.deepEqual(newTypesInWave(-3), []);
    assert.deepEqual(newTypesInWave(Number.NaN), []);
  });

  test('a fractional wave reads as the wave it is inside', () => {
    assert.deepEqual(newTypesInWave(3.9), newTypesInWave(3));
  });
});

describe('announcementFor priority', () => {
  test('a lost run outranks the build phase and every wave', () => {
    // The heart dying mid-wave must not be narrated as "WAVE 9". This is the
    // one card the player is entitled to see immediately.
    for (const state of ['building', 'idle', 'spawning', 'engaged', 'breathing']) {
      const a = announcementFor(9, state, false, true);
      assert.ok(a !== null, state);
      assert.equal(a.kind, 'lost', state);
    }
  });

  test('a won run outranks the build phase and every wave', () => {
    for (const state of ['building', 'spawning', 'breathing']) {
      const a = announcementFor(13, state, true, false);
      assert.ok(a !== null, state);
      assert.equal(a.kind, 'won', state);
    }
  });

  test('the won card names how many waves were survived', () => {
    const a = announcementFor(13, 'breathing', true, false);
    assert.ok(a !== null);
    assert.match(a.title, /13 waves/);
  });

  test('lost wins over won when both are somehow set', () => {
    // world.ts can only set `won` with the heart alive, so both at once is a
    // bug elsewhere. Showing the death is the reading that is safe to be wrong.
    const a = announcementFor(5, 'engaged', true, true);
    assert.ok(a !== null);
    assert.equal(a.kind, 'lost');
  });

  test('the build phase outranks a wave card', () => {
    const a = announcementFor(0, 'building', false, false);
    assert.ok(a !== null);
    assert.equal(a.kind, 'build');
    assert.equal(a.title, 'BUILD');
  });
});

describe('announcementFor content', () => {
  test('a new-threat card beats a plain wave-start card for the same wave', () => {
    // Wave 7 revokes ramming — the roster's difficulty cliff. A player who is
    // told only "WAVE 7" learns it by losing the tank's free answer without
    // being told why.
    const a = announcementFor(7, 'spawning', false, false);
    assert.ok(a !== null);
    assert.equal(a.kind, 'threat');
    const drifter = ENEMY_BY_TYPE.get('drifter');
    assert.ok(drifter !== undefined);
    assert.ok(a.title.includes(drifter.label), a.title);
  });

  test('every introducing wave gets a threat card naming the spec label', () => {
    for (const intro of INTROS) {
      const a = announcementFor(intro.wave, 'spawning', false, false);
      assert.ok(a !== null, `wave ${intro.wave}`);
      assert.equal(a.kind, 'threat', `wave ${intro.wave}`);
      const spec = ENEMY_BY_TYPE.get(intro.type);
      assert.ok(spec !== undefined, intro.type);
      assert.ok(a.title.includes(spec.label), a.title);
      // The body must carry the role AND the help — the role says what it is,
      // the help says what it costs. A card with only one is half a lesson.
      assert.ok(a.body.includes(intro.role), a.body);
      assert.ok(a.body.includes(spec.help), a.body);
    }
  });

  test('a wave that introduces nothing falls back to WAVE N', () => {
    const last = INTROS[INTROS.length - 1];
    assert.ok(last !== undefined);
    const wave = last.wave + 2;
    const a = announcementFor(wave, 'spawning', false, false);
    assert.ok(a !== null);
    assert.equal(a.kind, 'wave');
    assert.equal(a.title, `WAVE ${wave}`);
  });

  test('nothing is announced before wave 1 outside the build phase', () => {
    assert.equal(announcementFor(0, 'idle', false, false), null);
    assert.equal(announcementFor(0, 'spawning', false, false), null);
  });
});

describe('formatCountdown', () => {
  test('never shows a negative number', () => {
    for (const s of [-0.001, -1, -60, Number.NEGATIVE_INFINITY]) {
      const out = formatCountdown(s);
      assert.ok(!out.includes('-'), `${s} -> ${out}`);
      assert.equal(out, '0s', String(s));
    }
  });

  test('non-finite input clamps instead of printing NaN', () => {
    assert.equal(formatCountdown(Number.NaN), '0s');
    assert.equal(formatCountdown(Number.POSITIVE_INFINITY), '0s');
  });

  test('rounds UP, so a second still on the clock is still shown', () => {
    // Ceil, not round: "0s" while build time remains is a lie told at the exact
    // moment it costs the player a tower.
    assert.equal(formatCountdown(0.1), '1s');
    assert.equal(formatCountdown(1), '1s');
    assert.equal(formatCountdown(1.2), '2s');
    assert.equal(formatCountdown(2.5), '3s');
    assert.equal(formatCountdown(9.99), '10s');
    assert.equal(formatCountdown(0), '0s');
  });

  test('counts down monotonically and reaches zero exactly once', () => {
    let prev = Number.POSITIVE_INFINITY;
    for (let t = 10; t >= -1; t -= 0.25) {
      const n = Number.parseInt(formatCountdown(t), 10);
      assert.ok(n >= 0, `${t} -> ${n}`);
      assert.ok(n <= prev, `${t}: ${n} > ${prev}`);
      prev = n;
    }
    assert.equal(prev, 0);
  });
});
