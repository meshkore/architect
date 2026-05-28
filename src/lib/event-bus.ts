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

import type { DaemonClient, RunRecord } from './daemon-client';
import type { DaemonWS, DaemonEvent } from './ws';
import { chatStore } from '~/state/chat';
import { serverStore } from '~/state/server';
import { storyStore } from '~/state/story';
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
const RUN_TYPE_PREFIX = 'run.';

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
      // MP4 — route to the right cluster's slice. When the cluster
      // is active, this is a normal ingestEvent (reactive setState);
      // when inactive, it mutates the cached slice so the operator
      // sees the messages on switch back.
      chatStore.ingestEventForCluster(clusterKey, ev);
      return;
    }
    if (t.startsWith(RUN_TYPE_PREFIX)) {
      // py-1.10.0 — run.started / run.advanced / run.cancelled /
      // run.done / run.failed. Daemon broadcasts the full RunRecord;
      // the cockpit's storyStore just upserts by id. Multi-cluster
      // safe because run records are scoped to the daemon emitting
      // them (we'd need MP4-style per-cluster runs if cockpit ever
      // attaches to two daemons in the same tab, not the case today).
      const run = (ev as { run?: RunRecord }).run;
      if (run) storyStore.ingestRunEvent({ type: t, run });
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
