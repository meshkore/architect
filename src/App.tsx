/**
 * App.tsx — root.
 *
 * Two phases:
 *   1. ConnectionGate — probe daemon; surface no-daemon / token / error UI.
 *   2. Cockpit — once connected, mount header + 3-column body and run the
 *      WS event stream.
 *
 * The unified daemon side-effect bus lives here too: any time a new
 * DaemonClient lands in daemonStore (boot OR hot-swap to another
 * project), refresh every store that depends on the active daemon
 * (legacy `store`, `startLive`, `serverStore`, `projectsStore`,
 * `chatStore`, event bus). Keeping this in one effect prevents the
 * boot-only / swap-only branching that caused stale columns earlier.
 */

import { batch, createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  connect,
  storeToken,
  readStoredToken,
  type ConnectionStatus,
} from '~/lib/connection';
import { adoptTokenFromUrl } from '~/lib/adopt';
import { store } from '~/state/store';
import { daemonStore } from '~/state/daemon';
import { serverStore, isProjectEmpty } from '~/state/server';
import { projectsStore } from '~/state/projects';
import { chatStore, ONBOARDING_CONV_ID, loadLastActiveConv } from '~/state/chat';
import { viewStore } from '~/state/view';
import { storyStore } from '~/state/story';
import { log } from '~/lib/log';
import { applyStoredLayout } from '~/components/Splitter';
import { ModalHost } from '~/lib/modal';
import { ProjectDebugModalHost } from '~/components/modals/ProjectDebugModal';
// V97 — DaemonOutdatedHost removed. The outdated state is now the
// inline DaemonOutdatedPanel mounted by Cockpit.tsx (mandatory full-
// area block + auto-poll). No more floating dismissable modal.
import { AutoUpdateFlowHost } from '~/components/modals/AutoUpdateFlow';
import { NewAgentWizardHost } from '~/components/modals/NewAgentWizard';
import { AddProjectWizardHost } from '~/components/modals/AddProjectWizard';
import StoryRunner from '~/components/story/StoryRunner';
import ConnectionGate from '~/components/ConnectionGate';
import Cockpit from '~/components/Cockpit';
import { rows } from '~/components/projects-rail/rows';
import { switchProject } from '~/components/ProjectsRailRow';

