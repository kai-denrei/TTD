// sound.test.ts — the rate limiter, tested without an AudioContext.
//
// There is no Web Audio in Node, and that is exactly why the limiter lives in
// pure functions: the part of this module that can destroy the frame budget is
// the part that has nothing to do with audio. Nothing here constructs a
// context — importing the module must be side-effect free.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  throttle,
  capTotal,
  collapseGain,
  countKinds,
  accumulate,
  PER_WINDOW_CAPS,
  PRIORITY,
  DEFAULT_CAP,
  MAX_VOICES_PER_WINDOW,
  MAX_PENDING,
  makeSound,
} from './sound.ts';
import type { WorldEvent } from '../core/sim/events.ts';

const CAPS: Record<string, number> = { ...PER_WINDOW_CAPS };

function repeat(kind: string, n: number): string[] {
  return Array.from({ length: n }, () => kind);
}

test('empty input yields empty output', () => {
  assert.deepEqual(throttle([], CAPS), []);
  assert.deepEqual(capTotal([], MAX_VOICES_PER_WINDOW, PRIORITY), []);
  assert.equal(countKinds([]).size, 0);
});

test('N identical events collapse to at most the cap', () => {
  // The mortar-splash case: eight critters hit by one shell in one tick.
  const out = throttle(repeat('impact', 8), CAPS);
  assert.equal(out.length, PER_WINDOW_CAPS.impact);
  assert.ok(out.every((k) => k === 'impact'));
});

test('every configured kind is capped at its own number, however many arrive', () => {
  for (const [kind, cap] of Object.entries(PER_WINDOW_CAPS)) {
    const out = throttle(repeat(kind, 60), CAPS);
    assert.equal(out.length, cap, `${kind} should collapse 60 events to ${cap}`);
  }
});

test('kinds are limited independently of one another', () => {
  const kinds = [...repeat('impact', 10), ...repeat('heartHit', 10), ...repeat('shotFired', 10)];
  const out = throttle(kinds, CAPS);
  const counts = countKinds(out);
  assert.equal(counts.get('impact'), PER_WINDOW_CAPS.impact);
  assert.equal(counts.get('heartHit'), PER_WINDOW_CAPS.heartHit);
  assert.equal(counts.get('shotFired'), PER_WINDOW_CAPS.shotFired);
  // Exhausting one kind must not consume another kind's budget.
  assert.equal(out.length, PER_WINDOW_CAPS.impact + PER_WINDOW_CAPS.heartHit + PER_WINDOW_CAPS.shotFired);
});

test('a kind with no configured cap is limited by DEFAULT_CAP, not unlimited', () => {
  const out = throttle(repeat('mysteryBang', 40), {});
  assert.equal(out.length, DEFAULT_CAP);
  assert.ok(out.length < 40, 'an unbudgeted kind must never pass through unlimited');
});

test('a partial caps table still defaults the kinds it omits', () => {
  const out = throttle([...repeat('impact', 9), ...repeat('mysteryBang', 9)], { impact: 3 });
  assert.equal(countKinds(out).get('impact'), 3);
  assert.equal(countKinds(out).get('mysteryBang'), DEFAULT_CAP);
});

test('throttle never invents events and preserves arrival order', () => {
  const out = throttle(['shotFired', 'impact', 'shotFired', 'critterDied'], CAPS);
  assert.deepEqual(out, ['shotFired', 'impact', 'shotFired', 'critterDied']);
});

test('a cap of zero silences a kind entirely', () => {
  assert.deepEqual(throttle(repeat('beam', 5), { beam: 0 }), []);
});

test('the global ceiling keeps the highest-priority voices', () => {
  // A busy frame: lots of cheap noise plus the two signals that actually matter.
  const kinds = [...repeat('shotFired', 6), ...repeat('impact', 6), 'heartHit', 'tankHit'];
  const kept = capTotal(throttle(kinds, CAPS), MAX_VOICES_PER_WINDOW, PRIORITY);
  assert.equal(kept.length, MAX_VOICES_PER_WINDOW);
  assert.ok(kept.includes('heartHit'), 'heartHit must never be starved by shot spam');
  assert.ok(kept.includes('tankHit'), 'tankHit must never be starved by shot spam');
});

