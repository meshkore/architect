/**
 * known-projects-delete.test.ts (AX17) — deleting a project is instant and
 * stays deleted while the daemon catches up.
 *
 * Regression: forget() waited for the daemon DELETE before scrubbing local
 * state, and discovery re-upserted the id while the daemon's /projects
 * table still listed it (~60s lag) — the dead row lingered, and clicking
 * it painted the previous project's stale data. Fix: optimistic local
 * eviction + a delete tombstone that vetoes re-upserts until it expires
 * or the daemon's authoritative table resurrects the id.
 */

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { forget, isDeleted, list, revive, upsert } from './known-projects.ts';

const DELETED_KEY = 'mc-deleted-projects-v1';

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

test('forget removes the row instantly and plants a tombstone', () => {
  add('meshcore'); add('zadelar');
  forget({ cluster_id: 'zadelar' });
  assert.deepEqual(ids(), ['meshcore']);
  assert.equal(isDeleted('zadelar'), true);
  assert.equal(isDeleted('meshcore'), false);
});

test('a tombstoned id cannot be re-upserted (daemon lag simulation)', () => {
  add('meshcore'); add('zadelar');
  forget({ cluster_id: 'zadelar' });
  // Discovery still sees the id on the daemon for ~60s and upserts…
  upsert({ port: 5573, base: 'https://daemon.meshkore.com:5573', cluster_id: 'zadelar' });
  upsert({ port: 5573, base: 'https://daemon.meshkore.com:5573', cluster_id: 'zadelar' });
  assert.deepEqual(ids(), ['meshcore']);
});

test('revive clears the tombstone so a re-created project returns', () => {
  add('zadelar');
  forget({ cluster_id: 'zadelar' });
  revive('zadelar');
  assert.equal(isDeleted('zadelar'), false);
  add('zadelar');
  assert.deepEqual(ids(), ['zadelar']);
});

test('an expired tombstone stops vetoing upserts', () => {
  installStorage();
  add('zadelar');
  forget({ cluster_id: 'zadelar' });
  // Backdate the tombstone past its TTL.
  localStorage.setItem(DELETED_KEY, JSON.stringify({ zadelar: new Date(Date.now() - 60 * 60 * 1000).toISOString() }));
  assert.equal(isDeleted('zadelar'), false);
  add('zadelar');
  assert.deepEqual(ids(), ['zadelar']);
});

test('forget by port only (no cluster_id) plants no tombstone', () => {
  upsert({ port: 5599, base: 'http://localhost:5599' });
  forget({ port: 5599 });
  assert.equal(isDeleted('port:5599'), false);
  assert.deepEqual(ids(), []);
});
