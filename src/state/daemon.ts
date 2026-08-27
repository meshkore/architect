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
 *
 * AX15 — this file owns STATE. The switch flow lives in
 * `state/daemon/switch-flow.ts`, the WS-fatal recovery in
 * `state/daemon/recovery.ts`, and the token-prompt UI registers itself
 * through `setTokenPromptHandler` (there is no store → component
 * import anywhere in the cockpit).
 */

import { batch } from 'solid-js';
import { createStore } from 'solid-js/store';
import { DaemonClient, type HealthResponse, setDaemonVersionListener, setReauthHandler } from '~/lib/daemon-client';
import { DaemonWS, type DaemonWSState } from '~/lib/ws';
import { parseDaemonVersion, meetsMinimum, isDaemonAhead, isFeatureGapped, type DaemonVersion } from '~/lib/version';
import { attachEventBus } from '~/lib/event-bus';
import { log } from '~/lib/log';
// V93 — Static imports for everything the project-switch path needs.
// Previously these were `await import(...)` lower in the file; Vite
// emitted `~/lib/auth` as its own chunk (no other static importers),
// and any deploy invalidated that chunk for tabs still running the
// old main bundle, breaking the switch silently. Static imports put
// everything in the main chunk, so a stale tab either Just Works
// (everything already loaded) or the chunk-load guard reloads it.
import { daemonHttpBase } from '~/lib/transport';
import { clusterTokenKey, saveTokenForCluster } from '~/lib/tokens';
import { bumpClusterEpoch } from '~/lib/swap-guard';
import { createWsFatalRecovery } from '~/state/daemon/recovery';
import {
  runSwitchToPort,
  type SwitchDeps,
  type SwitchOutcome,
  type TokenPromptPort,
  type TokenPromptRequest,
} from '~/state/daemon/switch-flow';

export type { SwitchOutcome, TokenPromptRequest, TokenPromptPort };

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
  /** True when version < MIN_DAEMON_VERSION. Locks the cockpit body
   *  via the existing DaemonOutdatedModal flow. */
  outdated: boolean;
  /** V94 — True when version > EXPECTED_DAEMON_VERSION (major or
   *  minor). The cockpit was built against an older daemon and
   *  WS event shapes may have changed; surface a "refresh
   *  recommended" banner. Does not block. */
  ahead: boolean;
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

// AX15 — the token-prompt UI registers itself here (mirrors
// setReauthHandler). Before this, the store imported the modal
// component directly — the only store → component edge in the codebase.
let tokenPromptHandler: TokenPromptPort | null = null;
function setTokenPromptHandler(h: TokenPromptPort | null): void {
  tokenPromptHandler = h;
}
const tokenPrompt: TokenPromptPort = {
  open: (req: TokenPromptRequest) => {
    if (!tokenPromptHandler) {
      log.warn('token prompt requested but no handler is registered', { cluster: req.project.cluster_id });
      return;
    }
    tokenPromptHandler.open(req);
  },
  clear: () => tokenPromptHandler?.clear(),
};

function notifyActiveChanged(): void {
  // AX5 — advance the swap epoch SYNCHRONOUSLY, before anything can
  // await. Every in-flight hydrate captured an older epoch and will now
  // drop its result instead of writing another project's data into this
  // one (`lib/swap-guard.ts`).
  bumpClusterEpoch(state.activeId);
  // Defer so we never run the cross-store side-effect bus synchronously
  // inside a Solid effect (status → attachClient → notifyActiveChanged).
  // Nested flush waves during mount caused runUpdates/completeUpdates to
  // recurse until "Maximum call stack size exceeded" on page refresh.
  queueMicrotask(() => {
    const id = state.activeId;
    // The active selection changed → drop any pending token prompt so it
    // doesn't linger over a different project (the prompt is per-cluster and
    // only ever opened for the one being switched to; opening does not fire
    // this, so this never clears a freshly-opened prompt).
    tokenPrompt.clear();
    for (const fn of activeChangeListeners) {
      try { fn(id); } catch (e) {
        log.warn('active-change listener threw', e instanceof Error ? e.message : String(e));
      }
    }
  });
}

