/**
 * App.tsx — root.
 *
 * Two phases:
 *   1. ConnectionGate — probe daemon; surface no-daemon / token / error UI.
 *   2. Cockpit — once connected, mount header + 3-column body and run the
 *      WS event stream.
 *
 * AX15 / ST-9 — the daemon side-effect bus that used to live in this
 * component's body now lives in `lib/cluster-bind.ts`, and the
 * live-task overlay poll in `state/server.ts`. What is left here is
 * wiring: boot probe → daemonStore, a handful of selection policies,
 * and the render tree.
 */

import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';
import {
  connect,
  saveTokenForClusterKey,
  readStoredToken,
  type ConnectionStatus,
} from '~/lib/connection';
import { adoptTokenFromUrl } from '~/lib/adopt';
import { daemonStore } from '~/state/daemon';
import { serverStore, isProjectEmpty } from '~/state/server';
import { chatStore, ONBOARDING_CONV_ID, loadLastActiveConv } from '~/state/chat';
import { projectsStore } from '~/state/projects';
import { bindActiveCluster, installWakeHandler } from '~/lib/cluster-bind';
import { log } from '~/lib/log';
import { applyStoredLayout } from '~/components/Splitter';
import { ModalHost } from '~/lib/modal';
import { ProjectDebugModalHost } from '~/components/modals/ProjectDebugModal';
// V97 — DaemonOutdatedHost removed. The outdated state is now the
// inline DaemonOutdatedPanel mounted by Cockpit.tsx (mandatory full-
// area block + auto-poll). No more floating dismissable modal.
import { AutoUpdateFlowHost } from '~/components/modals/AutoUpdateFlow';
import { AddProjectWizardHost } from '~/components/modals/AddProjectWizard';
import StoryRunner from '~/components/story/StoryRunner';
import ConnectionGate from '~/components/ConnectionGate';
import Cockpit from '~/components/Cockpit';
import { rows } from '~/components/projects-rail/rows';
import { switchProject } from '~/lib/project-switch';

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

  // Boot path → daemonStore. From there the cluster-bind bus below
  // picks up the new client and runs every rebind. We do NOT rebind
  // here — that belongs on the bus so a hot-swap re-fires it.
  createEffect(() => {
    const s = status();
    if (s.kind === 'connected') daemonStore.attachClient(s.client, s.health);
  });

  // V85d — Imperative side-effect bus. Registered SYNCHRONOUSLY in App's
  // body (not in onMount) so the subscriber exists before any onMount or
  // async boot path runs daemonStore.attachClient. Fired DIRECTLY from
  // daemonStore on every active-id change.
  const detachActive = daemonStore.onActiveChanged(bindActiveCluster);

  // AX15 — server.ts used to `await import('~/state/daemon')` to reach
  // the reconnect flow after repeated /state failures, purely to dodge
  // the import cycle. The app owns that wiring instead.
  serverStore.setDisconnectHandler((key) => daemonStore.markActiveDisconnected(key, 'lost'));

  // AX2 — sleep → wake / offline → online recovery. Without it, a
  // suspended laptop leaves every socket `fatal` (the retry budget is
  // spent) and the events missed while asleep are never re-fetched.
  const detachWake = installWakeHandler();

  // py-1.28.3 — live-task overlay poll (AX15: owned by serverStore now).
  serverStore.startLiveTaskPoll(() => ({
    client: daemonStore.state.client,
    activeId: daemonStore.state.activeId,
  }));

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
  // deletes the currently-selected row, `forgetProject` clears both
  // `activeId` and `offlineSelection` so the cockpit lands on
  // `RailEmptyPanel`. If exactly one row remains, the empty panel would
  // be a dead-end click target — bridge it for the operator by
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

  // FC-2 (daemon-centralized) — never sit on the server HOME. The boot probe
  // connects to the central daemon via its home cluster (server_home), but the
  // home is the global store, not a project. Once discovery surfaces a real
  // project, switch to it so the operator lands on an actual project.
  let homeSwitchInFlight = false;
  createEffect(() => {
    if (homeSwitchInFlight) return;
    const h = daemonStore.state.health as { server_home?: boolean } | null;
    if (!h?.server_home) return; // active is already a real project
    const real = rows().find((r) => !!r.cluster_id);
    if (!real) return; // no real project discovered yet
    homeSwitchInFlight = true;
    log.info('[FC-2] on server home — switching to first real project', { key: real.key });
    void switchProject(real.port, real.key, {
      display: real.display,
      cluster_id: real.cluster_id,
      cluster_name: real.cluster_name,
    }).finally(() => { homeSwitchInFlight = false; });
  });

  onCleanup(() => {
    serverStore.stopLiveTaskPoll();
    detachWake();
    detachActive();
    daemonStore.disconnectAll();
  });

  const retry = () => { log.info('manual retry'); void connect(setStatus); };
  // AX9 (OB-F2) — file the pasted token under the cluster key the
  // `unauthorized` status already carries. It used to go through
  // `storeToken(token())` with no health/port, i.e. under the literal
  // key 'unknown', while the retry reads by cluster key — so a remote
  // operator pasted a valid token and got asked again, forever.
  const saveTokenAndRetry = () => {
    const s = status();
    if (s.kind === 'unauthorized') saveTokenForClusterKey(s.clusterKey, token());
    else log.warn('token submitted outside the unauthorized state — nothing to key it by');
    retry();
  };

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
