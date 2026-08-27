/**
 * snapshot-trim.test.ts — the rules that keep the boot cache from
 * becoming the bug it is supposed to prevent.
 *
 * Two failure modes matter. Writing markdown bodies would blow the
 * localStorage quota on any real cluster (and the boot audit would be
 * the only thing standing between the operator and a wedged tab).
 * Writing a payload that still exceeds the budget is worse than not
 * caching at all — a throw inside the boot path is exactly what AX7
 * must never introduce.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SNAPSHOT_CACHE_BUDGET,
  evictionVictims,
  isCachedSnapshot,
  packSnapshot,
  trimChatSnapshot,
  trimServerSnapshot,
} from './snapshot-trim.ts';

const serverSnapshot = {
  cluster: { id: 'meshkore-main', name: 'MeshKore' },
  generated_at: '2026-08-27T10:00:00Z',
  docs: { tree: 'x'.repeat(5000) },
  modules: [
    { id: 'architect', name: 'Architect', tasks: [{ id: 'AX7', title: 'Boot', body: 'y'.repeat(4000) }] },
  ],
  roadmap: {
    tasks: [{ id: 'AX7', title: 'Boot', status: 'doing', body: 'z'.repeat(9000) }],
    stats: { done: 6 },
  },
  initiatives: [{ id: 'cockpit-excellence', title: 'Cockpit', body: 'w'.repeat(9000) }],
};

const chatSnapshot = {
  convs: [
    {
      conv: 'master',
      agent_id: 'master',
      live: true,
      archived: false,
      msg_count: 12,
      current_turn: { stream_id: 's1', partial_text: 'p'.repeat(9000) },
      queue: [{ id: 'q1', text: 'later' }],
    },
  ],
  version: 'py-1.34.0',
  generated_at: '2026-08-27T10:00:01Z',
  debug: { enabled: false },
};

test('no markdown body survives the trim', () => {
  const trimmed = trimServerSnapshot(serverSnapshot) as Record<string, never>;
  const json = JSON.stringify(trimmed);
  assert.ok(!json.includes('zzz'), 'task body leaked into the cache');
  assert.ok(!json.includes('www'), 'initiative body leaked into the cache');
  assert.ok(!json.includes('yyy'), 'module task body leaked into the cache');
  // `docs` is a whole tree the knowledge zone refetches anyway.
  assert.equal('docs' in trimmed, false);
});

test('the trim keeps everything a roadmap row renders from', () => {
  const trimmed = trimServerSnapshot(serverSnapshot) as {
    roadmap: { tasks: Array<Record<string, unknown>>; stats: unknown };
    initiatives: Array<Record<string, unknown>>;
    cluster: unknown;
  };
  assert.deepEqual(trimmed.roadmap.tasks[0], { id: 'AX7', title: 'Boot', status: 'doing' });
  assert.deepEqual(trimmed.roadmap.stats, { done: 6 });
  assert.equal(trimmed.initiatives[0]?.id, 'cockpit-excellence');
  assert.deepEqual(trimmed.cluster, { id: 'meshkore-main', name: 'MeshKore' });
});

test('a cached conv carries no in-flight turn to resurrect', () => {
  const trimmed = trimChatSnapshot(chatSnapshot) as { convs: Array<Record<string, unknown>> };
  const conv = trimmed.convs[0]!;
  assert.equal('current_turn' in conv, false);
  assert.equal('queue' in conv, false);
  // The summary itself is what the agents rail paints — it stays whole.
  assert.equal(conv.conv, 'master');
  assert.equal(conv.msg_count, 12);
});

test('a payload within budget is cached at stage 0', () => {
  const packed = packSnapshot(serverSnapshot, chatSnapshot, 1000);
  assert.ok(packed);
  assert.equal(packed.envelope.stage, 0);
  assert.equal(packed.envelope.saved_at, 1000);
  assert.ok(packed.json.length <= SNAPSHOT_CACHE_BUDGET);
});

test('over budget degrades instead of caching nothing', () => {
  const fat = {
    ...serverSnapshot,
    modules: [{ id: 'big', tasks: [{ id: 'T1', title: 'x'.repeat(4000) }] }],
  };
  // A budget that fits the chat + roadmap but not the module tree.
  const packed = packSnapshot(fat, chatSnapshot, 1, 2500);
  assert.ok(packed, 'should have degraded rather than given up');
  assert.ok(packed.json.length <= 2500);
  assert.ok(packed.envelope.stage > 0);
  assert.ok(packed.envelope.chat, 'chat is the last thing to be dropped');
});

test('a long conv history is capped before the roadmap is sacrificed', () => {
  // The cockpit's own cluster: hundreds of mostly-archived convs that
  // would otherwise consume the entire budget on their own.
  const convs = Array.from({ length: 400 }, (_, i) => ({
    conv: `agent-${i}`,
    live: false,
    archived: true,
    last_activity_at: `2026-01-${String((i % 28) + 1).padStart(2, '0')}T00:00:00Z`,
    filler: 'f'.repeat(200),
  }));
  convs.push({
    conv: 'working-right-now',
    live: true,
    archived: false,
    last_activity_at: '2020-01-01T00:00:00Z', // oldest timestamp on purpose
    filler: '',
  });
  const packed = packSnapshot(serverSnapshot, { convs }, 1, 40_000);
  assert.ok(packed);
  const cached = (packed.envelope.chat as { convs: Array<{ conv: string }> }).convs;
  assert.ok(cached.length <= 120, `capped, got ${cached.length}`);
  assert.ok(cached.some((c) => c.conv === 'working-right-now'), 'a live conv is never capped away');
  assert.ok(packed.envelope.server, 'the roadmap survived the conv cap');
});

test('a payload that cannot fit at any stage is not cached', () => {
  const huge = { convs: [{ conv: 'c', note: 'x'.repeat(5000) }] };
  assert.equal(packSnapshot(null, huge, 1, 500), null);
});

test('nothing to cache is not an empty cache entry', () => {
  assert.equal(packSnapshot(null, null, 1), null);
  assert.equal(packSnapshot('not an object', undefined, 1), null);
});

test('only a same-version envelope is trusted on read', () => {
  const packed = packSnapshot(serverSnapshot, chatSnapshot, 1);
  assert.ok(packed);
  assert.equal(isCachedSnapshot(JSON.parse(packed.json)), true);
  assert.equal(isCachedSnapshot({ ...packed.envelope, v: 99 }), false);
  assert.equal(isCachedSnapshot({ v: 1, server: null, chat: null }), false); // no saved_at
  assert.equal(isCachedSnapshot(null), false);
  assert.equal(isCachedSnapshot('{}'), false);
});

test('eviction keeps the newest clusters and no more', () => {
  const entries = [
    { key: 'a', savedAt: 10 },
    { key: 'b', savedAt: 40 },
    { key: 'c', savedAt: 20 },
    { key: 'd', savedAt: 30 },
  ];
  assert.deepEqual(evictionVictims(entries, 2).sort(), ['a', 'c']);
  assert.deepEqual(evictionVictims(entries, 4), []);
  assert.deepEqual(evictionVictims(entries, 9), []);
  // An unparseable entry sorts oldest (savedAt 0) and goes first.
  assert.deepEqual(evictionVictims([...entries, { key: 'junk', savedAt: 0 }], 4), ['junk']);
});
