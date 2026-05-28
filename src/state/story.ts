/**
 * state/story.ts — V89, daemon-backed story runs.
 *
 * The cockpit no longer owns story-run state. The daemon's RunStore
 * (py-1.10.0) is the single source of truth, persisted to
 * `.meshkore/.runtime/runs.json`. This module is a reactive mirror:
 *
 *  - On `bindCluster` → `hydrate(client)` calls `GET /runs?active=1`
 *    to repopulate the store from disk. Survives cockpit reload and
 *    daemon restart without any localStorage involvement.
 *  - WS events `run.started` / `run.advanced` / `run.cancelled` /
 *    `run.done` / `run.failed` keep the in-memory mirror live.
 *  - Mutations go to the daemon via the client and round-trip back
 *    through the WS — never write to the local store directly.
 *
 * Why this rewrite: V87 fixed "play stacks on busy" but kept state in
 * `mk-story-run-v1` localStorage. After reload the cockpit resurrected
 * the run as 'paused' and the UI lied: the daemon didn't know there
 * was a run, the chat panel didn't show the agent, the button stayed
 * stuck on ■. With the daemon owning the run, the cockpit just paints
 * ground truth.
 *
 * Backwards compatibility: the `storyStore` export keeps a singleton
 * "current run" selector (`state.run`) so existing components
 * (StoryProgressPill, StoryBanner, AgentsPanel) don't need a sweeping
 * refactor. Multi-run native UI lands in the agent-run-coordinator
 * initiative's later phases.
 */

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { log } from '~/lib/log';
import type { RunRecord, RunStatus, DaemonClient } from '~/lib/daemon-client';

// Legacy alias — kept so the existing UI code keeps compiling.
export type StoryStatus = RunStatus | 'paused';

/** Legacy shape — same field names the V87 store exposed, derived
 *  from a RunRecord. `paused` is a derived UI status: status === 'running'
 *  && !live. */
export interface StoryRun {
  id: string;
  initiativeId: string;
  initiativeTitle: string;
  conv: string;
  agentId: string;
  taskIds: string[];
  cursor: number;
  startedAt: string;
  taskStartedAt: string;
  status: StoryStatus;
  lastStream: string | null;
  live: boolean;
  failures: Array<{ taskId: string; reason: string }>;
}

interface StoryStoreState {
  /** All non-final runs known on this cluster, newest first. */
  runs: StoryRun[];
  /** Legacy singleton — the newest active run, or null. Many components
   *  still consume this shape; kept compatible so the refactor stays
   *  surgical. */
  run: StoryRun | null;
  /** Wall-clock tick (1 Hz). Drives elapsed-time labels. */
  nowMs: number;
  /** True once the first hydration round-trip has completed for the
   *  current cluster. Components can use this to suppress spurious
   *  "no runs" empty states during boot. */
  hydrated: boolean;
}

const [state, setState] = createStore<StoryStoreState>({
  runs: [],
  run: null,
  nowMs: Date.now(),
  hydrated: false,
});
const [tickerStarted, setTickerStarted] = createSignal(false);

function fromRecord(r: RunRecord): StoryRun {
  const isLive = !!r.live;
  let uiStatus: StoryStatus = r.status;
  if (r.status === 'running' && !isLive) uiStatus = 'paused';
  return {
    id: r.id,
    initiativeId: r.initiative_id,
    initiativeTitle: r.initiative_title,
    conv: r.conv,
    agentId: r.agent_id,
    taskIds: r.task_ids,
    cursor: r.cursor,
    startedAt: r.started_at,
    taskStartedAt: r.last_step_at,
    status: uiStatus,
    lastStream: r.stream_id,
    live: isLive,
    failures: r.error ? [{ taskId: r.task_ids[r.cursor] ?? '?', reason: r.error }] : [],
  };
}

function isActive(s: StoryStatus): boolean {
  return s !== 'done' && s !== 'cancelled' && s !== 'failed';
}

function recomputeSingleton(): void {
  const active = state.runs.filter((r) => isActive(r.status));
  if (active.length === 0) {
    setState('run', null);
    return;
  }
  // Newest startedAt first.
  active.sort((a, b) => (b.startedAt ?? '').localeCompare(a.startedAt ?? ''));
  setState('run', active[0]!);
}

function upsertFromRecord(r: RunRecord): void {
  const sr = fromRecord(r);
  const idx = state.runs.findIndex((x) => x.id === sr.id);
  if (idx === -1) {
    setState('runs', [sr, ...state.runs]);
  } else {
    const next = state.runs.slice();
    next[idx] = sr;
    setState('runs', next);
  }
  recomputeSingleton();
}