export default function App() {
  const [status, setStatus] = createSignal<ConnectionStatus>({ kind: 'probing', message: 'Booting…' });
  const [token, setToken] = createSignal<string>(readStoredToken());
  const [selectedModule, setSelectedModule] = createSignal<string | null>(null);

  onMount(() => {
    log.info('App.onMount — starting connection probe');
    applyStoredLayout();
    // Auto-adopt a local daemon's token from the launch URL BEFORE connecting,
    // so first-boot of your own machine needs no token paste. Strips the token
    // from the URL. No-op when the mk_* params are absent. (lib/adopt.ts)
    adoptTokenFromUrl();
    void connect(setStatus);
  });

  // MP4 — event buses are now owned by each DaemonInstance inside
  // daemonStore.attachClient / disconnectInstance, so this App-level
  // detachBus is no longer needed.

  // Boot path → daemonStore. From there the unified side-effect bus
  // below picks up the new client and runs every rebind. We do NOT
  // call store.attach / startLive here — they belong on the bus so a
  // hot-swap re-fires them.
  createEffect(() => {
    const s = status();
    if (s.kind === 'connected') daemonStore.attachClient(s.client, s.health);
  });

  // V85d — Imperative side-effect bus. Registered SYNCHRONOUSLY in
  // App's body (not in onMount) so the subscriber exists before any
  // onMount or async boot path runs daemonStore.attachClient.
  // Fired DIRECTLY from daemonStore on every active-id change.
  const detachActive = daemonStore.onActiveChanged((activeId) => {
    console.log('[RAIL] side-effect bus firing', { activeId });
    if (!activeId) return;
    const inst = daemonStore.state.instances[activeId];
    if (!inst) {
      console.warn('[RAIL] bus: no instance for activeId, bail', { activeId });
      return;
    }
    const { client, health } = inst;
    log.info('daemon bound — running side effects', { port: health.port, cluster: health.cluster_id });
    batch(() => {
      void store.attach(client);
      serverStore.setActiveCluster(activeId);
      projectsStore.upsert({
        port: health.port,
        base: client.transport.httpBase,
        cluster_id: health.cluster_id ?? undefined,
        cluster_name: health.cluster_name ?? undefined,
        status: 'live',
      });
      projectsStore.setActive(health.port, health.cluster_id ?? null);
      chatStore.bindCluster(health.cluster_id ?? null);
      viewStore.bindCluster(health.cluster_id ?? null);
      // V89 — run state is now daemon-owned. Reset the in-memory
      // mirror so the previous cluster's runs don't bleed in, then
      // hydrate from `/runs?active=1` once attach() resolves.
      storyStore.resetForClusterSwap();
    });
    // py-1.11.0 — chat-state-rearchitecture. The daemon is the single
    // source of truth for the conv list. One round-trip to
    // /chat/snapshot replaces the pre-1.11 chain (timeline replay +
    // /health.chat_active_convs + bulk-archive + /chat/archives).
    // After this hydrate, WS conv.* events keep convs in sync; chat
    // messages are lazy-loaded by ChatThread when the conv gains focus.
    //
    // V107.21 — Stale-request guard. Each async resolution re-checks
    // that this swap is still the current one before writing to a
    // single-facade store. Without this, swap-A→B→C where A's
    // chatSnapshot resolves AFTER C's bindCluster overwrites C's
    // slice with A's convs. Captured `swapActiveId` from the closure
    // at start; if activeId has changed by the time the promise
    // resolves, drop the result silently — the new cluster's own
    // chain is already running.
    const swapActiveId = activeId;
    const stillCurrent = (): boolean => daemonStore.state.activeId === swapActiveId;
    void serverStore.refreshNow(client, activeId).then(() => {
      if (!stillCurrent()) {
        log.debug('[swap-guard] dropping post-swap chatSnapshot/runs fetch — active changed', { from: swapActiveId, to: daemonStore.state.activeId });
        return;
      }
      void client.chatSnapshot().then((res) => {
        if (!stillCurrent()) {
          log.debug('[swap-guard] dropping stale chatSnapshot result', { from: swapActiveId, to: daemonStore.state.activeId });
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
      });
      // V89 — fetch any active runs from the daemon so the UI paints
      // ground truth immediately (the WS handles updates from here on).
      void storyStore.hydrate(client).then(() => {
        if (!stillCurrent()) {
          log.debug('[swap-guard] dropping stale runs hydrate', { from: swapActiveId, to: daemonStore.state.activeId });
          // storyStore.hydrate already wrote to state.runs — wipe so
          // we don't leave the previous cluster's runs visible until
          // the new bus's hydrate lands.
          storyStore.resetForClusterSwap();
          return;
        }
        log.info('runs hydrated from daemon', { count: storyStore.state.runs.length });
      });
    });
  });

  // Once the server snapshot lands, fall back to the Coordinator conv
  // if the cluster is empty. Then auto-activate the most-recent conv
  // (or the Coordinator) so the operator never lands on an empty chat.
  createEffect(() => {
    if (!daemonStore.state.client) return;
    if (!serverStore.state.snapshot) return;
    if (isProjectEmpty()) chatStore.seedOnboardingConv();
    if (chatStore.state.activeConv) return;
    const next = pickDefaultConv();
    if (next) chatStore.setActiveConv(next);
  });

  // V107.15 — Defensive re-upsert. Root cause documented at
  // known-projects.ts:175-186 (port-collision sweep can prune entries
  // during self-update port shifts). V107.15 (initial) only guarded
  // the ACTIVE cluster; field report 2026-05-31 showed an INACTIVE
  // cluster (MeshKore Core, with the operator on Ikamiro) had also
  // disappeared. Broadened here: every instance in daemonStore.state
  // gets re-upserted if it's missing from kp.list(). Idempotent.
  createEffect(() => {
    const instances = daemonStore.state.instances;
    const list = projectsStore.state.list;
    for (const [id, inst] of Object.entries(instances)) {
      const cid = inst.health.cluster_id;
      const present =
        (cid && list.some((p) => p.cluster_id === cid)) ||
        (!cid && list.some((p) => p.port === inst.health.port));
      if (present) continue;
      log.warn('[V107.15] live instance missing from kp.list — re-upserting', {
        instanceId: id,
        cluster_id: cid,
        port: inst.health.port,
      });
      projectsStore.upsert({
        port: inst.health.port,
        base: inst.client.transport.httpBase,
        cluster_id: cid ?? undefined,
        cluster_name: inst.health.cluster_name ?? undefined,
        status: 'live',
      });
    }
  });

  // V86c — Auto-select the lone remaining project. When the operator
  // deletes the currently-selected row, `forgetProjectImmediate`
  // clears both `activeId` and `offlineSelection` so the cockpit lands
  // on `RailEmptyPanel`. If exactly one row remains, the empty panel
  // would be a dead-end click target — bridge it for the operator by
  // switching to that row immediately. With 2+ rows we keep the empty
  // panel so the operator's next pick is explicit (they just told us
  // they don't want the rail's prior default), and with 0 rows the
  // empty panel shows the add/scan CTAs.
  //
  // Guard: only after connect() succeeds (status connected) and never
  // re-enter while a switch is in flight — firing during the probing
  // phase raced attachClient and re-triggered switchProject on every
  // rows() recompute (refresh stack overflow).
  let autoSelectInFlight = false;
  createEffect(() => {
    if (status().kind !== 'connected') return;
    if (daemonStore.state.activeId) return;
    if (daemonStore.state.offlineSelection) return;
    if (autoSelectInFlight) return;
    const list = rows();
    if (list.length !== 1) return;
    const only = list[0];
    if (!only) return;
    autoSelectInFlight = true;
    log.info('auto-selecting lone project after deletion / boot', { key: only.key, port: only.port });
    void switchProject(only.port, only.key, {
      display: only.display,
      cluster_id: only.cluster_id,
      cluster_name: only.cluster_name,
    }).finally(() => { autoSelectInFlight = false; });
  });

  onCleanup(() => {
    detachActive();
    daemonStore.disconnectAll();
  });

  const retry = () => { log.info('manual retry'); void connect(setStatus); };
  const saveTokenAndRetry = () => { storeToken(token()); retry(); };

  // 2026-06-11 — UX fix: keep Cockpit shell mounted at all times so the
  // projects rail + header are interactive WHILE the daemon probe is in
  // flight. ConnectionGate becomes a fill-main-area panel passed via
  // prop; it only paints when there's no active daemon to talk to.
  const connectionGateNode = () => (
    <ConnectionGate
      status={status()}
      token={token()}
      onTokenInput={setToken}
      onRetry={retry}
      onSubmitToken={saveTokenAndRetry}
    />
  );

  return (
    <>
      <Cockpit
        selectedModule={selectedModule()}
        onSelectModule={setSelectedModule}
        connectionStatus={status()}
        renderConnectionGate={connectionGateNode}
      />
      <ModalHost />
      <ProjectDebugModalHost />
      {/* V97 — DaemonOutdatedHost removed; daemon-outdated is now an
          inline panel in Cockpit.tsx */}
      <AutoUpdateFlowHost />
      <NewAgentWizardHost />
      <AddProjectWizardHost />
      <StoryRunner />
    </>
  );
}

// Pick the conv the cockpit should land on after the daemon binds.
// V107.17 — first preference is the operator's last-selected conv for
// THIS cluster (persisted to localStorage by chatStore.setActiveConv).
// If absent / stale (conv no longer exists or is archived), fall back
// to the most recently active non-archived conv; else seed and return
// the Architect Agent (the always-on fallback).
function pickDefaultConv(): string {
  const meta = chatStore.state.convMeta;
  const convs = chatStore.state.convs;
  const archived = chatStore.state.archivedConvs;
  const clusterId = daemonStore.state.health?.cluster_id ?? null;
  const saved = loadLastActiveConv(clusterId);
  // V107.42 — Sticky-restore. Pre-fix we required `meta[saved]` to be
  // populated, but `convMeta` only hydrates AFTER `chatSnapshot`
  // lands — which arrives later than `/state` (the gate this fn runs
  // behind). For non-Master saved convs (any sub-agent, work-*,
  // deploy-*, etc.) the gate flunked and we fell through to the
  // "most recent by ts" fallback → operator landed on whichever conv
  // happened to be top-of-rail instead of the one they had open.
  //
  // The saved slug is enough. It came from setActiveConv at some
  // earlier point; if the conv is now gone or archived, the
  // downstream ChatThread render handles it gracefully. We just
  // need to NOT block on metadata we haven't fetched yet.
  if (saved && !archived[saved]) {
    // Soft sanity: the slug isn't empty and isn't the local-archived
    // shadow. If `convs[saved]?.archived` is true (daemon-archived),
    // skip; otherwise honor it even when meta hasn't landed yet.
    if (!convs[saved]?.archived) return saved;
  }
  const candidates = Object.keys(meta).filter((c) => !archived[c]);
  if (candidates.length > 0) {
    const byTs = candidates
      .map((c) => {
        const msgs = chatStore.state.convMap[c] ?? [];
        return { c, ts: msgs.at(-1)?.ts ?? '' };
      })
      .sort((a, b) => b.ts.localeCompare(a.ts));
    const first = byTs[0]?.c;
    if (first) return first;
  }
  chatStore.seedOnboardingConv();
  return ONBOARDING_CONV_ID;
}
