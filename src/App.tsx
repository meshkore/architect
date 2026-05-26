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

import { createEffect, createSignal, Match, onCleanup, onMount, Switch } from 'solid-js';
import {
  connect,
  storeToken,
  readStoredToken,
  type ConnectionStatus,
} from '~/lib/connection';
import { store } from '~/state/store';
import { daemonStore } from '~/state/daemon';
import { serverStore, isProjectEmpty } from '~/state/server';
import { projectsStore } from '~/state/projects';
import { chatStore, ONBOARDING_CONV_ID } from '~/state/chat';
import { viewStore } from '~/state/view';
import { attachEventBus } from '~/lib/event-bus';
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

export default function App() {
  const [status, setStatus] = createSignal<ConnectionStatus>({ kind: 'probing', message: 'Booting…' });
  const [token, setToken] = createSignal<string>(readStoredToken());
  const [selectedModule, setSelectedModule] = createSignal<string | null>(null);

  onMount(() => {
    log.info('App.onMount — starting connection probe');
    applyStoredLayout();
    void connect(setStatus);
  });

  let detachBus: (() => void) | null = null;

  // Boot path → daemonStore. From there the unified side-effect bus
  // below picks up the new client and runs every rebind. We do NOT
  // call store.attach / startLive here — they belong on the bus so a
  // hot-swap re-fires them.
  createEffect(() => {
    const s = status();
    if (s.kind === 'connected') daemonStore.attachClient(s.client, s.health);
  });

  // Unified side-effect bus — runs on boot AND on every hot-swap.
  createEffect(() => {
    const client = daemonStore.state.client;
    const health = daemonStore.state.health;
    if (!client || !health) return;
    console.log('[RAIL] side-effect bus firing', { port: health.port, cluster: health.cluster_id });
    log.info('daemon bound — running side effects', { port: health.port, cluster: health.cluster_id });
    // V84 — only the legacy snapshot `store` is wired here. The WS
    // is owned by `daemonStore.ws` (DaemonWS). The previous
    // `startLive`/`stopLive` from `~/state/live` opened a SECOND WS
    // on top of DaemonWS — under mixed content (HTTPS page → ws://
    // localhost) both reconnect loops accumulated Chrome LNA Issues
    // at ~8/min, hitting 1.9k+ in a session.
    void store.attach(client);
    void serverStore.refreshNow(client);
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
    if (detachBus) { detachBus(); detachBus = null; }
    const ws = daemonStore.state.ws;
    if (ws) detachBus = attachEventBus(ws, client);
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

  onCleanup(() => {
    if (detachBus) { detachBus(); detachBus = null; }
    daemonStore.disconnect();
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
