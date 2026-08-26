import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeTuning, LEVERS } from './store.ts';

test('defaults come from the schema', () => {
  const t = makeTuning();
  for (const l of LEVERS) assert.equal(t.get(l.key), l.value);
});

test('set clamps to range', () => {
  const t = makeTuning();
  t.set('enemy.speed', 999);
  assert.equal(t.get('enemy.speed'), 3.0);
  t.set('enemy.speed', -5);
  assert.equal(t.get('enemy.speed'), 0.2);
});

test('get on an unknown key throws (a typo must not silently read 0)', () => {
  const t = makeTuning();
  assert.throws(() => t.get('enemy.speeed'), /unknown lever/);
});

test('flag reads booleans', () => {
  const t = makeTuning();
  t.set('god.heartInvulnerable', 1);
  assert.equal(t.flag('god.heartInvulnerable'), true);
});

test('export/import round-trips exactly', () => {
  const a = makeTuning();
  a.set('enemy.speed', 1.7);
  a.set('wave.dripRate', 0.35);
  const b = makeTuning();
  b.import(a.export());
  assert.deepEqual(b.all(), a.all());
});

test('import ignores unknown keys and keeps defaults for missing ones', () => {
  const t = makeTuning();
  t.import('enemy.speed=1.5;bogus.key=9');
  assert.equal(t.get('enemy.speed'), 1.5);
  assert.equal(t.get('wave.size'), LEVERS.find((l) => l.key === 'wave.size')!.value);
});

test('reset restores defaults, optionally by group', () => {
  const t = makeTuning();
  t.set('enemy.speed', 2); t.set('wave.size', 30);
  t.reset('critters');
  assert.equal(t.get('enemy.speed'), LEVERS.find((l) => l.key === 'enemy.speed')!.value);
  assert.equal(t.get('wave.size'), 30, 'other groups untouched');
});

test('onChange fires and unsubscribes', () => {
  const t = makeTuning();
  const seen: string[] = [];
  const off = t.onChange((k) => seen.push(k));
  t.set('enemy.speed', 1.2);
  off();
  t.set('enemy.speed', 1.3);
  assert.deepEqual(seen, ['enemy.speed']);
});
