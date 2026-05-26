/**
 * ConnectionGate — pre-connect UI.
 *
 * Renders one of five mutually-exclusive states based on the
 * connection probe outcome: probing, no-daemon, unauthorized,
 * cloud-pending, error. Each state is a small private sub-component
 * below; the gate itself just dispatches on `status.kind`.
 */

import { Match, Switch } from 'solid-js';
import type { ConnectionStatus } from '~/lib/connection';

export default function ConnectionGate(props: {
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
