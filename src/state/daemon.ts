/**
 * state/daemon.ts — reactive store for the daemon connection.
 *
 * Owns: transport config, the `DaemonClient`, the `DaemonWS`, daemon
 * version + the version gate, and the connection state machine the
 * header pill renders.
 *
 * Why a dedicated store: connection state is read by many components
 * (header pill, version-mismatch modal, every dispatch handler) and
 * written from a single bootstrap path (lib/connection.ts). Solid's
 * `createStore` keeps reads cheap and writes path-localised.
 *
 * Cleanup: callers MUST invoke `daemon.disconnect()` on unmount
 * (`onCleanup`) — it closes the WS, cancels pending reconnects, and
 * frees the client. Without this we leak sockets across HMR / route
 * changes (audit §2.3).
 */

import { createStore } from 'solid-js/store';
import type { DaemonClient, HealthResponse } from '~/lib/daemon-client';
import { DaemonWS, type DaemonWSState } from '~/lib/ws';
import { parseDaemonVersion, meetsMinimum, type DaemonVersion } from '~/lib/version';
import { log } from '~/lib/log';

export type ConnectionPhase =
  | 'idle'
  | 'probing'
  | 'connecting'
  | 'connected'
  | 'unauthorized'
  | 'no-daemon'
  | 'error';

export interface DaemonStoreState {
  phase: ConnectionPhase;
  errorMessage: string;
  client: DaemonClient | null;
  ws: DaemonWS | null;
  wsState: DaemonWSState;
  health: HealthResponse | null;
  version: DaemonVersion | null;
  /** Version gate — true when the daemon is older than MIN_DAEMON_VERSION. */
  outdated: boolean;
  /** `cluster.yaml.daemon.auto_update: true` (read from /state). */
  autoUpdateEnabled: boolean;
  /** Daemon advertises `self-update` in its /health features list. */
  supportsSelfUpdate: boolean;
}

const initial: DaemonStoreState = {
  phase: 'idle',
  errorMessage: '',
  client: null,
  ws: null,
  wsState: 'idle',
  health: null,
  version: null,
  outdated: false,
  autoUpdateEnabled: false,
  supportsSelfUpdate: false,
};

const [state, setState] = createStore<DaemonStoreState>(initial);

function attachClient(client: DaemonClient, health: HealthResponse): void {
  const v = parseDaemonVersion(health.version);
  const supportsSelfUpdate = (health.features ?? []).includes('self-update');
  setState({
    client,
    health,
    version: v,
    outdated: !meetsMinimum(v),
    supportsSelfUpdate,
    phase: 'connected',
    errorMessage: '',
  });
  // Start the WS feed.
  const ws = new DaemonWS(client.transport);
  ws.onState((s) => setState('wsState', s));
  setState('ws', ws);
  ws.connect();
}

function disconnect(): void {
  if (state.ws) {
    state.ws.close();
  }
  setState({
    client: null,
    ws: null,
    wsState: 'idle',
    health: null,
    version: null,
    outdated: false,
    supportsSelfUpdate: false,
    phase: 'idle',
  });
}

function setPhase(phase: ConnectionPhase, errorMessage = ''): void {
  setState({ phase, errorMessage });
}

function setAutoUpdate(flag: boolean): void {
  setState('autoUpdateEnabled', flag);
}

/**
 * Hot-swap the connection to a different daemon port — no page reload.
 *
 * Tears down the current WS, probes /health on the new port, attaches
 * a fresh client (which spins up a new WS), and lets the App's
 * `connection.connected` effect run the cluster-bind side effects
 * (serverStore.refresh, projectsStore.upsert, chatStore.bindCluster,
 * eventBus re-attach). Returns true on success.
 *
 * The caller is responsible for surfacing failure to the operator
 * (e.g. via a toast). On success the cockpit visually flips to the
 * new project's data within a few hundred milliseconds without losing
 * the page.
 */
