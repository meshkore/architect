/**
 * queue-actions.ts — the post-WIP chat queue mutators.
 *
 * Edit / delete / move are pure daemon calls with no composer state:
 * the daemon broadcasts `queue.item.*` and the store's ingest lands the
 * result, so none of them touches a signal. Keeping them out of
 * `ChatComposer` is what puts that component back under the 300-line
 * rule, and it makes the queue editable from anywhere that has a conv
 * id.
 *
 * A failed mutation is logged, not surfaced: the item stays visibly
 * unchanged in the queue, which is the honest outcome.
 */

import { daemonStore } from '~/state/daemon';
import { log } from '~/lib/log';

export async function editQueuedItem(conv: string, id: string, text: string): Promise<void> {
  const c = daemonStore.state.client;
  if (!c || !text.trim()) return;
  const res = await c.queueEdit(conv, id, text);
  if (!res.ok) log.warn('queue edit failed', { id, status: res.status });
}

export async function deleteQueuedItem(conv: string, id: string): Promise<void> {
  const c = daemonStore.state.client;
  if (!c) return;
  const res = await c.queueDelete(conv, id);
  if (!res.ok) log.warn('queue delete failed', { id, status: res.status });
}

export async function moveQueuedItem(conv: string, id: string, position: number): Promise<void> {
  const c = daemonStore.state.client;
  if (!c) return;
  const res = await c.queueMove(conv, id, position);
  if (!res.ok) log.warn('queue move failed', { id, status: res.status });
}
