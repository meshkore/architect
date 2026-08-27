/**
 * state/chat/queue.ts — V107.41 / Standard v16 chat-turn queue.
 *
 * Daemon-authoritative: it auto-flushes the head when the conv goes idle
 * after a final, and broadcasts `queue.item.*`. The cockpit only mirrors,
 * always re-sorting by the daemon's `position`.
 */

import type { ChatQueueItem, DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import { state, setState, activeClusterId } from './store';

export function ingestQueueEvent(ev: DaemonEvent): void {
  const conv = typeof ev.conv === 'string' ? ev.conv : '';
  if (!conv) return;
  const item = (ev as { item?: ChatQueueItem }).item ?? null;
  const list = state.queues[conv] ?? [];
  if (ev.type === 'queue.item.added') {
    if (!item) return;
    // Dedup by id; the daemon's `position` is the ordering authority.
    const merged = list.filter((it) => it.id !== item.id).concat(item);
    merged.sort((a, b) => a.position - b.position);
    setState('queues', conv, merged);
    return;
  }
  if (ev.type === 'queue.item.updated') {
    if (!item) return;
    const merged = list.map((it) => (it.id === item.id ? item : it));
    merged.sort((a, b) => a.position - b.position);
    setState('queues', conv, merged);
    return;
  }
  if (ev.type === 'queue.item.removed' || ev.type === 'queue.item.sent') {
    if (!item?.id) return;
    setState('queues', conv, list.filter((it) => it.id !== item.id));
  }
}

/**
 * Hydrate one conv's queue from the daemon. The composer calls this the
 * first time it focuses a conv — most convs have no queue, so the round
 * trip is skipped until the operator is about to interact with one.
 *
 * A-CHAT-GUARD-01 (V110) — conv ids (`_onboarding_v1`) are shared across
 * clusters, so a late response would otherwise write project A's queue
 * into project B.
 */
export async function hydrateQueue(client: DaemonClient, conv: string): Promise<void> {
  const atCluster = activeClusterId();
  try {
    const res = await client.queueList(conv);
    if (!res.ok) return;
    if (activeClusterId() !== atCluster) {
      log.debug('[swap-guard] dropping stale queue hydrate', { conv, from: atCluster });
      return;
    }
    setState('queues', conv, res.data.items ?? []);
  } catch (e) {
    log.warn('queue hydrate failed', conv, e instanceof Error ? e.message : String(e));
  }
}
