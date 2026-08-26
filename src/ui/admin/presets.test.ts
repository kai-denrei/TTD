import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePresetParam, readBook, writeBook, savePreset, deletePreset } from './presets.ts';
import { makeTuning } from '../../core/tuning/store.ts';

describe('preset URL param', () => {
  test('absent yields null', () => {
    assert.equal(parsePresetParam(''), null);
    assert.equal(parsePresetParam('?admin=1'), null);
  });
  test('decodes a URL-encoded preset', () => {
    assert.equal(parsePresetParam('?preset=enemy.speed%3D2%3Bwave.gap%3D3'), 'enemy.speed=2;wave.gap=3');
  });
});

describe('preset book storage', () => {
  test('a missing or corrupt store yields an empty book rather than throwing', () => {
    assert.deepEqual(readBook(null), {});
    assert.deepEqual(readBook('not json at all'), {});
    assert.deepEqual(readBook('[1,2,3]'), {}, 'a non-object JSON value must not become a book');
  });
  test('save then read round-trips', () => {
    assert.deepEqual(readBook(writeBook(savePreset({}, 'brutal', 'enemy.speed=2.5'))), { brutal: 'enemy.speed=2.5' });
  });
  test('saving the same name overwrites', () => {
    assert.deepEqual(savePreset(savePreset({}, 'a', 'x=1'), 'a', 'x=2'), { a: 'x=2' });
  });
  test('delete removes one entry and leaves the rest', () => {
    assert.deepEqual(deletePreset(savePreset(savePreset({}, 'a', 'x=1'), 'b', 'y=2'), 'a'), { b: 'y=2' });
  });
});

describe('preset round-trip through the tuning store', () => {
  test('export then import restores every value', () => {
    const a = makeTuning();
    a.set('enemy.speed', 2.5);
    a.set('wave.gap', 3);
    a.set('god.heartInvulnerable', 1);
    const b = makeTuning();
    b.import(a.export());
    assert.equal(b.export(), a.export());
  });
  test('an unknown key is ignored rather than throwing', () => {
    const t = makeTuning();
    const before = t.export();
    t.import('not.a.lever=9;enemy.speed=1.5');
    assert.equal(t.get('enemy.speed'), 1.5);
    assert.notEqual(t.export(), before);
  });
});