/**
 * V86b — A row the operator clicked on whose daemon isn't reachable.
 * Independent from `activeId` (which only points at a real, attached
 * instance). When `offlineSelection` is non-null, the cockpit body
 * renders an `OfflinePanel` with start-daemon instructions, and the
 * row carries the green selected-bar in the rail so the operator
 * still gets a visual confirmation of "yes, this is the one I picked".
 */
export interface OfflineSelection {
  key: string;
  port: number;
  cluster_id: string | null;
  cluster_name: string | null;
  display: string;
  /** Why the probe failed — used by the panel to tailor the message.
   *  'lost' = a previously-LIVE connection dropped (reconnecting), vs the
   *  boot-time 'no-daemon'/'tls'/'unknown' (never connected). */
  reason: 'no-daemon' | 'tls' | 'unknown' | 'lost';
}

/** py-1.12.5 — Runner auth request pushed from event-bus into the
 *  store so it lives inside a properly-owned createStore (no
 *  module-level createSignal / createRoot needed). */
export interface RunnerAuthRequest {
  platform: string;
  conv: string;
  ts: string;
}

export interface DaemonStoreState {
  /** All live (or recently-live) instances, keyed by clusterKey. */
  instances: Record<string, DaemonInstance>;
  /** Which instance is currently rendered in the cockpit. */
  activeId: string | null;
  /** Operator's selection when no live daemon backs it. Mutually
   *  exclusive with `activeId` — picking one clears the other. */
  offlineSelection: OfflineSelection | null;

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
  /** V94 — mirrors the active instance's `ahead` flag for top-level
   *  consumers (banner component). */
  ahead: boolean;
  autoUpdateEnabled: boolean;
  supportsSelfUpdate: boolean;

  /** py-1.12.5 — pending runner auth request (null = none). */
  runnerAuth: RunnerAuthRequest | null;
}

const initial: DaemonStoreState = {
  instances: {},
  activeId: null,
  offlineSelection: null,
  phase: 'idle',
  errorMessage: '',
  client: null,
  ws: null,
  wsState: 'idle',
  health: null,
  version: null,
  outdated: false,
  ahead: false,
  autoUpdateEnabled: false,
  supportsSelfUpdate: false,
  runnerAuth: null,
};

const [state, setState] = createStore<DaemonStoreState>(initial);

/**
 * V94 — Wire the daemon-client's per-response version-header fan-out
 * into this store. When ANY HTTP call to ANY instance comes back with
 * a different `x-meshkore-daemon-version` than what we've recorded,
 * update that instance's version + recompute its outdated/ahead
 * flags. Closes the gap where a daemon self-update mid-session left
 * the cockpit thinking it was still talking to the old version.
 */
// FC-2 — 401 self-heal handler. Any authed request that 401s re-fetches the
// daemon's current local token (origin-gated /auth/local-token) and persists it
// under the matching instance's cluster key, so a stale token (e.g. cached from
// the per-daemon era before centralization) recovers silently + retries once.
setReauthHandler(async (httpBase) => {
  const m = /:(\d+)(?:\/|$)/.exec(httpBase);
  const port = m && m[1] ? parseInt(m[1], 10) : 0;
  if (!port) return null;
  const fresh = await fetchLocalToken(port);
  if (!fresh) return null;
  const inst = Object.values(state.instances).find(
    (i) => i.client.transport.httpBase === httpBase,
  );
  const clusterId = inst?.health.cluster_id ?? null;
  saveTokenForCluster(clusterTokenKey({ cluster_id: clusterId, port }), fresh);
  log.info('401 self-heal — refreshed local token', { port, cluster: clusterId });
  return fresh;
});

