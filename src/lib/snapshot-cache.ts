/**
 * snapshot-cache.ts — AX7 (UX-F4). The persistent half of the boot
 * cache: `mc-snap-v1::<cluster_id>` in localStorage.
 *
 * AX3 made a project the operator visited EARLIER THIS SESSION paint
 * instantly on switch-back, from an in-memory slice. A page reload
 * throws that away, so a cold boot still sat on the BootingPanel until
 * `/state` and `/chat/snapshot` came back. This module is the same idea
 * across a reload: the last snapshots are written to localStorage
 * (debounced, size-capped, bodies stripped — see `snapshot-trim.ts`) and
 * replayed at bind time, marked STALE, before the network lands.
 *
 * Two invariants:
 *   • Fresh always wins. Nothing here writes into a store; the caller
 *     (`lib/cluster-bind`) replays a cached payload only into a slice
 *     that is still empty, and the daemon's response overwrites it.
 *   • A failed write is never fatal. Quota exceeded, private mode,
 *     disabled storage — all degrade to "no cache", never to a broken
 *     boot.
 *
 * The prefix is registered in `lib/storage-audit.ts`; without that the
 * boot audit drops these keys on sight (that allowlist is the project
 * rule for every per-cluster key).
 */

import { log } from '~/lib/log';
import {
  SNAPSHOT_CACHE_MAX_CLUSTERS,
  evictionVictims,
  isCachedSnapshot,
  packSnapshot,
  type CachedSnapshotEnvelope,
} from '~/lib/snapshot-trim';

export const SNAPSHOT_CACHE_PREFIX = 'mc-snap-v1::';

/**
 * Debounce before a write. Long enough that a boot's `/state` +
 * `/chat/snapshot` + the WS `state.rebuilt` burst that usually follows
 * collapse into ONE serialization, short enough that closing the tab a
 * couple of seconds after landing still leaves a usable cache.
 */
const WRITE_DEBOUNCE_MS = 1500;

/** Cached payloads older than this are ignored — the roadmap has moved
 *  on and a week-old rail is more confusing than a spinner. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

interface Pending {
  server?: unknown;
  chat?: unknown;
}

const pending = new Map<string, Pending>();
let timer: ReturnType<typeof setTimeout> | null = null;
/** Set once a write fails for a reason retrying can't fix (quota, no
 *  storage). We stop trying rather than burn a serialization per boot. */
let disabled = false;

function keyFor(clusterId: string): string {
  return SNAPSHOT_CACHE_PREFIX + clusterId;
}

/** Read one cluster's cached snapshots. Null when absent, unreadable,
 *  from an older cache version, or past `MAX_AGE_MS`. */
export function readCachedSnapshot(clusterId: string | null): CachedSnapshotEnvelope | null {
  if (!clusterId) return null;
  try {
    const raw = localStorage.getItem(keyFor(clusterId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!isCachedSnapshot(parsed)) return null;
    if (Date.now() - parsed.saved_at > MAX_AGE_MS) {
      localStorage.removeItem(keyFor(clusterId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Queue this cluster's latest `/state` payload for the next write. */
export function stageServerSnapshot(clusterId: string | null, snapshot: unknown): void {
  if (!clusterId || disabled || !snapshot) return;
  const slot = pending.get(clusterId) ?? {};
  slot.server = snapshot;
  pending.set(clusterId, slot);
  schedule();
}

/** Queue this cluster's latest `/chat/snapshot` payload for the next write. */
export function stageChatSnapshot(clusterId: string | null, snapshot: unknown): void {
  if (!clusterId || disabled || !snapshot) return;
  const slot = pending.get(clusterId) ?? {};
  slot.chat = snapshot;
  pending.set(clusterId, slot);
  schedule();
}

function schedule(): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    flushSnapshotCache();
  }, WRITE_DEBOUNCE_MS);
}

/** Write every staged cluster now. Idempotent; safe to call with nothing
 *  staged. Exposed so a shutdown path can force the last write out. */
export function flushSnapshotCache(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
  if (disabled || pending.size === 0) return;
  const staged = [...pending.entries()];
  pending.clear();
  for (const [clusterId, slot] of staged) {
    // A cluster whose chat snapshot landed but whose /state did not (or
    // vice-versa) must not erase the half we already have on disk.
    const prior = readCachedSnapshot(clusterId);
    const packed = packSnapshot(
      slot.server ?? prior?.server ?? null,
      slot.chat ?? prior?.chat ?? null,
      Date.now(),
    );
    if (!packed) {
      log.debug('[snapshot-cache] payload over budget at every stage — not cached', { clusterId });
      continue;
    }
    try {
      localStorage.setItem(keyFor(clusterId), packed.json);
    } catch (e) {
      // Quota is the expected failure. Evict everything else we own and
      // retry once; if that still fails, this browser gets no cache.
      evictAllExcept(clusterId);
      try {
        localStorage.setItem(keyFor(clusterId), packed.json);
      } catch {
        disabled = true;
        log.warn('[snapshot-cache] write refused — boot cache disabled for this session', {
          clusterId,
          reason: e instanceof Error ? e.name : String(e),
        });
        return;
      }
    }
  }
  evictOldClusters();
}

function ownedKeys(): string[] {
  try {
    return Object.keys(localStorage).filter((k) => k.startsWith(SNAPSHOT_CACHE_PREFIX));
  } catch {
    return [];
  }
}

function drop(keys: readonly string[]): void {
  for (const k of keys) {
    try { localStorage.removeItem(k); } catch { /* best effort */ }
  }
}

function evictAllExcept(clusterId: string): void {
  drop(ownedKeys().filter((k) => k !== keyFor(clusterId)));
}

/** Keep the newest `SNAPSHOT_CACHE_MAX_CLUSTERS`; drop the rest. */
function evictOldClusters(): void {
  const entries: Array<{ key: string; savedAt: number }> = [];
  for (const key of ownedKeys()) {
    let savedAt = 0;
    try {
      const parsed: unknown = JSON.parse(localStorage.getItem(key) ?? 'null');
      if (isCachedSnapshot(parsed)) savedAt = parsed.saved_at;
    } catch { /* unparseable → oldest, evicted first */ }
    entries.push({ key, savedAt });
  }
  const victims = evictionVictims(entries, SNAPSHOT_CACHE_MAX_CLUSTERS);
  if (victims.length === 0) return;
  drop(victims);
  log.debug('[snapshot-cache] evicted least-recent clusters', { count: victims.length });
}

/** Forget one cluster's cache (Forget-project flow). */
export function clearCachedSnapshot(clusterId: string): void {
  pending.delete(clusterId);
  drop([keyFor(clusterId)]);
}