async function switchToPort(port: number): Promise<boolean> {
  console.log('[RAIL] switchToPort entry', { port, current: state.health?.port ?? null });
  log.info('switchToPort requested', { port, current: state.health?.port ?? null });
  if (state.health?.port === port) {
    console.log('[RAIL] switchToPort no-op (already there)');
    log.debug('switchToPort no-op — already on this port');
    return true;
  }

  // V82 — Smooth swap: prepare the new connection BEFORE tearing down
  // the old one so the cockpit never visibly drops to a disconnected
  // state mid-switch. Sequence:
  //   1. probe /health on the new port (old WS still alive, snapshot
  //      still rendering).
  //   2. resolve token + build new DaemonClient.
  //   3. atomic swap: disconnect old WS, attachClient(new) — Solid
  //      re-renders downstream subscribers in the same tick.
  // If step 1 or 2 fails, we leave the existing connection untouched.
  const oldToken = state.client?.transport.token ?? '';
  const probeUrl = `http://localhost:${port}/health`;
  let health: HealthResponse;
  try {
    console.log('[RAIL] switchToPort probing', probeUrl);
    const r = await fetch(probeUrl);
    if (!r.ok) {
      console.warn('[RAIL] switchToPort probe non-OK', { port, status: r.status });
      log.warn('switchToPort probe failed', port, r.status);
      return false;
    }
    health = (await r.json()) as HealthResponse;
    console.log('[RAIL] switchToPort probe OK', { port, cluster_id: health.cluster_id });
  } catch (e) {
    console.warn('[RAIL] switchToPort fetch threw', { port, error: e instanceof Error ? e.message : String(e) });
    log.warn('switchToPort fetch threw', port, e);
    return false;
  }
  const { clusterTokenKey, tokenForCluster } = await import('~/lib/tokens');
  const key = clusterTokenKey({ cluster_id: health.cluster_id ?? null, port });
  const token = tokenForCluster(key) || oldToken;
  const { localTransport } = await import('~/lib/transport');
  const { DaemonClient } = await import('~/lib/daemon-client');
  const client = new DaemonClient(localTransport(port, token));
  // Atomic swap. Also drop stale snapshot up front so the cockpit
  // visually flushes the OLD project's data while the new one loads,
  // rather than briefly showing it under the new project's name. The
  // App.tsx side-effect bus will run chatStore.bindCluster +
  // serverStore.refreshNow once attachClient lands.
  const { serverStore } = await import('~/state/server');
  serverStore.clear();
  disconnect();
  attachClient(client, health);
  console.log('[RAIL] switchToPort attached', { port, cluster_id: health.cluster_id ?? null });
  log.info('switchToPort attached', { port, cluster_id: health.cluster_id ?? null });
  return true;
}

/**
 * Re-fetch /health on the active client and refresh the version gate.
 * Used by the V47 modal's "I've updated — recheck" button. Returns
 * true iff the daemon now meets MIN_DAEMON_VERSION.
 */
async function recheckHealth(): Promise<boolean> {
  const client = state.client;
  if (!client) return false;
  const r = await client.health();
  if (!r.ok) return false;
  const v = parseDaemonVersion(r.data.version);
  const supportsSelfUpdate = (r.data.features ?? []).includes('self-update');
  setState({
    health: r.data,
    version: v,
    outdated: !meetsMinimum(v),
    supportsSelfUpdate,
  });
  return !state.outdated;
}

export const daemonStore = {
  state,
  attachClient,
  disconnect,
  setPhase,
  setAutoUpdate,
  recheckHealth,
  switchToPort,
};

// Convenience selectors for components that just need one slice.
export const daemonClient = (): DaemonClient | null => state.client;
export const daemonHealth = (): HealthResponse | null => state.health;
export const daemonVersion = (): DaemonVersion | null => state.version;
export const isDaemonConnected = (): boolean => state.phase === 'connected';
export const isDaemonOutdated = (): boolean => state.outdated;

// Module-load log helps trace boot order in dev.
log.debug('state/daemon module loaded');
