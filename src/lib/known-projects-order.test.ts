/**
 * known-projects-order.test.ts (CN9) — the rail must keep stable creation
 * order and never re-sort on activity.
 *
 * Regression: list() sorted most-recent-first by last_seen, and every
 * project bind/discovery poll upserts (bumping last_seen), so clicking a
 * project jumped it to the top of the rail.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { list, upsert } from './known-projects.ts';
import { applyOrder } from '../components/projects-rail/order.ts';

// Minimal localStorage stub (known-projects/order touch it per call).
function installStorage(): void {
  const store = new Map<string, string>();
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => { store.set(k, v); },
    removeItem: (k: string) => { store.delete(k); },
  };
}

beforeEach(() => { installStorage(); });

function add(id: string): void {
  upsert({ port: 5573, base: 'https://daemon.meshkore.com:5573', cluster_id: id });
}

function ids(): (string | undefined)[] {
  return list().map((p) => p.cluster_id);
}

test('creation order is preserved: A, B, C stays A, B, C', () => {
  add('A'); add('B'); add('C');
  assert.deepEqual(ids(), ['A', 'B', 'C']);
});

test('re-upserting (clicking) B does NOT move it', () => {
  add('A'); add('B'); add('C');
  add('B'); // click / bind / discovery poll bumps last_seen
  assert.deepEqual(ids(), ['A', 'B', 'C']);
});

test('a brand-new project appends at the end', () => {
  add('A'); add('B'); add('B'); add('C');
  assert.deepEqual(ids(), ['A', 'B', 'C']);
});

test('applyOrder keeps unlisted rows in their stable position', () => {
  const rows = [{ key: 'A' }, { key: 'B' }, { key: 'C' }];
  assert.deepEqual(applyOrder(rows, []).map((r) => r.key), ['A', 'B', 'C']);
  assert.deepEqual(applyOrder(rows, ['C', 'A']).map((r) => r.key), ['C', 'A', 'B']);
});