setDaemonVersionListener((httpBase, version) => {
  // Find the instance whose client's transport matches this URL base.
  // Iterating is fine — operators rarely connect to >5 projects.
  const entries = Object.entries(state.instances);
  for (const [key, inst] of entries) {
    if (inst.client.transport.httpBase !== httpBase) continue;
    const recorded = inst.version?.raw;
    if (recorded === version) return; // unchanged — no-op
    const next = parseDaemonVersion(version);
    if (!next) return; // unparseable — ignore (daemon shouldn't ever send this)
    // V107.14 — outdated = version too old OR required features missing.
    // Single trigger feeds the unified DaemonOutdatedPanel; no parallel
    // inline banner. Feature list lives in lib/version.ts.
    const featureGap = isFeatureGapped(inst.health.features);
    const nextOutdated = !meetsMinimum(next) || featureGap;
    const nextAhead = isDaemonAhead(next);
    log.info('daemon version header changed', {
      cluster: key, from: recorded ?? null, to: next.raw, outdated: nextOutdated, ahead: nextAhead,
    });
    setState('instances', key, (prev) => ({
      ...prev,
      version: next,
      outdated: nextOutdated,
      ahead: nextAhead,
    }));
    if (state.activeId === key) syncFacade();
    return;
  }
});

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
      ahead: false,
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
    ahead: inst.ahead,
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
  const supportsSelfUpdate = (health.features ?? []).includes('self_update');
  // py-1.2.0 — daemon reports `cluster.yaml.daemon.auto_update` in
  // /health.daemon.auto_update. Default true if the field is absent
  // (the daemon's own default). When false, the cockpit shows the
  // chooser modal instead of running the silent flow.
  const autoUpdateEnabled = health.daemon?.auto_update ?? true;
  const port = health.port;
  const key = clusterKeyFor(health, port);

  // V86f — re-attach guard.
  //
  // Intent: don't recreate a healthy WebSocket when somebody calls
  // `attachClient` for a cluster we're already connected to. The boot
  // createEffect in App.tsx is one such caller (it re-runs whenever
  // `status` changes); without this guard, every re-fire closes the
  // open WS and dials a new one, piling up against Chrome's per-origin
  // socket pool ("Insufficient resources").
  //
  // V86e mistake: the previous version of this guard ALSO bumped
  // `activeId` back to `key` and cleared `offlineSelection` when they
  // didn't match. That clobbered the operator's "I want to see this
  // offline row" pick. Now the guard is fully idempotent: if we already
  // have a working instance for this key, we do NOTHING and return.
  // Selection is owned exclusively by the switch flow, `selectOffline`
  // and `clearActiveSelection`.
  const prior = state.instances[key];
  if (prior && prior.client.transport.token === client.transport.token && prior.wsState !== 'fatal') {
    return;
  }
  // Otherwise replace the prior instance entirely (new token, fatal
  // WS that needs a fresh dial, or first-ever attach).
  if (prior && prior !== undefined) {
    const priorDetach = busDetachers.get(key);
    if (priorDetach) { priorDetach(); busDetachers.delete(key); }
    try { prior.ws.close(); } catch { /* already closed */ }
  }

  const ws = new DaemonWS(client.transport);
  // 2026-06-12 — Auto-recover when the cluster's daemon moved ports, and
  // (AX1) redial when it is still on the same one. Policy lives in
  // state/daemon/recovery.ts; this closure only mirrors wsState.
  const onFatal = createWsFatalRecovery(key, {
    instanceInfo: (k) => {
      const i = state.instances[k];
      return i ? { port: i.port, clusterId: i.health?.cluster_id ?? null } : null;
    },
    redial: (k) => { try { state.instances[k]?.ws.connect(); } catch { /* next tick retries */ } },
    findClusterPort: async (cid) => {
      const { findClusterPort } = await import('~/components/projects-rail/discovery');
      return findClusterPort(cid);
    },
    switchToPort: (p) => switchToPortDetailed(p),
    markDisconnected: (k) => markActiveDisconnected(k),
  });
  ws.onState((s) => {
    if (state.instances[key]) {
      setState('instances', key, 'wsState', s);
      if (state.activeId === key) setState('wsState', s);
    }
    onFatal(s);
  });

  const inst: DaemonInstance = {
    clusterKey: key,
    port,
    client,
    ws,
    wsState: 'idle',
    health,
    version: v,
    // V107.14 — outdated covers BOTH version-too-old AND missing
    // required features. See lib/version.ts REQUIRED_DAEMON_FEATURES.
    outdated: !meetsMinimum(v) || isFeatureGapped(health.features),
    ahead: isDaemonAhead(v),
    supportsSelfUpdate,
  };
  // Batch reactive writes (one tick for downstream memos), then
  // notify the imperative subscribers so the side-effect bus runs
  // deterministically regardless of Solid's effect scheduling.
  batch(() => {
    setState('instances', key, inst);
    setState({
      activeId: key,
      offlineSelection: null,
      phase: 'connected',
      errorMessage: '',
      autoUpdateEnabled,
    });
    syncFacade();
  });
  ws.connect();
  const detachBus = attachEventBus(ws, client, key, setRunnerAuth);
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

