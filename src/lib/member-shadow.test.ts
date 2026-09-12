/**
 * member-shadow.test.ts — ATM14. Pinned conv overrides shadow the member file.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { findShadowedConvs, isPinnedOverride } from './member-shadow.ts';

test('auto/default/empty follow the member — not shadowed', () => {
  assert.equal(isPinnedOverride('auto', 'default'), false);
  assert.equal(isPinnedOverride(undefined, undefined), false);
  assert.equal(isPinnedOverride('', ''), false);
});

test('a pinned model shadows the member file', () => {
  assert.equal(isPinnedOverride('opus', 'default'), true);
});

test('a pinned effort shadows the member file', () => {
  assert.equal(isPinnedOverride('auto', 'high'), true);
});

test('findShadowedConvs only returns bound, live, pinned convs', () => {
  const convMeta = {
    'conv-pinned': { member: 'architect-master', model: 'opus', effort: 'default' },
    'conv-follow': { member: 'architect-master', model: 'auto', effort: 'default' },
    'conv-other': { member: 'developer', model: 'opus', effort: 'default' },
    'conv-archived': { member: 'architect-master', model: 'opus', effort: 'default' },
    'conv-unbound': { model: 'opus', effort: 'default' },
  };
  const found = findShadowedConvs(convMeta, { 'conv-archived': true }, 'architect-master');
  assert.deepEqual(found, ['conv-pinned']);
});
