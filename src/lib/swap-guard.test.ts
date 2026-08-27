/**
 * swap-guard.test.ts — the A -> B -> A case a plain id check misses.
 *
 * Guarding on cluster id alone looks correct and passes the obvious
 * test (A's late response is dropped while B is active). It fails the
 * one that matters: by the time A's FIRST request resolves, the
 * operator may be back in A, so the check passes and a stale payload
 * overwrites the newer one. That is why the guard is an epoch.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  bumpClusterEpoch,
  captureClusterEpoch,
  isCurrentEpoch,
  withClusterGuard,
} from './swap-guard.ts';

test('a capture taken in the current visit stays valid', () => {
  bumpClusterEpoch('A');
  const token = captureClusterEpoch();
  assert.equal(isCurrentEpoch(token), true);
});

test('switching away invalidates an in-flight capture', () => {
  bumpClusterEpoch('A');
  const token = captureClusterEpoch();
  bumpClusterEpoch('B');
  assert.equal(isCurrentEpoch(token), false);
});

test('A -> B -> A: the first visit\'s capture does NOT come back to life', () => {
  bumpClusterEpoch('A');
  const firstVisit = captureClusterEpoch();
  bumpClusterEpoch('B');
  bumpClusterEpoch('A');           // same cluster id, new visit
  const secondVisit = captureClusterEpoch();

  // An id-only guard would accept `firstVisit` here — that is the bug.
  assert.equal(isCurrentEpoch(firstVisit), false);
  assert.equal(isCurrentEpoch(secondVisit), true);
});

test('withClusterGuard applies a result that is still current', async () => {
  bumpClusterEpoch('A');
  let applied: string | null = null;
  const out = await withClusterGuard(async () => 'roster-A', (v) => { applied = v; });
  assert.equal(applied, 'roster-A');
  assert.equal(out, 'roster-A');
});

test('withClusterGuard drops a result the operator has moved past', async () => {
  bumpClusterEpoch('A');
  let applied: string | null = null;
  const out = await withClusterGuard(
    async () => {
      // The switch happens while the request is in flight — exactly the
      // sequence that put project A's team roster on project B's screen.
      bumpClusterEpoch('B');
      return 'roster-A';
    },
    (v) => { applied = v; },
  );
  assert.equal(applied, null);
  assert.equal(out, undefined);
});