// ── Project switching ───────────────────────────────────────────────
// Flow lives in state/daemon/switch-flow.ts; this is the state half it
// drives. FC-2: one daemon serves many projects on one port, so an
// instance is identified by its projectId, not its port.

const switchDeps: SwitchDeps = {
  findExisting: (port, projectId) => {
    const hit = Object.entries(state.instances).find(([, i]) =>
      projectId ? i.client.transport.projectId === projectId : i.port === port,
    );
    return hit ? { key: hit[0] } : null;
  },
  activate: (key) => {
    if (state.activeId === key) return;
    const inst = state.instances[key];
    batch(() => {
      setState({ activeId: key, offlineSelection: null, phase: 'connected', errorMessage: '' });
      syncFacade();
    });
    if (inst && (inst.wsState === 'fatal' || inst.wsState === 'closed')) {
      try { inst.ws.connect(); } catch { /* ignore */ }
    }
    notifyActiveChanged();
  },
  currentToken: () => state.client?.transport.token ?? '',
  attach: attachClient,
  fetchLocalToken,
  tokenPrompt,
};

async function switchToPortDetailed(port: number, projectId?: string): Promise<SwitchOutcome> {
  return runSwitchToPort(switchDeps, port, projectId);
}

async function switchToPort(port: number): Promise<boolean> {
  const r = await switchToPortDetailed(port);
  return r.ok;
}

/**
 * V86b — select a row whose daemon isn't reachable. Clears `activeId`
 * (no live instance backs this pick), parks the operator's choice in
 * `offlineSelection` so the rail can render the row as selected and
 * the cockpit can render the OfflinePanel. Notifies listeners so the
 * UI updates immediately (same path as a real switch).
 */
function selectOffline(target: OfflineSelection): void {
  batch(() => {
    setState({
      activeId: null,
      offlineSelection: target,
      phase: 'no-daemon',
      errorMessage: '',
    });
    syncFacade();
  });
  notifyActiveChanged();
}

function clearOfflineSelection(): void {
  if (!state.offlineSelection) return;
  setState('offlineSelection', null);
}

/** GET the daemon's bearer token from a LOCAL (loopback) daemon for the
 *  same-origin cockpit (py-1.27.6 auto-unlock). Returns null on any failure
 *  (non-local / older daemon / opted out / network) — caller falls back to
 *  the explicit token flow. The token never leaves this machine. */
async function fetchLocalToken(port: number): Promise<string | null> {
  try {
    const r = await fetch(`${daemonHttpBase(port)}/auth/local-token`, {
      signal: AbortSignal.timeout(2500),
    });
    if (!r.ok) return null;
    const d = (await r.json().catch(() => ({}))) as { token?: string };
    return typeof d.token === 'string' && d.token.length > 0 ? d.token : null;
  } catch {
    return null;
  }
}

/** Self-healing reconnect entry point (2026-06-24). Called when the ACTIVE
 *  cluster's connection is lost (HTTP refresh fails repeatedly, or WS goes
 *  fatal with no live port). Tears the dead instance down and drops into the
 *  OfflinePanel for THIS project — which auto-reconnects (polls /health,
 *  re-attaches the moment it answers) and, if it stays down, shows manual
 *  daemon-restart guidance. Renders in the centre project zone only; the
 *  left projects rail is untouched so the other clusters stay usable. */
