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
 * by the active project's CLUSTER ID. It is deliberately NOT the shared
 * `next` wall and NOT persisted into the .meshkore roadmap.
 *
 * Order = insertion order (the execution order). The list is deduped.
 *
 * FC-2 persistence hardening (2026-06-28): the queue was keyed by
 * `daemonStore.state.activeId` and RELOADED on every change of it. In the
 * centralized-daemon boot the active id can briefly be null / flip while the
 * connection settles, and the reload-on-change clobbered a freshly-staged list
 * with an empty load — so staged items vanished on refresh. Now:
 *   • the key is the active CLUSTER ID (stable per project),
 *   • we only reload when the project key CHANGES to a real, different value
 *     (a transient null never clobbers),
 *   • writes never persist under a null key,
 *   • a one-time migration pulls a legacy `activeId`-keyed list forward.
 */

import { createEffect, createRoot, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';

const KEY_PREFIX = 'mc-exec-queue::';
const keyFor = (id: string | null): string => `${KEY_PREFIX}${id ?? 'default'}`;

/** The active project's stable id — prefer the connected instance's
 *  cluster_id, fall back to the daemon store's activeId (same value in
 *  practice; both resolve to the cluster id). Null until connected. */
function activeProjectId(): string | null {
  const cid = daemonStore.state.health?.cluster_id;
  if (cid && cid.trim()) return cid.trim();
  const aid = daemonStore.state.activeId;
  return aid && aid.trim() ? aid.trim() : null;
}

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

function load(id: string | null): string[] {
  return readRaw(keyFor(id));
}

function persist(id: string | null, ids: string[]): void {
  if (!id) return; // never persist under the null/"default" key — would split state
  try {
    localStorage.setItem(keyFor(id), JSON.stringify(ids));
  } catch {
    /* quota */
  }
}

const { ids, setIds } = createRoot(() => {
  const initial = activeProjectId();
  const [ids, setIds] = createSignal<string[]>(load(initial));
  // Track which project the in-memory list belongs to, so we ONLY reload on a
  // genuine project change — never on a transient null/flip during boot.
  let loadedFor: string | null = initial;
  createEffect(() => {
    const id = activeProjectId();
    if (!id) return; // not connected yet / transient — keep what we have
    if (id === loadedFor) return; // same project — don't clobber
    loadedFor = id;
    setIds(load(id));
    log.debug('[queue] loaded for project', { project: id, count: ids().length });
  });
  return { ids, setIds };
});

function write(next: string[]): void {
  setIds(next);
  const id = activeProjectId();
  persist(id, next);
  log.debug('[queue] persisted', { project: id, count: next.length });
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
