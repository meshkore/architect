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
 * by the active daemon id. It is deliberately NOT the shared `next` wall
 * and NOT persisted into the .meshkore roadmap — earlier the queue WAS
 * the next wall (v26); that conflated "queued to run" with the roadmap
 * status and is reverted here.
 *
 * Order = insertion order (the execution order). The list is deduped.
 */

import { createEffect, createRoot, createSignal } from 'solid-js';
import { daemonStore } from '~/state/daemon';

const KEY_PREFIX = 'mc-exec-queue::';
const keyFor = (id: string | null): string => `${KEY_PREFIX}${id ?? 'default'}`;

function load(id: string | null): string[] {
  try {
    const raw = localStorage.getItem(keyFor(id));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

function persist(id: string | null, ids: string[]): void {
  try { localStorage.setItem(keyFor(id), JSON.stringify(ids)); } catch { /* quota */ }
}

const { ids, setIds } = createRoot(() => {
  const [ids, setIds] = createSignal<string[]>(load(daemonStore.state.activeId));
  // Reload the queue when the active project changes (per-project memory).
  createEffect(() => {
    const id = daemonStore.state.activeId;
    setIds(load(id));
  });
  return { ids, setIds };
});

function write(next: string[]): void {
  setIds(next);
  persist(daemonStore.state.activeId, next);
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
