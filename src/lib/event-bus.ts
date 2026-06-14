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
import type { RunnerAuthRequest } from '~/state/daemon';
import { chatStore } from '~/state/chat';
import { serverStore } from '~/state/server';
import { storyStore } from '~/state/story';
import { daemonStore } from '~/state/daemon';
import { bumpContextRev } from '~/state/context-sync';
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
// V107.41 — Standard v16 chat-turn queue events (queue.item.added |
// updated | removed | sent). Same single-facade isolation rule as
// conv.* / run.* — only the active cluster's bus mutates chatStore.
const QUEUE_TYPE_PREFIX = 'queue.';
// py-1.11.0 — chat-state-rearchitecture. Conv lifecycle events emitted
// at exact mutation points so cockpits update the rail without
// polling /state. Active-cluster only — non-active clusters refetch
// on switch back via bindCluster's hydration path.
const CONV_TYPE_PREFIX = 'conv.';

/**
 * Attach the bus. Returns a teardown function — call it from
 * `onCleanup` so HMR / unmount doesn't leak the WS listener.
 *
 * MP2 — takes the cluster key so refreshes write to the right
 * per-cluster slice. MP4 will register one bus per instance so
 * inactive projects' events update their own slices too; for now
 * App.tsx still attaches a single bus on the active instance.
 */
export function attachEventBus(
  ws: DaemonWS,
  client: DaemonClient,
  clusterKey: string,
  onRunnerAuth?: (req: RunnerAuthRequest | null) => void,
): () => void {
  // V107.21 — Cluster guard at INGEST. Each daemon instance has its
  // own bus; without this check, a `conv.created` from cavioca's WS
  // mutates MeshKore's active chatStore (operator-visible bug
  // 2026-06-01: deploy-cavioca-* agents appearing in MeshKore Core's
  // AGENTS rail). Three event families now share the same rule:
  //
  //   - `chat.*`  — already guarded via ingestEventForCluster(key, ev)
  //                 which routes to active-store vs cached-slice.
  //   - `conv.*`  — was UNGUARDED; mutated the active facade directly.
  //                 Now wrapped: write to active store ONLY when this
  //                 bus's clusterKey IS the active cluster; otherwise
  //                 fold into the inactive slice (or drop until
  //                 snapshot rehydrate on switch-back).
  //   - `run.*`   — was UNGUARDED; storyStore has a single facade.
  //                 Now drops events for non-active clusters silently;
  //                 storyStore.hydrate refetches on switch-back.
  //   - `state.*` / `task.*` / `initiative.*` / `module.*` /
  //     `docs.*` / `links.updated` / `protocols.updated`
  //                — refresh is keyed by clusterKey, writes to
  //                serverStore.byCluster[clusterKey]; that side IS
  //                cluster-scoped. Kept as-is.
  const isActiveCluster = (): boolean => daemonStore.state.activeId === clusterKey;

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
    if (t.startsWith(CONV_TYPE_PREFIX)) {
      // py-1.11.0 — chat-state-rearchitecture. conv.* events update
      // the daemon-authoritative summaries store. ingestConvEvent is
      // a no-op until snapshot.v1 has hydrated at least once, so on
      // old daemons (or before boot finishes) we silently ignore.
      //
      // V107.21 — Only the active cluster's bus may mutate the
      // active chatStore. Non-active buses drop the event; on
      // switch-back the operator's bindCluster + chatSnapshot
      // refetch picks up the daemon's authoritative state.
      if (!isActiveCluster()) {
        log.debug('[event-bus] dropping conv.* from non-active cluster', { clusterKey, active: daemonStore.state.activeId, type: t });
        return;
      }
      chatStore.ingestConvEvent(ev);
      return;
    }
    if (t.startsWith(QUEUE_TYPE_PREFIX)) {
      if (!isActiveCluster()) {
        log.debug('[event-bus] dropping queue.* from non-active cluster', { clusterKey, active: daemonStore.state.activeId, type: t });
        return;
      }
      chatStore.ingestQueueEvent(ev);
      return;
    }
    if (t.startsWith(RUN_TYPE_PREFIX)) {
      // py-1.10.0 — run.started / run.advanced / run.cancelled /
      // run.done / run.failed. Daemon broadcasts the full RunRecord;
      // the cockpit's storyStore just upserts by id.
      //
      // V107.21 — storyStore is a single facade (not per-cluster),
      // so events from non-active daemons would leak. Guard at
      // ingest; storyStore.hydrate refetches the right runs from
      // the active daemon on switch-back (App.tsx bus already does).
      if (!isActiveCluster()) {
        log.debug('[event-bus] dropping run.* from non-active cluster', { clusterKey, active: daemonStore.state.activeId, type: t });
        return;
      }
      const run = (ev as { run?: RunRecord }).run;
      if (run) storyStore.ingestRunEvent({ type: t, run });
      return;
    }
    if (SNAPSHOT_REFRESH_TYPES.has(t)) {
      // serverStore.refresh writes to byCluster[clusterKey] — already
      // cluster-scoped on the WRITE side. Safe to call from any bus.
      void serverStore.refresh(client, clusterKey);
      return;
    }
    if (t === 'context.changed') {
      // Daemon detected a `.meshkore/context/` change (an agent it
      // spawned edited the project context). Bump the revision so the
      // Context tab re-fetches its tree + any expanded bodies live.
      // Active-cluster only — same isolation rule as conv.*/run.*.
      if (!isActiveCluster()) {
        log.debug('[event-bus] dropping context.changed from non-active cluster', { clusterKey, active: daemonStore.state.activeId });
        return;
      }
      bumpContextRev();
      return;
    }
    // py-1.12.5 — Runner auth events. State lives in daemonStore;
    // we receive the setter as a callback to avoid a circular import
    // (event-bus ↔ daemon).
    if (onRunnerAuth) {
      if (t === 'runner.auth.required') {
        onRunnerAuth({
          platform: typeof ev.platform === 'string' ? ev.platform : '',
          conv: typeof ev.conv === 'string' ? ev.conv : '',
          ts: typeof ev.ts === 'string' ? ev.ts : new Date().toISOString(),
        });
        return;
      }
      if (t === 'runner.auth.completed') {
        onRunnerAuth(null);
        return;
      }
    }
  });
  log.debug('event-bus attached', { cluster: clusterKey });
  return () => {
    unsubscribe();
    log.debug('event-bus detached', { cluster: clusterKey });
  };
}
