/**
 * App.tsx — root component.
 *
 * Two-phase render:
 *   1. ConnectionGate: probe daemon, show "no daemon" / "needs token" UI.
 *   2. Cockpit (Layout): once connected, mount header + 3-column body and
 *      start the live WS stream.
 *
 * Logs heavily through `log` so the browser console tells the story when
 * the operator is debugging.
 */

import { createSignal, onMount, Show, Switch, Match, createEffect, onCleanup } from 'solid-js';
import {
  connect,
  storeToken,
  readStoredToken,
  type ConnectionStatus,
} from '~/lib/connection';
import { store } from '~/state/store';
import { startLive, stopLive } from '~/state/live';
// M3.1 — new bounded stores from M2. The old monolithic `store` keeps
// running alongside for the legacy components (RoadmapList, ChatPanel,
// etc.) that haven't migrated yet. M3.2 / M3.3 / M4 / M5 switch each
// component over and the old `store` retires when M9 lands.
import { daemonStore } from '~/state/daemon';
import { serverStore, isProjectEmpty } from '~/state/server';
import { projectsStore } from '~/state/projects';
import { chatStore } from '~/state/chat';
import { nav } from '~/state/nav';
import { uiStore, type Zone } from '~/state/ui';
import { attachEventBus } from '~/lib/event-bus';
import { log } from '~/lib/log';
import Header from '~/components/Header';
import ProjectsRail from '~/components/ProjectsRail';
import ModulesTree from '~/components/ModulesTree';
import RoadmapList from '~/components/RoadmapList';
import InitiativesPanel from '~/components/InitiativesPanel';
import ChatPanel from '~/components/ChatPanel';
import ChatRail from '~/components/ChatRail';
import ContextPanel from '~/components/ContextPanel';
import DiagramsPanel from '~/components/DiagramsPanel';
import ConfigPanel from '~/components/zones/ConfigPanel';
import BookmarksPanel from '~/components/zones/BookmarksPanel';
import CronsPanel from '~/components/zones/CronsPanel';
import LinksPanel from '~/components/zones/LinksPanel';
import ProtocolsPanel from '~/components/zones/ProtocolsPanel';
import DiaryPanel from '~/components/zones/DiaryPanel';
import { ModalHost } from '~/lib/modal';
import { TokenUnlockHost } from '~/components/modals/TokenUnlockModal';
import { DaemonOutdatedHost } from '~/components/modals/DaemonOutdatedModal';
import { AutoUpdateFlowHost } from '~/components/modals/AutoUpdateFlow';
import { NewAgentWizardHost, openNewAgentWizard } from '~/components/modals/NewAgentWizard';
import { AddProjectWizardHost } from '~/components/modals/AddProjectWizard';
import StoryBanner from '~/components/story/StoryBanner';
import StoryRunner from '~/components/story/StoryRunner';

