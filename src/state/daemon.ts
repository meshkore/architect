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

export const daemonStore = {
  state,
  attachClient,
  disconnect,
  setPhase,
  setAutoUpdate,
};

// Convenience selectors for components that just need one slice.
export const daemonClient = (): DaemonClient | null => state.client;
export const daemonHealth = (): HealthResponse | null => state.health;
export const daemonVersion = (): DaemonVersion | null => state.version;
export const isDaemonConnected = (): boolean => state.phase === 'connected';
export const isDaemonOutdated = (): boolean => state.outdated;

// Module-load log helps trace boot order in dev.
log.debug('state/daemon module loaded');
