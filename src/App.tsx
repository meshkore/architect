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

import { batch, createEffect, createSignal, Match, onCleanup, onMount, Switch } from 'solid-js';
import {
  connect,
  storeToken,
  readStoredToken,
  type ConnectionStatus,
} from '~/lib/connection';
import type { DaemonEvent } from '~/lib/daemon-client';
import { store } from '~/state/store';
import { daemonStore } from '~/state/daemon';
import { serverStore, isProjectEmpty } from '~/state/server';
import { projectsStore } from '~/state/projects';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import { viewStore } from '~/state/view';
import { storyStore } from '~/state/story';
import { log } from '~/lib/log';
import { applyStoredLayout } from '~/components/Splitter';
import { ModalHost } from '~/lib/modal';
import { TokenUnlockHost } from '~/components/modals/TokenUnlockModal';
import { DaemonOutdatedHost } from '~/components/modals/DaemonOutdatedModal';
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
    // V86q — Rehydrate convMap from the snapshot's
    // `timeline.recent_events` (py-1.1.0+ — the daemon has been
    // emitting up to 500 timeline events inside /state for this exact
    // purpose since the very first cockpit). The vanilla V80 monolith
    // had an `indexEvents()` step here that the Solid port dropped on
    // its way over; now we replay them through the same `ingestEvent`
    // reducer the WS uses, so dedup / streaming / cancel logic stays
    // in ONE place and history survives a hard refresh.
    void serverStore.refreshNow(client, activeId).then(() => {
      const snap = serverStore.state.snapshot as { timeline?: { recent_events?: DaemonEvent[] } } | null;
      const events = snap?.timeline?.recent_events ?? [];
      if (events.length > 0) {
        chatStore.hydrateFromTimeline(events);
        log.info('chat hydrated from timeline', { events: events.length });
      }
      // V89 — fetch any active runs from the daemon so the UI paints
      // ground truth immediately (the WS handles updates from here on).
      void storyStore.hydrate(client).then(() => {
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

  // V86c — Auto-select the lone remaining project. When the operator
  // deletes the currently-selected row, `forgetProjectImmediate`
  // clears both `activeId` and `offlineSelection` so the cockpit lands
  // on `RailEmptyPanel`. If exactly one row remains, the empty panel
  // would be a dead-end click target — bridge it for the operator by
  // switching to that row immediately. With 2+ rows we keep the empty
  // panel so the operator's next pick is explicit (they just told us
  // they don't want the rail's prior default), and with 0 rows the
  // empty panel shows the add/scan CTAs.
  createEffect(() => {
    if (daemonStore.state.activeId) return;
    if (daemonStore.state.offlineSelection) return;
    const list = rows();
    if (list.length !== 1) return;
    const only = list[0];
    if (!only) return;
    log.info('auto-selecting lone project after deletion / boot', { key: only.key, port: only.port });
    void switchProject(only.port, only.key, {
      display: only.display,
      cluster_id: only.cluster_id,
      cluster_name: only.cluster_name,
    });
  });

  onCleanup(() => {
    detachActive();
    daemonStore.disconnectAll();
  });

  const retry = () => { log.info('manual retry'); void connect(setStatus); };
  const saveTokenAndRetry = () => { storeToken(token()); retry(); };

  return (
    <>
      <Switch>
        <Match when={status().kind === 'connected'}>
          <Cockpit
            selectedModule={selectedModule()}
            onSelectModule={setSelectedModule}
          />
        </Match>
        <Match when={status().kind !== 'connected'}>
          <ConnectionGate
            status={status()}
            token={token()}
            onTokenInput={setToken}
            onRetry={retry}
            onSubmitToken={saveTokenAndRetry}
          />
        </Match>
      </Switch>
      <ModalHost />
      <TokenUnlockHost />
      <DaemonOutdatedHost />
      <AutoUpdateFlowHost />
      <NewAgentWizardHost />
      <AddProjectWizardHost />
      <StoryRunner />
    </>
  );
}

// Pick the conv the cockpit should land on after the daemon binds.
// Prefer the most recently active non-archived conv; else seed and
// return the Coordinator (the always-on fallback).
function pickDefaultConv(): string {
  const meta = chatStore.state.convMeta;
  const archived = chatStore.state.archivedConvs;
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
