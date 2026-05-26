/**
 * event-bus.ts — single subscription point from the daemon WS into the
 * M2 bounded stores (chatStore + serverStore).
 *
 * Why one bus, not per-component listeners (audit §2.3): a per-component
 * `ws.onAny(...)` survives HMR / route changes silently because Solid
 * has no way to know which closure belongs to which component. One bus
 * attached in `App` with `onCleanup(teardown)` guarantees zero leaked
 * listeners.
 *
 * Routing:
 *   chat.user / chat.assistant.* / chat.cancelled  → chatStore.ingestEvent
 *   state.rebuilt / task.* / initiative.* /
 *   module.* / docs.* / links.updated /
 *   protocols.updated                              → serverStore.refresh
 *                                                    (debounced)
 *
 * Tool / task.lifecycle events still ride the legacy `store.events()`
 * ring used by ChatBubbles; they don't need a hook here because the
 * legacy `startLive` pipe stays wired until M9.
 */

import type { DaemonClient } from './daemon-client';
import type { DaemonWS, DaemonEvent } from './ws';
import { chatStore } from '~/state/chat';
import { serverStore } from '~/state/server';
import { log } from './log';

const SNAPSHOT_REFRESH_TYPES = new Set<string>([
  'state.rebuilt',
  'task.created',
  'task.updated',
  'task.deleted',
  'initiative.created',
  'initiative.updated',
  'initiative.deleted',
  'module.created',
  'module.updated',
  'docs.updated',
  'links.updated',
  'protocols.updated',
]);

const CHAT_TYPE_PREFIX = 'chat.';

/**
 * Attach the bus. Returns a teardown function — call it from
 * `onCleanup` so HMR / unmount doesn't leak the WS listener.
 *
 * MP2 — takes the cluster key so refreshes write to the right
 * per-cluster slice. MP4 will register one bus per instance so
 * inactive projects' events update their own slices too; for now
 * App.tsx still attaches a single bus on the active instance.
 */
export function attachEventBus(ws: DaemonWS, client: DaemonClient, clusterKey: string): () => void {
  const unsubscribe = ws.onAny((ev: DaemonEvent) => {
    const t = ev.type;
    if (!t) return;
    if (t.startsWith(CHAT_TYPE_PREFIX) && typeof ev.conv === 'string') {
      chatStore.ingestEvent(ev);
      return;
    }
    if (SNAPSHOT_REFRESH_TYPES.has(t)) {
      void serverStore.refresh(client, clusterKey);
    }
  });
  log.debug('event-bus attached', { cluster: clusterKey });
  return () => {
    unsubscribe();
    log.debug('event-bus detached', { cluster: clusterKey });
  };
}
