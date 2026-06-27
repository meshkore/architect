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
import { createMemo, createEffect, createRoot } from 'solid-js';
import type { DaemonClient, ChatConvSummary } from '~/lib/daemon-client';
import { chatStore } from '~/state/chat';
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
  /** V107.22 — Repo-relative path the daemon emits for the task's
   *  .md file (`.meshkore/modules/<m>/tasks/<id>-<slug>.md`). The
   *  cockpit fetches this via `client.readMarkdownFile(path)` to
   *  render the rich body on row expand without bloating /state. */
  path?: string;
  depends_on?: string[];
  blocks?: string[];
  // Standard v26 — resolution record pointers (the rich `## Resolution`
  // body is fetched on demand via `path`).
  completed_at?: string | null;
  resolved_by?: string | null;
  resolved_by_conv?: string | null;
  commit_shas?: string[];
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
  /** V107.22 — Repo-relative path the daemon emits for the
   *  initiative's .md file (`.meshkore/roadmap/initiatives/<id>.md`).
   *  The cockpit fetches this via `client.readMarkdownFile(path)`
   *  to render the `## Description` block collapsible without
   *  bloating /state. */
  path?: string;
  // py-1.10.15 — roadmap-ordering-archive fields.
  // `next` is the linked-list pointer the operator curates in
  // frontmatter; the daemon already walks it before emitting the
  // array, so the cockpit consumes the order verbatim. `completed_at`
  // + `commit_sha` populate on auto-archive (D-RM-ARCHIVE-02) and
  // drive the archived-view chronological sort.
  next?: string | null;
  completed_at?: string | null;
  commit_sha?: string | null;
  task_total?: number;
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

/** Legacy back-compat alias. Pre-py-1.11.0 the daemon emitted a
 *  `chat_activity` join on /health and /state; the cockpit consumed it
 *  via selectors. Phase 2 deleted both the payload field and the
 *  selector consumers. ChatConvSummary now carries the same data.
 *  Kept as a re-export so any third-party type importer (devtools,
 *  external tools) doesn't break on a missing symbol. */
export type ChatActivityEntry = ChatConvSummary;

export interface ServerSnapshot {
  cluster?: ClusterInfo;
  modules?: ServerModule[];
  roadmap?: { tasks?: ServerTask[]; stats?: Record<string, number> };
  initiatives?: ServerInitiative[];
  docs?: Record<string, unknown>;
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
  // A-BOOT-01 (V109) — retry a failed /state a couple of times with a
  // short backoff before surfacing the error. A single transient drop
  // (TLS hiccup, daemon mid-restart) used to leave snapshot=null with no
  // retry → the boot gate hung. With the daemon now bounding requests,
  // a quick retry almost always succeeds; the boot escape is the last
  // resort, not the common path.
  writeSlice(key, { refreshing: true, error: null });
  let lastErr = '';
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      await new Promise((r) => setTimeout(r, 400 * attempt));
    }
    // FC-2 — SHORT per-attempt timeout (4s) so a STALLED connection fails fast
    // and we retry on a fresh socket. The default 15s request timeout was
    // longer than the cockpit's 10s boot hard-grace, so a stale keep-alive
    // socket (common right after a daemon restart, when the browser reuses a
    // dead connection to the same host:port) hung /state past the grace → the
    // cockpit gave up with snapshot=null → "No roadmap yet" on a project that
    // actually HAS a roadmap. A 4s cap means attempt 1 retries on a clean
    // connection and the snapshot lands well inside the grace window.
    const res = await client.state(AbortSignal.timeout(4000));
    if (res.ok) {
      consecutiveStateFail.set(key, 0);
      writeSlice(key, {
        snapshot: res.data as ServerSnapshot,
        lastRefresh: new Date().toISOString(),
        refreshing: false,
        error: null,
      });
      return;
    }
    lastErr = res.error ?? res.body.slice(0, 200);
    log.warn('server.refresh attempt failed', {
      cluster: key,
      attempt,
      status: res.status,
    });
  }
  writeSlice(key, { refreshing: false, error: lastErr });
  // Self-healing (2026-06-24): /state for the ACTIVE cluster has now failed
  // a full retry-cycle. After STATE_FAIL_THRESHOLD consecutive cycles, hand
  // the project to the centre-zone reconnect flow (OfflinePanel: auto re-probe
  // /health → re-attach the moment it answers, else manual-restart guidance).
  // This auto-recovers BOTH a real daemon outage AND a wedged tab (the re-probe
  // re-establishes the connection). Dynamic import keeps server.ts free of the
  // daemonStore cycle. Only the active cluster — the rail and other clusters
  // are untouched.
  const n = (consecutiveStateFail.get(key) ?? 0) + 1;
  consecutiveStateFail.set(key, n);
  if (key === activeClusterKey && n >= STATE_FAIL_THRESHOLD) {
    consecutiveStateFail.set(key, 0);
    void import('~/state/daemon')
      .then(({ daemonStore }) => daemonStore.markActiveDisconnected(key, 'lost'))
      .catch(() => undefined);
  }
}

