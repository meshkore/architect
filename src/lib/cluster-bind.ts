/**
 * cluster-bind.ts — everything that must happen when the active
 * project changes, in one place.
 *
 * AX15 / ST-9: lifted out of `App.tsx`, where it was a 125-line
 * closure inside the component body. AX4 changed its shape: the five
 * rehydration fetches used to be chained BEHIND `/state` even though
 * none of them reads its payload, so a switch cost two serial network
 * legs before the workspace could paint. They now run in parallel.
 * AX5 replaced the hand-rolled `stillCurrent()` id comparison with the
 * shared epoch guard (`lib/swap-guard.ts`) — an id comparison passes
 * again on A→B→A and lets the FIRST visit's response overwrite the
 * second's.
 *
 * Also home to the wake handler (AX2): after a laptop sleep every
 * socket has burned its retry budget, so nothing recovers by itself.
 */

import { batch } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { serverStore } from '~/state/server';
import { projectsStore } from '~/state/projects';
import { chatStore } from '~/state/chat';
import { viewStore } from '~/state/view';
import { storyStore } from '~/state/story';
import { teamStore } from '~/state/team';
import { clientsStore } from '~/state/clients';
import { bindCluster as queueBindCluster } from '~/lib/queue';
import { rememberLastProject } from '~/lib/connection';
import { captureClusterEpoch, isCurrentEpoch } from '~/lib/swap-guard';
import { log } from '~/lib/log';

/**
 * Point every cluster-scoped store at `activeId` and rehydrate it.
 * Safe to call for a null / unknown id (no-op).
 */
export function bindActiveCluster(activeId: string | null): void {
  if (!activeId) return;
  const inst = daemonStore.state.instances[activeId];
  if (!inst) {
    log.warn('cluster-bind: no instance for activeId, bail', { activeId });
    return;
  }
  const { client, health } = inst;
  log.info('daemon bound — running side effects', { port: health.port, cluster: health.cluster_id });

  batch(() => {
    serverStore.setActiveCluster(activeId);
    // FC-2 (daemon-centralized) — the server HOME (central store: ideas,
    // projects registry, external creds) is NOT a project. Don't register it
    // in the rail; real projects come from discovery (GET /projects).
    if ((health as { server_home?: boolean }).server_home) {
      // Durably remember this cluster IS the server home and scrub any stale
      // known-projects row for it. Persisted so the home stays filtered out
      // of the rail / no-daemon panel / discovery even while offline.
      if (health.cluster_id) projectsStore.markHome(health.cluster_id);
    } else {
      projectsStore.upsert({
        port: health.port,
        base: client.transport.httpBase,
        cluster_id: health.cluster_id ?? undefined,
        cluster_name: health.cluster_name ?? undefined,
        status: 'live',
      });
      projectsStore.setActive(health.port, health.cluster_id ?? null);
      // FC-2 — remember the real project so the NEXT boot lands here directly
      // (skips the home detour entirely).
      if (health.cluster_id) rememberLastProject(health.cluster_id);
    }
    chatStore.bindCluster(health.cluster_id ?? null);
    viewStore.bindCluster(health.cluster_id ?? null);
    // agent-team (ATM3) — reset the roster mirror on project switch;
    // hydrate() below repopulates it from the new cluster's /team.
    teamStore.bindCluster(health.cluster_id ?? null);
    // DM-CLI-07 (multi-cli-clients) — same reset for the CLI-client
    // catalog mirror; hydrated alongside the roster below.
    clientsStore.bindCluster(health.cluster_id ?? null);
    // FC-2 — bind the execution queue to this project too (same cluster_id
    // path as the stores above) so staged items persist per-project across
    // refresh, instead of the queue racing daemonStore reads for its key.
    queueBindCluster(health.cluster_id ?? null);
    // V89 — run state is now daemon-owned. Reset the in-memory
    // mirror so the previous cluster's runs don't bleed in, then
    // hydrate from `/runs?active=1` below.
    storyStore.resetForClusterSwap();
  });

  rehydrateActiveCluster(activeId);
}

/**
 * Fire every per-cluster fetch for `activeId`. All five are
 * independent — `/chat/snapshot`, `/team`, `/clients` and `/runs` do
 * NOT read the `/state` payload — so they go out together.
 *
 * `teamStore.hydrate` and `clientsStore.hydrate` guard their own
 * writes internally (AX5); the two that write through this module
 * (chat snapshot, runs) are guarded here.
 */
