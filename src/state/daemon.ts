/**
 * state/daemon.ts — multi-instance daemon store (MP1).
 *
 * Holds one `DaemonInstance` per project the operator has touched in
 * this session. Each instance has its own DaemonClient + DaemonWS,
 * so projects keep their WebSockets open even when the operator is
 * looking at a different project. Switching projects is just a
 * pointer swap — no disconnect, no re-fetch.
 *
 * Backwards-compat facade: `state.client`, `state.ws`, `state.health`,
 * `state.wsState`, `state.version`, `state.outdated`,
 * `state.supportsSelfUpdate` still resolve to the ACTIVE instance,
 * so the ~30 existing readers don't have to change. Components that
 * want per-instance data (e.g. the rail rendering each row's WS
 * state) can read `state.instances` directly.
 *
 * Cleanup contract: `disconnectAll()` on app unmount closes every WS.
 * Individual instances are removed by `forget(clusterKey)` (from the
 * rail's Forget action) or replaced when an operator re-adds a
 * project at a new port.
 */

import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { DaemonClient, HealthResponse } from '~/lib/daemon-client';
import { DaemonWS, type DaemonWSState } from '~/lib/ws';
import { parseDaemonVersion, meetsMinimum, type DaemonVersion } from '~/lib/version';
import { attachEventBus } from '~/lib/event-bus';
import { log } from '~/lib/log';

export type ConnectionPhase =
  | 'idle'
  | 'probing'
  | 'connecting'
  | 'connected'
  | 'unauthorized'
  | 'no-daemon'
  | 'error';

/** A single project's live connection. One per cluster_id (or port:N
 *  fallback before cluster_id is known). */
export interface DaemonInstance {
  clusterKey: string;
  port: number;
  client: DaemonClient;
  ws: DaemonWS;
  wsState: DaemonWSState;
  health: HealthResponse;
  version: DaemonVersion | null;
  outdated: boolean;
  supportsSelfUpdate: boolean;
}

// MP4 — event-bus detachers kept OUTSIDE the reactive store, keyed
// by clusterKey. Solid's createStore shouldn't track closures.
const busDetachers = new Map<string, () => void>();

// V85d — Imperative active-change subscribers. After 10 rounds of
// chasing a "createEffect never fires" mystery, the lesson is
// simple: don't bet cross-store coordination on Solid's effect
// timing. Components that NEED to react on a project switch
// register here and we notify them by direct function call.
type ActiveChangeListener = (activeId: string | null) => void;
const activeChangeListeners = new Set<ActiveChangeListener>();

function notifyActiveChanged(): void {
  const id = state.activeId;
  console.log('[RAIL] notifyActiveChanged → listeners count:', activeChangeListeners.size, 'activeId:', id);
  for (const fn of activeChangeListeners) {
    try { fn(id); } catch (e) {
      log.warn('active-change listener threw', e instanceof Error ? e.message : String(e));
    }
  }
}

export interface DaemonStoreState {
  /** All live (or recently-live) instances, keyed by clusterKey. */
  instances: Record<string, DaemonInstance>;
  /** Which instance is currently rendered in the cockpit. */
  activeId: string | null;

  // Boot-time state machine. Drives ConnectionGate vs Cockpit.
  phase: ConnectionPhase;
  errorMessage: string;

  // Backwards-compat singleton view — always mirrors the active
  // instance. Readers across the cockpit use these without caring
  // about the underlying map.
  client: DaemonClient | null;
  ws: DaemonWS | null;
  wsState: DaemonWSState;
  health: HealthResponse | null;
  version: DaemonVersion | null;
  outdated: boolean;
  autoUpdateEnabled: boolean;
  supportsSelfUpdate: boolean;
}