function markActiveDisconnected(key: string, reason: OfflineSelection['reason'] = 'lost'): void {
  const inst = state.instances[key];
  if (!inst || state.activeId !== key) return; // only the active, still-tracked cluster
  const sel: OfflineSelection = {
    key,
    port: inst.port,
    cluster_id: inst.health?.cluster_id ?? null,
    cluster_name: inst.health?.cluster_name ?? null,
    display: inst.health?.cluster_name ?? inst.health?.cluster_id ?? `:${inst.port}`,
    reason,
  };
  log.warn('connection lost — entering reconnecting (centre zone)', { key, port: inst.port, reason });
  disconnectInstance(key); // close WS/bus
  selectOffline(sel); // phase 'no-daemon' + offlineSelection → OfflinePanel mounts + auto-reconnects
}

/**
 * V86c — Force the cockpit into the "no selection" state. Drops the
 * active instance pointer AND the offline pick, leaves any open WS
 * connections alone (`disconnectInstance` already closed the row the
 * operator deleted). Called by `forgetProjectImmediate` so the next
 * paint hits the empty-rail panel and the operator picks the next
 * project explicitly. We do NOT want `disconnectInstance`'s
 * auto-fallback-to-first-instance behaviour here — the operator just
 * told us they're done with that row.
 */
function clearActiveSelection(): void {
  if (state.activeId === null && state.offlineSelection === null) return;
  batch(() => {
    setState({ activeId: null, offlineSelection: null, phase: 'idle', errorMessage: '' });
    syncFacade();
  });
  notifyActiveChanged();
}

/**
 * Re-fetch /health on the active client and refresh the version gate.
 * Used by the V47 modal's "I've updated — recheck" button. Returns
 * true iff the daemon now meets MIN_DAEMON_VERSION.
 */
async function recheckHealth(): Promise<boolean> {
  const id = state.activeId;
  const inst = id ? state.instances[id] : null;
  if (!inst || !id) return false;
  const r = await inst.client.health();
  if (!r.ok) return false;
  const v = parseDaemonVersion(r.data.version);
  const supportsSelfUpdate = (r.data.features ?? []).includes('self_update');
  setState('instances', id, {
    health: r.data,
    version: v,
    // V107.14 — recheck after operator-triggered update also accounts for
    // the feature gate (a daemon at-or-above MIN can still lack features).
    outdated: !meetsMinimum(v) || isFeatureGapped(r.data.features),
    // A-HEALTH-01 (V109) — recheck must also recompute `ahead`, else a
    // now-AHEAD daemon keeps a stale flag and the DaemonAheadPanel gate
    // never fires (refreshAllInstanceHealth already does this).
    ahead: isDaemonAhead(v),
    supportsSelfUpdate,
  });
  syncFacade();
  return !state.outdated;
}

function setRunnerAuth(req: RunnerAuthRequest | null): void {
  setState('runnerAuth', req);
}

// Periodic /health re-poll so the daemon version shown in the Header
// reflects auto-updates without waiting for a WS reconnect. 60s is a
// deliberate hammer pick while user-count is tiny; bump up once the
// fleet grows. Refreshes every connected instance (not just the
// active one) so per-project version state stays current too.
const HEALTH_POLL_MS = 60_000;

/** AX6 — subscribers that want to piggyback on the health-poll cadence
 *  (the rail refreshes the liveness of rows it has NO instance for). */
const healthPollListeners = new Set<() => void>();
function onHealthPoll(fn: () => void): () => void {
  healthPollListeners.add(fn);
  return () => { healthPollListeners.delete(fn); };
}