function ensureTicker(): void {
  if (tickerStarted()) return;
  setTickerStarted(true);
  setInterval(() => setState('nowMs', Date.now()), 1000);
}

// ── Hydration ──────────────────────────────────────────────────────

async function hydrate(client: DaemonClient): Promise<void> {
  const res = await client.runsList(true);
  if (!res.ok) {
    log.warn('story hydrate failed', res.status, res.error);
    setState('hydrated', true);
    return;
  }
  const records = res.data.runs ?? [];
  setState('runs', records.map(fromRecord));
  setState('hydrated', true);
  recomputeSingleton();
  ensureTicker();
}

function resetForClusterSwap(): void {
  setState('runs', []);
  setState('run', null);
  setState('hydrated', false);
}

// ── Event ingestion (called by the daemon WS bus) ─────────────────

/** Returns true if the event was consumed (run.*). Caller filters. */
function ingestRunEvent(ev: { type?: string; run?: RunRecord }): boolean {
  if (!ev || typeof ev.type !== 'string') return false;
  if (!ev.type.startsWith('run.')) return false;
  const r = ev.run;
  if (!r) return true;
  upsertFromRecord(r);
  return true;
}

// ── Mutation helpers (round-trip through daemon) ──────────────────

async function start(
  client: DaemonClient,
  body: {
    initiativeId: string;
    initiativeTitle: string;
    conv: string;
    agentId: string;
    agentTitle: string;
    taskIds: string[];
  },
): Promise<{ ok: true; run: StoryRun } | { ok: false; status: number; error?: string }> {
  const res = await client.runStart({
    initiative_id: body.initiativeId,
    initiative_title: body.initiativeTitle,
    conv: body.conv,
    agent_id: body.agentId,
    agent_title: body.agentTitle,
    task_ids: body.taskIds,
  });
  if (!res.ok) return { ok: false, status: res.status, error: res.error };
  upsertFromRecord(res.data.run);
  // The daemon will also broadcast run.started — that's idempotent
  // (upsert by id) so no double-write.
  const sr = state.runs.find((x) => x.id === res.data.run.id);
  if (!sr) return { ok: false, status: 0, error: 'race: missing after upsert' };
  return { ok: true, run: sr };
}

async function cancel(client: DaemonClient, runId: string): Promise<boolean> {
  const res = await client.runCancel(runId);
  if (!res.ok) {
    log.warn('story cancel failed', res.status, res.error);
    return false;
  }
  upsertFromRecord(res.data.run);
  return true;
}

async function advance(
  client: DaemonClient,
  runId: string,
  cursor: number,
  streamId?: string,
): Promise<boolean> {
  const res = await client.runAdvance(runId, cursor, streamId);
  if (!res.ok) {
    log.warn('story advance failed', res.status, res.error);
    return false;
  }
  upsertFromRecord(res.data.run);
  return true;
}

async function finish(client: DaemonClient, runId: string, status: 'done' | 'failed', error?: string): Promise<boolean> {
  const res = await client.runFinish(runId, status, error);
  if (!res.ok) {
    log.warn('story finish failed', res.status, res.error);
    return false;
  }
  upsertFromRecord(res.data.run);
  return true;
}

async function setStream(client: DaemonClient, runId: string, streamId: string): Promise<void> {
  const res = await client.runSetStream(runId, streamId);
  if (res.ok) upsertFromRecord(res.data.run);
}

// ── Selectors ──────────────────────────────────────────────────────

function currentTaskId(): string | null {
  const r = state.run;
  if (!r) return null;
  return r.taskIds[r.cursor] ?? null;
}

function elapsedTaskMs(): number {
  const r = state.run;
  if (!r) return 0;
  const started = Date.parse(r.taskStartedAt);
  if (Number.isNaN(started)) return 0;
  return Math.max(0, state.nowMs - started);
}

function runForInitiative(initiativeId: string): StoryRun | null {
  for (const r of state.runs) {
    if (r.initiativeId === initiativeId && isActive(r.status)) return r;
  }
  return null;
}

export const storyStore = {
  state,
  hydrate,
  resetForClusterSwap,
  ingestRunEvent,
  start,
  cancel,
  advance,
  finish,
  setStream,
  currentTaskId,
  elapsedTaskMs,
  runForInitiative,
};

ensureTicker();
log.debug('state/story loaded (V89, daemon-backed)');