export default function App() {
  const [status, setStatus] = createSignal<ConnectionStatus>({ kind: 'probing', message: 'Booting…' });
  const [token, setToken] = createSignal<string>(readStoredToken());
  const [selectedModule, setSelectedModule] = createSignal<string | null>(null);

  onMount(() => {
    log.info('App.onMount — starting connection probe');
    void connect(setStatus);
  });

  let detachBus: (() => void) | null = null;

  // When status flips to 'connected', wire BOTH the legacy `store` (used
  // by un-migrated components) AND the new bounded stores from M2. The
  // event-bus (M5.4) is the single WS → chatStore + serverStore hub,
  // attached once per connection and detached on cleanup so HMR doesn't
  // leak listeners (audit §2.3).
  createEffect(() => {
    const s = status();
    if (s.kind !== 'connected') return;
    log.info('connection established — attaching stores');

    // Legacy path (kept until M9).
    void store.attach(s.client);
    startLive(s.client);

    // M2 stores.
    daemonStore.attachClient(s.client, s.health);
    void serverStore.refreshNow(s.client);
    projectsStore.upsert({
      port: s.health.port,
      base: s.client.transport.httpBase,
      cluster_id: s.health.cluster_id ?? undefined,
      cluster_name: s.health.cluster_name ?? undefined,
      status: 'live',
    });
    projectsStore.setActive(s.health.port, s.health.cluster_id ?? null);
    chatStore.bindCluster(s.health.cluster_id ?? null);

    if (detachBus) { detachBus(); detachBus = null; }
    const ws = daemonStore.state.ws;
    if (ws) detachBus = attachEventBus(ws, s.client);
  });

  // V46 / V78b — once the server snapshot lands, drop the synthetic
  // Coordinator conv if the cluster is genuinely empty. Idempotent;
  // re-runs are no-ops once seeded.
  createEffect(() => {
    if (status().kind !== 'connected') return;
    if (!serverStore.state.snapshot) return;
    if (isProjectEmpty()) chatStore.seedOnboardingConv();
  });

  onCleanup(() => {
    if (detachBus) { detachBus(); detachBus = null; }
    stopLive();
    daemonStore.disconnect();
  });

  const retry = () => { log.info('manual retry'); void connect(setStatus); };
  const saveTokenAndRetry = () => { storeToken(token()); retry(); };

  return (
    <>
      <Switch>
        <Match when={status().kind === 'connected'}>
          <Cockpit
            status={status() as Extract<ConnectionStatus, { kind: 'connected' }>}
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

// ─── Cockpit (connected) ───────────────────────────────────────────────────

// V80 parity: the Architect zone has 4 sub-tabs (Roadmap / Tasks / Context /
// Diagrams) over a three-column layout. The chat panel (with its agents
// rail INSIDE) is the permanent right column — NOT a sibling tab.
type Tab = 'roadmap' | 'tasks' | 'context' | 'diagrams';

const HASH_ZONES: readonly Zone[] = ['architect', 'bookmarks', 'crons', 'links', 'protocols', 'diary', 'config'];
const MIGRATED_ZONES: readonly Zone[] = ['bookmarks', 'crons', 'links', 'protocols', 'diary', 'config'];

function Cockpit(props: {
  status: Extract<ConnectionStatus, { kind: 'connected' }>;
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
}) {
  const tab = nav.cockpitTab;
  const setTab = (t: Tab) => nav.setCockpitTab(t);
  const zone = () => uiStore.state.activeZone;

  // Hash deep-link: read `#bookmarks` (etc.) on mount + popstate, and
  // write the current zone back to the URL when it changes.
  onMount(() => {
    const fromHash = window.location.hash.replace(/^#/, '') as Zone;
    if (HASH_ZONES.includes(fromHash) && fromHash !== zone()) uiStore.setActiveZone(fromHash);
    const onPop = () => {
      const z = window.location.hash.replace(/^#/, '') as Zone;
      if (HASH_ZONES.includes(z) && z !== uiStore.state.activeZone) uiStore.setActiveZone(z);
    };
    window.addEventListener('popstate', onPop);
    window.addEventListener('hashchange', onPop);
    onCleanup(() => {
      window.removeEventListener('popstate', onPop);
      window.removeEventListener('hashchange', onPop);
    });
  });
  createEffect(() => {
    const z = zone();
    const want = z === 'architect' ? '' : `#${z}`;
    if (window.location.hash !== want) {
      try { history.replaceState(null, '', `${window.location.pathname}${window.location.search}${want}`); } catch { /* ignore */ }
    }
  });

  // Layout — V80 1:1 (`.three-col` grid + projects rail as outer
  // sibling). The projects rail lives BESIDE the three-col, not inside,
  // so it visually anchors the cockpit on its own. The three-col grid
  // itself is `nav | splitter | left (workspace) | splitter | center
  // (chat)` with 8 px splitters that are drag-resizable in V80 (drag
  // wiring is a follow-up; the columns render at fixed widths for now).
  return (
    <div class="min-h-screen flex flex-col bg-canvas">
      <Header />
      <StoryBanner />
      <Show when={!MIGRATED_ZONES.includes(zone())} fallback={<ZoneView zone={zone()} />}>
        <div class="flex-1 flex min-h-0">
          <ProjectsRail />
          <main class="flex-1 min-h-0 relative">
            <section class="tab-panel three-col">
              {/* COL 1 — Modules nav (V80 .nav-col) */}
              <aside class="nav-col col">
                <ModulesTree selected={props.selectedModule} onSelect={props.onSelectModule} />
              </aside>

              {/* Splitter — drag wiring follow-up. */}
              <div class="splitter splitter-col-nav" title="Drag to resize" />

              {/* COL 2 — Workspace (V80 .left-col): subtab-bar +
                  ws-panel content. */}
              <aside class="left-col col">
                <div class="subtab-bar">
                  <SubTab id="roadmap"  label="Roadmap"  active={tab() === 'roadmap'}  onSelect={setTab} global />
                  <span class="subtab-divider" aria-hidden="true">›</span>
                  <SubTab id="tasks"    label="Tasks"    active={tab() === 'tasks'}    onSelect={setTab} />
                  <SubTab id="context"  label="Context"  active={tab() === 'context'}  onSelect={setTab} />
                  <SubTab id="diagrams" label="Diagrams" active={tab() === 'diagrams'} onSelect={setTab} />
                  <div class="flex-1" />
                  <div class="flex items-center gap-1 pr-2 self-center">
                    <button type="button" title="New task" class="text-gray-500 hover:text-emerald-400 transition px-1 py-0.5 rounded hover:bg-emerald-500/10">
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.4"><path d="M12 4v16M4 12h16" /></svg>
                    </button>
                    <button type="button" title="Reload state" class="text-gray-500 hover:text-emerald-400 transition px-1 py-0.5 rounded hover:bg-emerald-500/10"
                      onClick={() => { const c = props.status.client; if (c) void serverStore.refreshNow(c); }}>
                      <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M4 4v6h6M20 20v-6h-6M5 13a8 8 0 1014.5-3.5M19 11a8 8 0 00-14.5 3.5" /></svg>
                    </button>
                  </div>
                </div>
                <Switch>
                  <Match when={tab() === 'roadmap'}>
                    <div class="ws-panel" style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-height': '0' }}>
                      <InitiativesPanel />
                    </div>
                  </Match>
                  <Match when={tab() === 'tasks'}>
                    <div class="ws-panel" style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-height': '0' }}>
                      <RoadmapList moduleId={props.selectedModule} />
                    </div>
                  </Match>
                  <Match when={tab() === 'context'}>
                    <div class="ws-panel" style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-height': '0' }}>
                      <ContextPanel moduleId={props.selectedModule} />
                    </div>
                  </Match>
                  <Match when={tab() === 'diagrams'}>
                    <div class="ws-panel" style={{ flex: '1', display: 'flex', 'flex-direction': 'column', 'min-height': '0' }}>
                      <DiagramsPanel moduleId={props.selectedModule} />
                    </div>
                  </Match>
                </Switch>
              </aside>

              {/* Splitter. */}
              <div class="splitter splitter-col-chat" title="Drag to resize" />

              {/* COL 3 — Chat (V80 .center-col): chat-body = rail-stack
                  + splitter + chat-main. */}
              <div class="center-col col" id="chat-col">
                <div class="chat-body flex-1 flex min-h-0">
                  <ChatRail onNewAgent={() => openNewAgentWizard({ scope: { module: props.selectedModule } })} />
                  <div class="splitter splitter-chat-rail" title="Drag to resize agent rail" />
                  <div class="chat-main flex-1 flex flex-col min-h-0">
                    <ChatPanel client={props.status.client} />
                  </div>
                </div>
              </div>
            </section>
          </main>
        </div>
      </Show>
    </div>
  );
}

/**
 * SubTab — V80 .subtab pill inside the workspace's .subtab-bar.
 * The first one (Roadmap) is the "global" subtab with a leading
 * chevron divider; the rest are project-scoped subtabs.
 */
function SubTab(props: {
  id: Tab;
  label: string;
  active: boolean;
  onSelect: (id: Tab) => void;
  global?: boolean;
}) {
  return (
    <button
      type="button"
      data-wstab={props.id}
      onClick={() => props.onSelect(props.id)}
      class={`subtab ws-tab ${props.active ? 'active' : ''} ${props.global ? 'subtab-global' : ''}`}
    >
      {props.label}
    </button>
  );
}

function ZoneView(props: { zone: Zone }) {
  return (
    <Switch fallback={<BookmarksPanel />}>
      <Match when={props.zone === 'bookmarks'}>
        <BookmarksPanel />
      </Match>
      <Match when={props.zone === 'crons'}>
        <CronsPanel />
      </Match>
      <Match when={props.zone === 'links'}>
        <LinksPanel />
      </Match>
      <Match when={props.zone === 'protocols'}>
        <ProtocolsPanel />
      </Match>
      <Match when={props.zone === 'diary'}>
        <DiaryPanel />
      </Match>
      <Match when={props.zone === 'config'}>
        <ConfigPanel />
      </Match>
    </Switch>
  );
}

// TabButton — retired. Workspace sub-tabs use V80's `.subtab` class via
// the SubTab component above. Header zones use their own ZoneButton in
// components/Header.tsx.

// ─── Pre-connect gate ──────────────────────────────────────────────────────

function ConnectionGate(props: {
  status: ConnectionStatus;
  token: string;
  onTokenInput: (v: string) => void;
  onRetry: () => void;
  onSubmitToken: () => void;
}) {
  return (
    <main class="min-h-screen flex items-center justify-center px-6">
      <div class="max-w-xl w-full">

        <header class="mb-8">
          <div class="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-medium mb-5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse-soft" />
            MeshKore Architect
          </div>
          <h1 class="text-3xl md:text-4xl font-bold tracking-tight mb-2">
            One cockpit for your <span class="grad">AI agents</span>
          </h1>
          <p class="text-gray-400 leading-relaxed text-sm">
            This page connects to your local <span class="font-mono text-emerald-300">meshcore</span> daemon and unlocks the cockpit. New here? Follow the setup at <a class="text-emerald-400 hover:underline" href="https://meshkore.com/architect" target="_blank" rel="noopener">meshkore.com/architect</a>.
          </p>
        </header>

        <section class="bg-gray-900/50 border border-gray-800 rounded-2xl p-6 md:p-8">
          <Switch>
            <Match when={props.status.kind === 'probing'}>
              <Probing message={(props.status as Extract<ConnectionStatus, { kind: 'probing' }>).message} />
            </Match>
            <Match when={props.status.kind === 'no-daemon'}>
              <NoDaemon
                ports={(props.status as Extract<ConnectionStatus, { kind: 'no-daemon' }>).portsTried}
                onRetry={props.onRetry}
              />
            </Match>
            <Match when={props.status.kind === 'unauthorized'}>
              <Unauthorized
                token={props.token}
                onTokenInput={props.onTokenInput}
                onSubmit={props.onSubmitToken}
              />
            </Match>
            <Match when={props.status.kind === 'cloud-pending'}>
              <CloudPending token={(props.status as Extract<ConnectionStatus, { kind: 'cloud-pending' }>).token} />
            </Match>
            <Match when={props.status.kind === 'error'}>
              <ErrorView
                message={(props.status as Extract<ConnectionStatus, { kind: 'error' }>).message}
                onRetry={props.onRetry}
              />
            </Match>
          </Switch>
        </section>

      </div>
    </main>
  );
}

function Probing(props: { message: string }) {
  return (
    <div class="text-center py-4">
      <div class="inline-block w-7 h-7 border-2 border-emerald-500/30 border-t-emerald-400 rounded-full animate-spin mb-3" />
      <p class="text-gray-300 text-sm">{props.message}</p>
    </div>
  );
}

function NoDaemon(props: { ports: number[]; onRetry: () => void }) {
  return (
    <div>
      <h2 class="text-lg font-bold mb-2">No daemon detected</h2>
      <p class="text-gray-400 text-sm leading-relaxed mb-3">
        We probed <span class="font-mono text-emerald-300">localhost:{props.ports[0]}–{props.ports[props.ports.length - 1]}</span> and got no response. Start the daemon in your repo:
      </p>
      <pre class="bg-gray-950 border border-gray-800 rounded-lg p-3 text-xs font-mono text-emerald-300 mb-3">npx meshcore start</pre>
      <button type="button" onClick={props.onRetry} class="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs transition-colors">
        Retry detection
      </button>
    </div>
  );
}

function Unauthorized(props: { token: string; onTokenInput: (v: string) => void; onSubmit: () => void }) {
  return (
    <div>
      <h2 class="text-lg font-bold mb-2">Daemon found — needs a token</h2>
      <p class="text-gray-400 text-sm leading-relaxed mb-3">
        Paste the contents of <span class="font-mono text-emerald-300">.meshkore/credentials/architect-token</span> below. Stored only in this browser.
      </p>
      <input
        type="password"
        value={props.token}
        onInput={(e) => props.onTokenInput((e.currentTarget as HTMLInputElement).value)}
        placeholder="Bearer token"
        class="w-full bg-gray-950 border border-gray-800 rounded-md px-3 py-2 text-sm font-mono text-gray-100 focus:outline-none focus:border-emerald-500/50 mb-3"
      />
      <button type="button" onClick={props.onSubmit} class="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs transition-colors">
        Save &amp; connect
      </button>
    </div>
  );
}

function CloudPending(props: { token: string }) {
  return (
    <div>
      <h2 class="text-lg font-bold mb-2">Cluster Cloud — coming soon</h2>
      <p class="text-gray-400 text-sm leading-relaxed mb-2">
        Cloud mode (<span class="font-mono">?cluster=…</span>) is wired in the client but the backend is not deployed yet (Cluster Cloud P1).
      </p>
      <p class="text-gray-400 text-sm leading-relaxed">
        Open this page without the <span class="font-mono">?cluster</span> parameter to connect to a local daemon.
      </p>
      <p class="text-[11px] text-gray-600 font-mono mt-3 break-all">token: {props.token.slice(0, 12)}…</p>
    </div>
  );
}

function ErrorView(props: { message: string; onRetry: () => void }) {
  return (
    <div>
      <h2 class="text-lg font-bold mb-2 text-red-400">Connection error</h2>
      <p class="text-gray-300 text-xs font-mono break-words mb-3">{props.message}</p>
      <button type="button" onClick={props.onRetry} class="px-3 py-1.5 rounded-md bg-emerald-500 hover:bg-emerald-400 text-gray-950 font-semibold text-xs transition-colors">
        Retry
      </button>
    </div>
  );
}
