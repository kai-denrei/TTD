import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { makeEventBuffer } from './events.ts';
import type { WorldEvent } from './events.ts';

const impact = (d: number): WorldEvent => ({ kind: 'impact', at: [0, 1, 0], damage: d, source: 'tower' });

describe('event buffer', () => {
  test('drain returns what was emitted, then empties', () => {
    const b = makeEventBuffer();
    b.emit(impact(1));
    b.emit(impact(2));
    const out = b.drain();
    assert.equal(out.length, 2);
    assert.equal(b.length, 0);
    assert.deepEqual(b.drain(), []);
  });

  test('drain on an empty buffer returns an empty array', () => {
    assert.deepEqual(makeEventBuffer().drain(), []);
  });

  test('clear empties without returning', () => {
    const b = makeEventBuffer();
    b.emit(impact(1));
    b.clear();
    assert.equal(b.length, 0);
  });

  test('capacity is a hard ceiling — overflow drops rather than grows', () => {
    // A headless sweep has no renderer to drain this. Growing without bound
    // would be an allocation leak in the one path that must stay cheap.
    const b = makeEventBuffer(4);
    for (let i = 0; i < 1000; i++) b.emit(impact(i));
    assert.equal(b.length, 4, 'buffer grew past its capacity');
    assert.equal(b.drain().length, 4);
  });
});

// The leak this design exists to prevent: a headless run has no renderer, so
// nothing ever drains. The buffer must stay bounded anyway.
describe('event buffer inside a headless world', () => {
  test('3000 ticks with no drain leaves at most one tick of events', async () => {
    const { makeWorld } = await import('./world.ts');
    const { makeTuning } = await import('../tuning/store.ts');
    const { nearestFrontierWall } = await import('../sphere/dungeon.ts');
    const w = makeWorld({ seed: 42, tuning: makeTuning() });
    w.placeTower(nearestFrontierWall(w.mesh, w.dungeon, w.dungeon.heart));
    for (let i = 0; i < 3000; i++) {
      w.tick(1 / 60, { forward: 1, turn: 0.2, fire: true });
    }
    const drained = w.drainEvents();
    assert.ok(drained.length < 64, `buffer held ${drained.length} events after 3000 undrained ticks`);
  });
});
