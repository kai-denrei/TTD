import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { shouldOpenAdmin, nextAdminStorage } from './gate.ts';

describe('admin gate resolution', () => {
  test('closed by default', () => {
    assert.equal(shouldOpenAdmin('', null), false);
  });
  test('?admin=1 opens it', () => {
    assert.equal(shouldOpenAdmin('?admin=1', null), true);
  });
  test('a stored flag keeps it open across reloads', () => {
    assert.equal(shouldOpenAdmin('', '1'), true);
  });
  test('?admin=0 overrides a stored flag', () => {
    assert.equal(shouldOpenAdmin('?admin=0', '1'), false);
  });
  test('?admin=1 persists; ?admin=0 clears', () => {
    assert.equal(nextAdminStorage('?admin=1', null), '1');
    assert.equal(nextAdminStorage('?admin=0', '1'), null);
  });
  test('an absent param leaves storage untouched', () => {
    assert.equal(nextAdminStorage('', '1'), '1');
    assert.equal(nextAdminStorage('', null), null);
  });
  test('other params are ignored', () => {
    assert.equal(shouldOpenAdmin('?preset=enemy.speed%3D2', null), false);
  });
});
