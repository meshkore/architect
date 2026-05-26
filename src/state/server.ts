/**
 * state/server.ts — reactive store for the daemon's `/state` payload.
 *
 * One fat object: cluster info + modules + roadmap (tasks + stats) +
 * initiatives + docs + timeline. Component layers (M4 roadmap panel,
 * M5 chat panel, …) subscribe via `serverStore.state.<slice>` and
 * re-render automatically.
 *
 * Refresh strategy:
 *   - `refresh()` fetches `/state` once.
 *   - The daemon WS emits `state.rebuilt` whenever any file under
 *     `.meshkore/` changes — that handler (M5.4) calls `refresh()`.
 *   - Refresh is debounced (200 ms) because the daemon sometimes
 *     bursts multiple `state.rebuilt` events back-to-back when
 *     several files change in one transaction.
 *
 * `isProjectEmpty` memo replaces the monolith's same-named function:
 * true iff the cluster has zero real initiatives + zero real tasks
 * (the wizard's T1-hello placeholder doesn't count).
 */

import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';
import type { DaemonClient } from '~/lib/daemon-client';
import { log } from '~/lib/log';

export interface ClusterInfo {
  id?: string;
  name?: string;
  type?: string;
  modules?: Array<{ id: string; name?: string; kind?: string }>;
}

export interface ServerTask {
  id: string;
  title: string;
  status: string;
  category?: string;
  module?: string;
  priority?: string;
  initiative?: string;
  tags?: string[];
  body?: string;
  depends_on?: string[];
  blocks?: string[];
  [k: string]: unknown;
}

export interface ServerInitiative {
  id: string;
  title: string;
  status?: string;
  oneliner?: string;
  modules?: string[];
  target?: string;
  body?: string;
  [k: string]: unknown;
}

export interface ServerModule {
  id: string;
  name?: string;
  kind?: string;
  path?: string;
  tasks?: ServerTask[];
  [k: string]: unknown;
}

export interface ServerSnapshot {
  cluster?: ClusterInfo;
  modules?: ServerModule[];
  roadmap?: { tasks?: ServerTask[]; stats?: Record<string, number> };
  initiatives?: ServerInitiative[];
  docs?: Record<string, unknown>;
  timeline?: { recent_events?: Array<{ type: string; [k: string]: unknown }> };
  generated_at?: string;
}

export interface ServerStoreState {
  snapshot: ServerSnapshot | null;
  lastRefresh: string | null;
  refreshing: boolean;
  error: string | null;
}

// ── Per-cluster state (MP2) ──────────────────────────────────────────

/** One snapshot slot per cluster. `state.snapshot` (facade below)
 *  always reflects the currently-active cluster. */
interface ClusterSlice {
  snapshot: ServerSnapshot | null;
  lastRefresh: string | null;
  refreshing: boolean;
  error: string | null;
}

const emptySlice: ClusterSlice = {
  snapshot: null,
  lastRefresh: null,
  refreshing: false,
  error: null,
};

interface ServerStoreInternal {
  byCluster: Record<string, ClusterSlice>;
  // Facade — points at byCluster[active] so existing readers don't
  // need to change.
  snapshot: ServerSnapshot | null;
  lastRefresh: string | null;
  refreshing: boolean;
  error: string | null;
}

const initial: ServerStoreInternal = {
  byCluster: {},
  snapshot: null,
  lastRefresh: null,
  refreshing: false,
  error: null,
};

const [state, setState] = createStore<ServerStoreInternal>(initial);

// One debounce timer + in-flight promise per cluster so a /state
// rebuild storm on cluster A doesn't slow down cluster B.
const refreshTimers = new Map<string, ReturnType<typeof setTimeout>>();
const inFlight = new Map<string, Promise<void>>();

// Active cluster pointer — set from App.tsx whenever daemonStore's
// activeId changes. Kept here (not imported from daemonStore) to
// avoid the import cycle: daemonStore is the source of truth, this
// is just a cached pointer the facade reads.
let activeClusterKey: string | null = null;

function syncFacade(): void {
  const slice = activeClusterKey ? state.byCluster[activeClusterKey] ?? emptySlice : emptySlice;
  setState({
    snapshot: slice.snapshot,
    lastRefresh: slice.lastRefresh,
    refreshing: slice.refreshing,
    error: slice.error,
  });
}

