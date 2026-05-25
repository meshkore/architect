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

const initial: ServerStoreState = {
  snapshot: null,
  lastRefresh: null,
  refreshing: false,
  error: null,
};

const [state, setState] = createStore<ServerStoreState>(initial);

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let inFlight: Promise<void> | null = null;

async function doRefresh(client: DaemonClient): Promise<void> {
  setState({ refreshing: true, error: null });
  const res = await client.state();
  if (!res.ok) {
    log.warn('server.refresh failed', res.status, res.body);
    setState({ refreshing: false, error: res.error ?? res.body.slice(0, 200) });
    return;
  }
  setState({
    snapshot: res.data as ServerSnapshot,
    lastRefresh: new Date().toISOString(),
    refreshing: false,
    error: null,
  });
}

/**
 * Debounced refresh. Multiple back-to-back calls coalesce into one
 * `/state` fetch (200 ms quiet window).
 */
function refresh(client: DaemonClient): Promise<void> {
  if (refreshTimer !== null) clearTimeout(refreshTimer);
  return new Promise((resolve) => {
    refreshTimer = setTimeout(() => {
      refreshTimer = null;
      if (inFlight) {
        // Already running — chain a follow-up so we end with fresh data.
        inFlight = inFlight.then(() => doRefresh(client));
      } else {
        inFlight = doRefresh(client).finally(() => {
          inFlight = null;
        });
      }
      inFlight.finally(resolve);
    }, 200);
  });
}

/** Force-refresh, bypassing the debounce. */
function refreshNow(client: DaemonClient): Promise<void> {
  if (refreshTimer !== null) {
    clearTimeout(refreshTimer);
    refreshTimer = null;
  }
  if (inFlight) return inFlight;
  inFlight = doRefresh(client).finally(() => {
    inFlight = null;
  });
  return inFlight;
}

function clear(): void {
  setState(initial);
}

export const serverStore = {
  state,
  refresh,
  refreshNow,
  clear,
};

// ── Derived selectors ────────────────────────────────────────────────

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

log.debug('state/server loaded');