async function refreshAllInstanceHealth(): Promise<void> {
  const ids = Object.keys(state.instances);
  for (const id of ids) {
    const inst = state.instances[id];
    if (!inst) continue;
    try {
      const r = await inst.client.health();
      if (!r.ok) continue;
      const v = parseDaemonVersion(r.data.version);
      const supportsSelfUpdate = (r.data.features ?? []).includes('self_update');
      setState('instances', id, {
        health: r.data,
        version: v,
        outdated: !meetsMinimum(v) || isFeatureGapped(r.data.features),
        ahead: isDaemonAhead(v),
        supportsSelfUpdate,
      });
      // A-WS-01 (V109) — the daemon answered, so if its WS gave up
      // (fatal/closed — e.g. a same-port restart that outlasted the
      // 6-retry budget) revive it now. connect() resets the retry
      // counter, so live chat/run streaming resumes within a poll cycle.
      if (inst.ws && inst.ws.isDead()) {
        try {
          inst.ws.connect();
        } catch {
          /* ignore — next tick retries */
        }
      }
    } catch {
      // Per-instance failure is fine — the WS layer surfaces real
      // outages; we just skip the version refresh this tick.
    }
  }
  syncFacade();
  for (const fn of healthPollListeners) {
    try { fn(); } catch (e) { log.warn('health-poll listener threw', e instanceof Error ? e.message : String(e)); }
  }
}

/**
 * AX2 — redial every socket that has given up, without waiting for the
 * 60s poll. Called by the wake/online handler: after a laptop sleep the
 * retry budget is already spent, so nothing reconnects on its own.
 * Returns how many sockets were revived.
 */
function reviveDeadSockets(): number {
  let revived = 0;
  for (const id of Object.keys(state.instances)) {
    const inst = state.instances[id];
    if (!inst?.ws.isDead()) continue;
    try {
      inst.ws.connect();
      revived += 1;
    } catch {
      /* next tick retries */
    }
  }
  if (revived > 0) log.info('wake — redialing dead sockets', { revived });
  return revived;
}

// A-HEALTH-01 (V109) — idempotent start so HMR / repeated imports don't
// stack duplicate intervals (the old bare module-level setInterval leaked
// a timer + fetch loop per reload). Exposed stop for app teardown.
let _healthTimer: ReturnType<typeof setInterval> | null = null;
function startHealthPoll(): void {
  if (_healthTimer !== null) return;
  _healthTimer = setInterval(() => {
    void refreshAllInstanceHealth();
  }, HEALTH_POLL_MS);
}
function stopHealthPoll(): void {
  if (_healthTimer !== null) {
    clearInterval(_healthTimer);
    _healthTimer = null;
  }
}
startHealthPoll();

export const daemonStore = {
  state,
  attachClient,
  disconnect,
  disconnectAll,
  disconnectInstance,
  markActiveDisconnected,
  setPhase,
  setAutoUpdate,
  recheckHealth,
  stopHealthPoll,
  refreshAllInstanceHealth,
  reviveDeadSockets,
  onHealthPoll,
  switchToPort,
  switchToPortDetailed,
  selectOffline,
  clearOfflineSelection,
  clearActiveSelection,
  onActiveChanged,
  setRunnerAuth,
  setTokenPromptHandler,
};

/**
 * V86d — Single source of truth for "which rail row is highlighted".
 * Replaces the per-row `RailRowData.active` flag (which was baked into
 * the array returned by `rows()` and therefore tied to `<For>`'s
 * remount cadence). Components read this accessor directly so the
 * green bar + edit/delete morph live entirely off the daemon store's
 * reactivity — no rebuild of the rows array required.
 *
 * Returns the offline pick's key when present (offline always wins
 * over a live instance because picking offline explicitly cleared
 * `activeId`); otherwise the live `activeId`; otherwise null.
 */
export const selectedRowKey = (): string | null => {
  const off = state.offlineSelection;
  if (off) return off.key;
  return state.activeId;
};

// Convenience selectors for components that just need one slice.
export const daemonClient = (): DaemonClient | null => state.client;
export const daemonHealth = (): HealthResponse | null => state.health;
export const daemonVersion = (): DaemonVersion | null => state.version;
export const isDaemonConnected = (): boolean => state.phase === 'connected';
export const isDaemonOutdated = (): boolean => state.outdated;

log.debug('state/daemon module loaded (MP1 multi-instance)');
