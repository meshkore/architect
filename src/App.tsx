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
import { log } from '~/lib/log';
import Header from '~/components/Header';
import ModulesTree from '~/components/ModulesTree';
import RoadmapList from '~/components/RoadmapList';
import InitiativesPanel from '~/components/InitiativesPanel';
import ChatPanel from '~/components/ChatPanel';
import NetworkPanel from '~/components/NetworkPanel';
import ConfigPanel from '~/components/ConfigPanel';

export default function App() {
  const [status, setStatus] = createSignal<ConnectionStatus>({ kind: 'probing', message: 'Booting…' });
  const [token, setToken] = createSignal<string>(readStoredToken());
  const [selectedModule, setSelectedModule] = createSignal<string | null>(null);

  onMount(() => {
    log.info('App.onMount — starting connection probe');
    void connect(setStatus);
  });

  // When status flips to 'connected', attach the store + open the live stream.
  createEffect(() => {
    const s = status();
    if (s.kind === 'connected') {
      log.info('connection established — attaching store + live');
      void store.attach(s.client);
      startLive(s.client);
    }
  });

  onCleanup(() => {
    stopLive();
  });

  const retry = () => { log.info('manual retry'); void connect(setStatus); };
  const saveTokenAndRetry = () => { storeToken(token()); retry(); };

  return (
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
  );
}

// ─── Cockpit (connected) ───────────────────────────────────────────────────

type Tab = 'roadmap' | 'chat' | 'network' | 'config';

function Cockpit(props: {
  status: Extract<ConnectionStatus, { kind: 'connected' }>;
  selectedModule: string | null;
  onSelectModule: (id: string | null) => void;
}) {
  const [tab, setTab] = createSignal<Tab>('roadmap');
  return (
    <div class="min-h-screen flex flex-col">
      <Header health={props.status.health} />
      <div class="bg-gray-950 border-b border-gray-800/60">
        <div class="max-w-[1600px] mx-auto px-5 flex items-center gap-1 h-10">
          <TabButton label="Roadmap" active={tab() === 'roadmap'} onClick={() => setTab('roadmap')} />
          <TabButton label="Chat" active={tab() === 'chat'} onClick={() => setTab('chat')} />
          <TabButton label="Network" active={tab() === 'network'} onClick={() => setTab('network')} />
          <TabButton label="Config" active={tab() === 'config'} onClick={() => setTab('config')} />
        </div>
      </div>

      <div class="flex-1 max-w-[1600px] mx-auto w-full px-5 py-6 grid grid-cols-1 lg:grid-cols-[220px_1fr_300px] gap-6 min-h-0">
        <aside class="min-w-0">
          <Show when={tab() === 'roadmap' || tab() === 'chat'}>
            <ModulesTree selected={props.selectedModule} onSelect={props.onSelectModule} />
          </Show>
        </aside>
        <main class="min-w-0">
          <Switch>
            <Match when={tab() === 'roadmap'}>
              <RoadmapList moduleId={props.selectedModule} />
            </Match>
            <Match when={tab() === 'chat'}>
              <div class="h-[calc(100vh-12rem)]">
                <ChatPanel client={props.status.client} />
              </div>
            </Match>
            <Match when={tab() === 'network'}>
              <NetworkPanel client={props.status.client} />
            </Match>
            <Match when={tab() === 'config'}>
              <ConfigPanel client={props.status.client} />
            </Match>
          </Switch>
        </main>
        <aside class="min-w-0">
          <Switch>
            <Match when={tab() === 'roadmap'}>
              <InitiativesPanel />
            </Match>
            <Match when={tab() === 'chat'}>
              <div class="text-xs text-gray-600 px-2 leading-relaxed">
                <p class="text-gray-400 font-semibold mb-1">Chat tab</p>
                <p>Coordinator replies stream from the daemon's <span class="font-mono text-emerald-400">/chat/dispatch</span> endpoint over the WebSocket. New messages arrive in real time, no reload needed.</p>
              </div>
            </Match>
            <Match when={tab() === 'network'}>
              <div class="text-xs text-gray-600 px-2 leading-relaxed">
                <p class="text-gray-400 font-semibold mb-1">Network tab</p>
                <p>Each card is one identity declared under <span class="font-mono">.meshkore/agents/</span>. Online state reflects the daemon's process tracker plus live <span class="font-mono">agent.online/offline</span> events.</p>
              </div>
            </Match>
            <Match when={tab() === 'config'}>
              <div class="text-xs text-gray-600 px-2 leading-relaxed">
                <p class="text-gray-400 font-semibold mb-1">Config tab</p>
                <p>Read-only view of the current transport and the last 8 WebSocket events. Useful for verifying the cockpit is talking to the daemon you expect.</p>
              </div>
            </Match>
          </Switch>
        </aside>
      </div>
    </div>
  );
}

function TabButton(props: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      class={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
        props.active
          ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/40'
          : 'text-gray-400 hover:text-gray-200 border border-transparent'
      }`}
    >
      {props.label}
    </button>
  );
}

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