test('the global ceiling is a no-op below the ceiling', () => {
  const kinds = ['beam', 'impact'];
  assert.deepEqual(capTotal(kinds, MAX_VOICES_PER_WINDOW, PRIORITY), kinds);
});

test('collapseGain is sub-linear and bounded', () => {
  assert.equal(collapseGain(1, 1), 1);
  assert.equal(collapseGain(3, 5), 1, 'fewer events than voices is never a boost');
  const eight = collapseGain(8, 3);
  assert.ok(eight > 1 && eight < 2, `boost should be a nudge, got ${eight}`);
  assert.ok(collapseGain(400, 3) <= 1.7, 'boost must saturate, not scale with the burst');
  assert.ok(collapseGain(20, 3) >= collapseGain(8, 3), 'bigger burst is never quieter');
});

test('the caps table covers every kind the world can emit', () => {
  // Mirrors the WorldEvent union in core/sim/events.ts. If a variant is added
  // there and not given a voice, PER_WINDOW_CAPS stops type-checking — this
  // test is the runtime half of that guard.
  for (const kind of ['shotFired', 'beam', 'impact', 'critterDied', 'heartHit', 'tankHit']) {
    assert.ok(kind in PER_WINDOW_CAPS, `${kind} has no configured cap`);
  }
});

test('the pending window is bounded — overflow is dropped, never accumulated', () => {
  // A whole run's worth of events fed in without a flush. If this ever grows
  // without limit it is a leak that only shows up in a long session, on the one
  // path that must stay cheap. Sabotage check: replacing MAX_PENDING with
  // Infinity here fails this test (and only this test).
  const pending: string[] = [];
  const burst: WorldEvent[] = Array.from({ length: 500 }, () => ({
    kind: 'impact' as const,
    at: [0, 0, 0] as [number, number, number],
    damage: 1,
    source: 'tower' as const,
  }));
  for (let i = 0; i < 200; i++) accumulate(pending, burst, MAX_PENDING);
  assert.equal(pending.length, MAX_PENDING);
  // ...and it still collapses to a handful of voices at the far end.
  const kept = capTotal(throttle(pending, CAPS), MAX_VOICES_PER_WINDOW, PRIORITY);
  assert.ok(kept.length <= MAX_VOICES_PER_WINDOW, `100k events became ${kept.length} voices`);
});

test('accumulate stops exactly at the limit mid-batch', () => {
  const pending = ['beam', 'beam'];
  const events: WorldEvent[] = [
    { kind: 'heartHit', at: [0, 0, 0] },
    { kind: 'tankHit', at: [0, 0, 0] },
  ];
  accumulate(pending, events, 3);
  assert.deepEqual(pending, ['beam', 'beam', 'heartHit']);
});

test('play() before resume() is a silent no-op and never throws', () => {
  // No AudioContext exists in Node, so this also covers the "unsupported
  // environment" path: makeSound() must construct, report not-ready, and
  // swallow a whole run's worth of events without complaint.
  const sound = makeSound();
  assert.equal(sound.ready, false);
  for (let i = 0; i < 5000; i++) {
    sound.play([
      { kind: 'heartHit', at: [0, 0, 0] },
      { kind: 'tankHit', at: [0, 0, 0] },
      { kind: 'impact', at: [0, 0, 0], damage: 3, source: 'tower' },
    ]);
  }
  sound.setMuted(true);
  sound.setVolume(0.3);
  sound.play([]);
  assert.equal(sound.ready, false);
});

test('resume() in an environment without Web Audio resolves and stays not-ready', async () => {
  const sound = makeSound();
  await sound.resume();
  assert.equal(sound.ready, false);
});