function writeSlice(key: string, patch: Partial<ClusterSlice>): void {
  setState('byCluster', key, (prev) => ({ ...(prev ?? emptySlice), ...patch }));
  if (key === activeClusterKey) syncFacade();
}

async function doRefresh(client: DaemonClient, key: string): Promise<void> {
  writeSlice(key, { refreshing: true, error: null });
  const res = await client.state();
  if (!res.ok) {
    log.warn('server.refresh failed', { cluster: key, status: res.status, body: res.body });
    writeSlice(key, { refreshing: false, error: res.error ?? res.body.slice(0, 200) });
    return;
  }
  writeSlice(key, {
    snapshot: res.data as ServerSnapshot,
    lastRefresh: new Date().toISOString(),
    refreshing: false,
    error: null,
  });
}

/** Debounced per-cluster refresh. Two back-to-back calls on the same
 *  cluster coalesce; different clusters don't interfere. */
function refresh(client: DaemonClient, key: string): Promise<void> {
  const existing = refreshTimers.get(key);
  if (existing) clearTimeout(existing);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      refreshTimers.delete(key);
      const running = inFlight.get(key);
      const next = running ? running.then(() => doRefresh(client, key)) : doRefresh(client, key);
      inFlight.set(key, next.finally(() => {
        if (inFlight.get(key) === next) inFlight.delete(key);
      }));
      next.finally(resolve);
    }, 200);
    refreshTimers.set(key, timer);
  });
}

/** Force-refresh, bypassing the debounce. */
function refreshNow(client: DaemonClient, key: string): Promise<void> {
  const timer = refreshTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    refreshTimers.delete(key);
  }
  const running = inFlight.get(key);
  if (running) return running;
  const p = doRefresh(client, key).finally(() => {
    if (inFlight.get(key) === p) inFlight.delete(key);
  });
  inFlight.set(key, p);
  return p;
}

/** Set which cluster the facade reads from. Called by App.tsx
 *  whenever daemonStore.state.activeId changes. */
function setActiveCluster(key: string | null): void {
  activeClusterKey = key;
  syncFacade();
}

/** Drop one cluster's snapshot (used by the Forget action). */
function clearForCluster(key: string): void {
  setState('byCluster', (prev) => {
    const next = { ...prev };
    delete next[key];
    return next;
  });
  const t = refreshTimers.get(key);
  if (t) { clearTimeout(t); refreshTimers.delete(key); }
  inFlight.delete(key);
  if (key === activeClusterKey) syncFacade();
}

/** Drop EVERY snapshot. Called on app unmount. */
function clearAll(): void {
  for (const [, t] of refreshTimers) clearTimeout(t);
  refreshTimers.clear();
  inFlight.clear();
  activeClusterKey = null;
  setState(initial);
}

/** Legacy `clear()` — wipe the active cluster's slice. Existing
 *  callers that meant "reset the current view" still work. */
function clear(): void {
  if (activeClusterKey) clearForCluster(activeClusterKey);
}

export const serverStore = {
  state,
  refresh,
  refreshNow,
  clear,
  clearForCluster,
  clearAll,
  setActiveCluster,
};

// ── Derived selectors (read from the facade = active cluster) ────────

export const allTasks = createMemo<ServerTask[]>(() => state.snapshot?.roadmap?.tasks ?? []);

export const allInitiatives = createMemo<ServerInitiative[]>(() => state.snapshot?.initiatives ?? []);

export const allModules = createMemo<ServerModule[]>(() => state.snapshot?.modules ?? []);

export const clusterInfo = createMemo<ClusterInfo | null>(() => state.snapshot?.cluster ?? null);

/**
 * isProjectEmpty — true iff the cluster has no real initiatives AND
 * no real tasks. The bootstrap T1-hello placeholder doesn't count
 * (matches the monolith's same-named function).
 */
export const isProjectEmpty = createMemo<boolean>(() => {
  const inis = allInitiatives();
  const tasks = allTasks().filter((t) => t.id !== 'T1-hello');
  return inis.length === 0 && tasks.length === 0;
});

log.debug('state/server loaded (MP2 per-cluster)');