const initial: DaemonStoreState = {
  instances: {},
  activeId: null,
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

function clusterKeyFor(health: HealthResponse, port: number): string {
  const cid = health.cluster_id?.trim();
  return cid && cid.length > 0 ? cid : `port:${port}`;
}

/** Push the active instance's data into the singleton facade so old
 *  readers stay reactive without code changes. */
function syncFacade(): void {
  const id = state.activeId;
  const inst = id ? state.instances[id] : null;
  if (!inst) {
    setState({
      client: null,
      ws: null,
      wsState: 'idle',
      health: null,
      version: null,
      outdated: false,
      supportsSelfUpdate: false,
    });
    return;
  }
  setState({
    client: inst.client,
    ws: inst.ws,
    wsState: inst.wsState,
    health: inst.health,
    version: inst.version,
    outdated: inst.outdated,
    supportsSelfUpdate: inst.supportsSelfUpdate,
  });
}

/**
 * Attach a freshly-connected daemon. Creates a new instance OR
 * updates an existing one (when the operator re-probes the same
 * cluster on a different port). Sets it active.
 *
 * Existing instances for OTHER clusters are left alone — their WS
 * stays open. That's the parallel-multi-project win.
 */
function attachClient(client: DaemonClient, health: HealthResponse): void {
  const v = parseDaemonVersion(health.version);
  const supportsSelfUpdate = (health.features ?? []).includes('self-update');
  const port = health.port;
  const key = clusterKeyFor(health, port);

  // Replace any prior instance under the same key (re-attach scenario).
  const prior = state.instances[key];
  if (prior && prior !== undefined) {
    const priorDetach = busDetachers.get(key);
    if (priorDetach) { priorDetach(); busDetachers.delete(key); }
    try { prior.ws.close(); } catch { /* already closed */ }
  }

  const ws = new DaemonWS(client.transport);
  // Wire wsState updates so the rail and header can render per-instance.
  ws.onState((s) => {
    if (state.instances[key]) {
      setState('instances', key, 'wsState', s);
      if (state.activeId === key) setState('wsState', s);
    }
  });

  const inst: DaemonInstance = {
    clusterKey: key,
    port,
    client,
    ws,
    wsState: 'idle',
    health,
    version: v,
    outdated: !meetsMinimum(v),
    supportsSelfUpdate,
  };
  // Batch reactive writes (one tick for downstream memos), then
  // notify the imperative subscribers so the side-effect bus runs
  // deterministically regardless of Solid's effect scheduling.
  batch(() => {
    setState('instances', key, inst);
    setState({
      activeId: key,
      phase: 'connected',
      errorMessage: '',
    });
    syncFacade();
  });
  ws.connect();
  const detachBus = attachEventBus(ws, client, key);
  busDetachers.set(key, detachBus);
  notifyActiveChanged();
}

/**
 * Disconnect ONE instance (close its WS + remove from the map).
 * If it was active, fall back to any other live instance, or idle.
 * Used by `forget(clusterKey)` from the rail.
 */
function disconnectInstance(key: string): void {
  const inst = state.instances[key];
  if (!inst) return;
  const wasActive = state.activeId === key;
  // Detach the event-bus FIRST so a late WS-close event doesn't
  // try to write to a disposed cluster slice.
  const detachBus = busDetachers.get(key);
  if (detachBus) {
    detachBus();
    busDetachers.delete(key);
  }
  try { inst.ws.close(); } catch { /* already closed */ }
  batch(() => {
    setState('instances', (prev) => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    if (wasActive) {
      const fallback = Object.keys(state.instances)[0] ?? null;
      setState('activeId', fallback);
      if (!fallback) setState('phase', 'idle');
    }
    syncFacade();
  });
  if (wasActive) notifyActiveChanged();
}

/**
 * Close every instance. Called once on app unmount.
 */
function disconnectAll(): void {
  for (const [, detach] of busDetachers) {
    try { detach(); } catch { /* ignore */ }
  }
  busDetachers.clear();
  for (const key of Object.keys(state.instances)) {
    try { state.instances[key]?.ws.close(); } catch { /* ignore */ }
  }
  const hadActive = state.activeId !== null;
  batch(() => {
    setState({
      instances: {},
      activeId: null,
      phase: 'idle',
    });
    syncFacade();
  });
  if (hadActive) notifyActiveChanged();
}

/**
 * Subscribe to active-project changes. Imperative — fires
 * synchronously from attachClient / switchToPort / disconnectInstance
 * / disconnectAll. Use this for cross-store side effects that MUST
 * run on switch (the App-level bus uses it).
 */
function onActiveChanged(fn: ActiveChangeListener): () => void {
  activeChangeListeners.add(fn);
  return () => { activeChangeListeners.delete(fn); };
}

/**
 * Legacy single-tenant `disconnect()`. Kept for callers that still
 * mean "close the active connection" — internally just disconnects
 * the active instance.
 */
function disconnect(): void {
  if (state.activeId) disconnectInstance(state.activeId);
}

function setPhase(phase: ConnectionPhase, errorMessage = ''): void {
  setState({ phase, errorMessage });
}

function setAutoUpdate(flag: boolean): void {
  setState('autoUpdateEnabled', flag);
}

/**
 * Switch the cockpit to another project, OPENING a parallel WS if
 * we haven't seen it before, or just flipping the pointer if we
 * already have an instance for it.
 *
 * Returns true on success. Never closes other projects' WS.
 */
async function switchToPort(port: number): Promise<boolean> {
  console.log('[RAIL] switchToPort entry', { port, current: state.health?.port ?? null, instances: Object.keys(state.instances) });
  log.info('switchToPort requested', { port, current: state.health?.port ?? null });

  // Already-attached instance for this port? Just flip the pointer.
  const existing = Object.entries(state.instances).find(([, i]) => i.port === port);
  if (existing) {
    const [key, inst] = existing;
    console.log('[RAIL] switchToPort reusing existing instance', { key, port });
    if (state.activeId !== key) {
      batch(() => {
        setState({ activeId: key, phase: 'connected', errorMessage: '' });
        syncFacade();
      });
      if (inst.wsState === 'fatal' || inst.wsState === 'closed') {
        try { inst.ws.connect(); } catch { /* ignore */ }
      }
      notifyActiveChanged();
    }
    return true;
  }

  // New project — probe /health, build a client, attach.
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
  const tokenKey = clusterTokenKey({ cluster_id: health.cluster_id ?? null, port });
  const token = tokenForCluster(tokenKey) || oldToken;
  const { localTransport } = await import('~/lib/transport');
  const { DaemonClient } = await import('~/lib/daemon-client');
  const client = new DaemonClient(localTransport(port, token));
  attachClient(client, health);
  console.log('[RAIL] switchToPort attached new instance', { port, cluster_id: health.cluster_id ?? null });
  log.info('switchToPort attached', { port, cluster_id: health.cluster_id ?? null });
  return true;
}

/**
 * Re-fetch /health on the active client and refresh the version gate.
 * Used by the V47 modal's "I've updated — recheck" button. Returns
 * true iff the daemon now meets MIN_DAEMON_VERSION.
 */
async function recheckHealth(): Promise<boolean> {
  const id = state.activeId;
  const inst = id ? state.instances[id] : null;
  if (!inst) return false;
  const r = await inst.client.health();
  if (!r.ok) return false;
  const v = parseDaemonVersion(r.data.version);
  const supportsSelfUpdate = (r.data.features ?? []).includes('self-update');
  setState('instances', id!, {
    health: r.data,
    version: v,
    outdated: !meetsMinimum(v),
    supportsSelfUpdate,
  });
  syncFacade();
  return !state.outdated;
}

export const daemonStore = {
  state,
  attachClient,
  disconnect,
  disconnectAll,
  disconnectInstance,
  setPhase,
  setAutoUpdate,
  recheckHealth,
  switchToPort,
  onActiveChanged,
};

// Convenience selectors for components that just need one slice.
export const daemonClient = (): DaemonClient | null => state.client;
export const daemonHealth = (): HealthResponse | null => state.health;
export const daemonVersion = (): DaemonVersion | null => state.version;
export const isDaemonConnected = (): boolean => state.phase === 'connected';
export const isDaemonOutdated = (): boolean => state.outdated;

log.debug('state/daemon module loaded (MP1 multi-instance)');