export function rehydrateActiveCluster(activeId: string): void {
  const inst = daemonStore.state.instances[activeId];
  if (!inst) return;
  const { client } = inst;
  const epoch = captureClusterEpoch();

  void serverStore.refreshNow(client, activeId);

  // FC-2 — SHORT per-attempt timeout + one retry, same rationale as
  // server.doRefresh: a stale keep-alive socket (right after a daemon
  // restart) used to hang the snapshot past the 10s boot grace, so the
  // cockpit rendered with convs={} → the agent rail fell back to the
  // localStorage convMeta cache (leaking ARCHIVED convs) and AgentsPanel
  // showed "0". Failing fast and retrying on a fresh socket lands the real
  // snapshot in ~1s, so only the active agents show.
  void (async () => {
    let res = await client.chatSnapshot(AbortSignal.timeout(4000));
    if (!res.ok) res = await client.chatSnapshot(AbortSignal.timeout(6000));
    if (!isCurrentEpoch(epoch)) {
      log.debug('[swap-guard] dropping stale chatSnapshot result', { from: activeId });
      return;
    }
    if (res.ok) {
      chatStore.hydrateFromSnapshot(res.data);
      log.info('chat.snapshot.v1 hydrated', {
        convs: res.data.convs.length,
        live: res.data.convs.filter((c) => c.live).length,
        archived: res.data.convs.filter((c) => c.archived).length,
        daemon_version: res.data.version,
      });
    } else {
      log.error('chat.snapshot fetch failed; daemon may be older than py-1.11.0', { status: res.status });
    }
  })();

  // agent-team (ATM3) — hydrate the roster so the Team panel + the
  // chat-rail picker have members immediately. A daemon without /team
  // returns 404 → empty roster, not an error.
  void teamStore.hydrate(client).then(() => {
    if (isCurrentEpoch(epoch)) log.info('team roster hydrated', { members: teamStore.state.list.length });
  });

  // DM-CLI-07 — hydrate the CLI-client catalog so the team dialogs'
  // Client picker has real, current options as soon as they open.
  void clientsStore.hydrate(client).then(() => {
    if (isCurrentEpoch(epoch)) log.info('client catalog hydrated', { clients: clientsStore.state.list.length });
  });

  // V89 — fetch any active runs from the daemon so the UI paints ground
  // truth immediately (the WS handles updates from here on). storyStore
  // has no cluster slice, so a stale result has to be wiped post-hoc.
  void storyStore.hydrate(client).then(() => {
    if (!isCurrentEpoch(epoch)) {
      log.debug('[swap-guard] dropping stale runs hydrate', { from: activeId });
      storyStore.resetForClusterSwap();
      return;
    }
    log.info('runs hydrated from daemon', { count: storyStore.state.runs.length });
  });
}

/**
 * AX2 — sleep → wake / offline → online recovery.
 *
 * A suspended laptop kills every socket; by the time the tab is
 * visible again the 6-attempt retry budget is spent and the socket sits
 * in `fatal`, which never retries by itself. Before this, the ONLY
 * thing that revived it was the 60s health poll — and every `conv.*` /
 * `chat.*` event missed in between was simply lost, because nothing
 * re-fetched the snapshot.
 *
 * On wake we: redial dead sockets → re-poll instance health → revalidate
 * the active cluster through the normal rehydrate path.
 *
 * Returns a detach function. Debounced so alt-tabbing doesn't fire it.
 */
export function installWakeHandler(debounceMs = 1000): () => void {
  // Floor between two revalidations. A quick alt-tab round trip must not
  // cost four requests; a real wake is minutes away from the last one.
  const MIN_INTERVAL_MS = 15_000;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastRun = 0;

  const run = (): void => {
    timer = null;
    if (document.visibilityState === 'hidden') return;
    if (Date.now() - lastRun < MIN_INTERVAL_MS) return;
    lastRun = Date.now();
    const activeId = daemonStore.state.activeId;
    log.info('wake — revalidating connections', { activeId });
    daemonStore.reviveDeadSockets();
    void daemonStore.refreshAllInstanceHealth();
    if (activeId) rehydrateActiveCluster(activeId);
  };

  const schedule = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(run, debounceMs);
  };

  const onVisibility = (): void => {
    if (document.visibilityState === 'visible') schedule();
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('online', schedule);

  return () => {
    if (timer !== null) clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibility);
    window.removeEventListener('online', schedule);
  };
}