const consecutiveStateFail = new Map<string, number>();
const STATE_FAIL_THRESHOLD = 2; // ~2 retry-cycles (~a few seconds) before reconnect UI

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
  resetTaskConvMap();
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

// ── Live activity selectors (py-1.11.0+) ────────────────────────────
// Single source of truth for "what's live right now" across rail,
// roadmap, and chat-wall affordances. Reads from chatStore.state.convs,
// populated by GET /chat/snapshot + WS conv.* events. Was previously a
// /state.chat_activity join (pre-Phase-2). Same public API so consumers
// (InitiativeCard, TaskCard, ChatThread, ChatRail) don't change.

const allConvs = createMemo<ChatConvSummary[]>(
  () => Object.values(chatStore.state.convs),
);

/** Set of conv ids that have their OWN ChatRunner streaming. */
export const liveConvs = createMemo<Set<string>>(() => {
  const s = new Set<string>();
  for (const c of allConvs()) if (c.live) s.add(c.conv);
  return s;
});

/** Conv id → list of child conv ids it's waiting on. */
export const waitingByConv = createMemo<Record<string, string[]>>(() => {
  const out: Record<string, string[]> = {};
  for (const c of allConvs()) {
    if (c.waiting_on && c.waiting_on.length > 0) out[c.conv] = c.waiting_on;
  }
  return out;
});

/** Conv ids that are coordinating (waiting on >=1 live child) and
 *  whose own runner is NOT live. The rail / wall use this to render
 *  the 'coordinating' state instead of 'idle'. */
export const coordinatingConvs = createMemo<Set<string>>(() => {
  const s = new Set<string>();
  for (const c of allConvs()) {
    if (!c.live && c.coordinating) s.add(c.conv);
  }
  return s;
});

/** Initiative ids that have at least one live conv. */
export const activeInitiativeIds = createMemo<Set<string>>(() => {
  const s = new Set<string>();
  for (const c of allConvs()) {
    if (c.live && c.initiative_id) s.add(c.initiative_id);
  }
  return s;
});

/** Task ids currently being worked on by a live conv. Drives the
 *  per-task chip pulse in the roadmap regardless of the task file's
 *  on-disk `status` field. */
export const activeTaskIds = createMemo<Set<string>>(() => {
  const s = new Set<string>();
  for (const c of allConvs()) {
    if (c.live && c.task_id) s.add(c.task_id);
  }
  return s;
});

/** Live entries grouped by initiative id. Lets InitiativeCard surface
 *  the actual agent ids working on it (e.g. "A015 · A902"). */
export const activeEntriesByInitiative = createMemo<Record<string, ChatConvSummary[]>>(() => {
  const out: Record<string, ChatConvSummary[]> = {};
  for (const c of allConvs()) {
    if (!c.live || !c.initiative_id) continue;
    (out[c.initiative_id] ??= []).push(c);
  }
  return out;
});

/** task id → label of the agent working on it right now (agent_id when
 *  set, else the conv slug). Drives the Queue wall's "who owns this task"
 *  badge in front of each running task row. Up to 3 agents run at once,
 *  each on a distinct task, so this is a clean 1:1 map. */
export const activeAgentByTask = createMemo<Record<string, string>>(() => {
  const out: Record<string, string> = {};
  for (const c of allConvs()) {
    if (!c.live || !c.task_id) continue;
    out[c.task_id] = c.agent_id || c.conv;
  }
  return out;
});

// ── task → conv association (Queue wall summaries) ───────────────────
// The daemon clears a conv's `task_id` once the task completes
// (conv.task_completed), so a live-only lookup loses the link the moment
// we most want it — to show the finished task's summary on the wall. We
// accumulate the association as we observe each conv carry a task_id, and
// keep it for the rest of the session. Reset on cluster switch so a
// project's task ids never resolve to another project's conv.
const [taskConvMap, setTaskConvMap] = createStore<Record<string, string>>({});
createRoot(() => {
  createEffect(() => {
    for (const c of allConvs()) {
      if (!c.task_id || !c.conv) continue;
      if (taskConvMap[c.task_id] !== c.conv) setTaskConvMap(c.task_id, c.conv);
    }
  });
});
/** Reset the accumulated task→conv links (called on cluster switch). */
export function resetTaskConvMap(): void {
  setTaskConvMap(() => ({}));
}
/** Conv that worked (or is working) a given task this session, if known. */
export function convForTask(taskId: string): string | undefined {
  return taskConvMap[taskId];
}

log.debug('state/server loaded (py-1.11.0+ — convs-derived selectors)');
