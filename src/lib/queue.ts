/**
 * queue.ts — execution-queue staging, backed by the SHARED .meshkore
 * storage (NOT cockpit localStorage), so a Claude Code terminal reading
 * the MeshKore standard sees the exact same queue.
 *
 * The queue IS the `next` wall (standard §: status⇄wall). Staging an
 * initiative = moving it to the `next` wall via POST /initiative/reorder,
 * which the daemon persists as `status: next` + `wall_order` on the .md
 * and broadcasts (walls.py). The lifecycle is:
 *
 *   backlog/active ──stage──▶ next (queued) ──architect picks up──▶
 *   active (running) ──done──▶ archived
 *
 * A CLI agent consumes the queue by reading `wall: next` ordered by
 * `wall_order` ascending — see
 * `.meshkore/docs/conventions/execution-queue-protocol.md`.
 */

import { daemonStore } from '~/state/daemon';
import { allInitiatives } from '~/state/server';
import { log } from './log';

/** True when an initiative is staged (sits in the `next` wall). */
export function isQueuedStatus(status?: string): boolean {
  return (status ?? '').toLowerCase() === 'next';
}

/** How many initiatives are currently in the `next` wall — the append
 *  position for a freshly-staged item. */
function nextWallCount(): number {
  return allInitiatives().filter((it) => isQueuedStatus(it.status)).length;
}

/** Stage one initiative — append to the end of the `next` wall. */
export async function stageInitiative(id: string): Promise<void> {
  const client = daemonStore.state.client;
  if (!client) return;
  const res = await client.initiativeReorder(id, 'next', nextWallCount());
  if (!res.ok) log.warn('[queue] stage failed', { id, status: res.status });
}

/** Un-stage one initiative — back to the operative `active` wall. */
export async function unstageInitiative(id: string): Promise<void> {
  const client = daemonStore.state.client;
  if (!client) return;
  const res = await client.initiativeReorder(id, 'active', 0);
  if (!res.ok) log.warn('[queue] unstage failed', { id, status: res.status });
}

/** Stage many initiatives in order (RUN ALL → fill the queue). Sequential
 *  so wall_order lands in the caller's order; each call recompacts the
 *  wall server-side. N calls is acceptable for an explicit bulk action. */
export async function stageAll(ids: string[]): Promise<void> {
  const client = daemonStore.state.client;
  if (!client) return;
  let order = nextWallCount();
  for (const id of ids) {
    const res = await client.initiativeReorder(id, 'next', order++);
    if (!res.ok) log.warn('[queue] stageAll item failed', { id, status: res.status });
  }
}

/** Empty the queue — move every staged (`next`) initiative back to the
 *  operative `active` wall. Does NOT touch initiatives already running. */
export async function clearQueue(): Promise<void> {
  const client = daemonStore.state.client;
  if (!client) return;
  const staged = allInitiatives().filter((it) => isQueuedStatus(it.status));
  for (const it of staged) {
    const res = await client.initiativeReorder(it.id, 'active', 0);
    if (!res.ok) log.warn('[queue] clear item failed', { id: it.id, status: res.status });
  }
}
