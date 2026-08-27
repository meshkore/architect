/**
 * queue.ts — the execution queue.
 *
 * 2026-06-19 reframe (operator): the queue is NOT a roadmap wall. It is
 * an ephemeral, client-side list of "what will run when I press Ejecutar
 * cola". Enqueuing/dequeuing an initiative does NOT change its status or
 * move it between walls — a queued item stays exactly where it lives
 * (only `active` items are queueable). Execute → it completes →
 * auto-archives. Reset just empties the list.
 *
 * Storage is per-project localStorage (the cockpit's own memory), keyed
 * by the project's CLUSTER ID. It is deliberately NOT the shared `next`
 * wall and NOT persisted into the .meshkore roadmap.
 *
 * Order = insertion order (the execution order). The list is deduped.
 *
 * FC-2 persistence fix (2026-06-28, round 2): the queue used to derive its
 * project key by READING daemonStore live (activeId / health.cluster_id). That
 * was racy during the centralized-daemon boot — at stage time the read could
 * return null, so writes went to the wrong key (or, after the null-guard, were
 * dropped) and a refresh read a different key → staged items vanished. Now the
 * App side-effect bus EXPLICITLY binds the active cluster via `bindCluster()`,
 * the SAME proven path viewStore/chatStore use — so the key is always the exact
 * cluster_id the rest of the per-project state uses. No daemonStore reads here.
 */

import { createRoot, createSignal } from 'solid-js';
import { log } from '~/lib/log';

const KEY_PREFIX = 'mc-exec-queue::';
const keyFor = (id: string | null): string => `${KEY_PREFIX}${id ?? 'default'}`;

function readRaw(key: string): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

const { cluster, setCluster, ids, setIds } = createRoot(() => {
  const [cluster, setCluster] = createSignal<string | null>(null);
  const [ids, setIds] = createSignal<string[]>([]);
  return { cluster, setCluster, ids, setIds };
});

function persist(id: string | null, list: string[]): void {
  try {
    localStorage.setItem(keyFor(id), JSON.stringify(list));
  } catch {
    /* quota / private mode */
  }
}

/**
 * Bind the active project (called from the App side-effect bus on every
 * connect/switch, with the SAME `health.cluster_id` viewStore/chatStore get).
 * Loads that project's persisted queue into memory. Idempotent: re-binding the
 * same cluster is a no-op so it never clobbers an in-session staged list.
 */
export function bindCluster(clusterId: string | null): void {
  if (clusterId === cluster()) return; // same project — keep the in-memory list
  setCluster(clusterId);
  setIds(readRaw(keyFor(clusterId)));
  log.debug('[queue] bound cluster', { cluster: clusterId, count: ids().length });
}

function write(next: string[]): void {
  setIds(next);
  persist(cluster(), next);
  log.debug('[queue] persisted', { cluster: cluster(), count: next.length });
}

/** The queued initiative ids, in execution (insertion) order. Reactive. */
export const queuedIds = (): string[] => ids();

/** Is this initiative in the execution queue? Reactive. */
export const isQueued = (id: string): boolean => ids().includes(id);

/** Append one initiative to the queue (no-op if already there). */
export function stageInitiative(id: string): void {
  if (ids().includes(id)) return;
  write([...ids(), id]);
}

/** Remove one initiative from the queue. Does NOT touch its status/wall. */
export function unstageInitiative(id: string): void {
  if (!ids().includes(id)) return;
  write(ids().filter((x) => x !== id));
}

/** Append many in order (skipping any already queued). */
export function stageAll(newIds: string[]): void {
  const have = new Set(ids());
  const add = newIds.filter((id) => !have.has(id));
  if (add.length === 0) return;
  write([...ids(), ...add]);
}

/** Empty the queue. Pure list operation — nothing on the roadmap moves. */
export function clearQueue(): void {
  if (ids().length === 0) return;
  write([]);
}

/** Replace the queue wholesale (used to prune ids that no longer apply,
 *  e.g. an initiative that finished and auto-archived). */
export function setQueue(next: string[]): void {
  write(next);
}

// ─── The queue VIEW ─────────────────────────────────────────────────

export interface QueueViewOptions<T extends { id: string }> {
  /** Every candidate, in roadmap order. */
  all: T[];
  /** Is an agent working on this initiative right now? */
  isLive: (id: string) => boolean;
  /** Was it just created (still inside its ✨NEW TTL)? Omit to exclude
   *  fresh-but-not-queued items — the run list wants only live ones. */
  isFresh?: (id: string) => boolean;
  /** Text filter. Omit to keep everything. */
  match?: (it: T) => boolean;
  /** Float imminent items (live or fresh) to the top. */
  floatImminent?: boolean;
}

/**
 * The queue as rendered and as executed — ONE derivation.
 *
 * Base order is the operator's insertion order. Items that are live but
 * NOT queued are appended so a running story stays visible instead of
 * vanishing from the wall it is running on. `floatImminent` then lifts
 * whatever is running-right-now or just-created to the top: before the
 * queue wall existed, that "fresh at the top" behaviour lived on the
 * ACTIVE roadmap and was lost when the queue became the execution view.
 * The sort is stable, so within-band order (queued-insertion, then
 * appended) survives.
 *
 * Reactive — reads the queue signal.
 */
export function queueView<T extends { id: string }>(o: QueueViewOptions<T>): T[] {
  const order = ids();
  const inQ = new Set(order);
  const byId = new Map(o.all.map((it) => [it.id, it] as const));
  const seen = new Set<string>();
  const out: T[] = [];
  const add = (it: T | undefined): void => {
    if (!it || seen.has(it.id)) return;
    if (o.match && !o.match(it)) return;
    seen.add(it.id);
    out.push(it);
  };

  for (const id of order) add(byId.get(id));
  for (const it of o.all) {
    if (inQ.has(it.id)) continue;
    if (o.isLive(it.id) || (o.isFresh?.(it.id) ?? false)) add(it);
  }

  if (!o.floatImminent) return out;
  const imminent = (it: T): boolean => o.isLive(it.id) || (o.isFresh?.(it.id) ?? false);
  return out.slice().sort((a, b) => Number(imminent(b)) - Number(imminent(a)));
}
