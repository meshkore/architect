/**
 * state/roadmap-run.ts — V90, sequential "Run all" orchestrator.
 *
 * The operator's ask: "yo solo doy un botón y se ejecuta todo el
 * roadmap, una iniciativa detrás de otra, hasta que todo esté hecho".
 * This store holds the QUEUE (the operator's intent) while the
 * actual per-initiative execution stays daemon-owned via storyStore /
 * RunStore.
 *
 * The queue is purely intent — `[initiativeId, initiativeId, …]`.
 * Persisted per-cluster in localStorage so a tab reload doesn't lose
 * the operator's "run everything" pass. The active execution state
 * (which initiative is live, its run id, whether the daemon's
 * runner is busy) is derived from storyStore — daemon-side truth,
 * V89.4 hydration covers reload.
 *
 * RoadmapRunner (component) is the orchestrator: it watches
 * storyStore.state.runs for a run.done on the queue's current
 * initiative and dispatches the next.
 *
 * Why cockpit-side and not daemon: the daemon already coordinates
 * RUNS (its own primitive). The roadmap-level queue is "operator
 * planned this whole sequence" — a layer above. Promoting it to a
 * daemon entity is captured in the agent-run-coordinator initiative
 * for later phases; today the cockpit holds the plan, the daemon
 * does the work.
 */

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { log } from '~/lib/log';

export type RoadmapRunStatus = 'idle' | 'running' | 'stopping' | 'cancelled' | 'done';

export interface RoadmapRun {
  queue: string[];         // initiative ids, in planned order
  cursor: number;          // index of the in-flight initiative (or = queue.length when finished)
  status: RoadmapRunStatus;
  startedAt: string;
  /** Daemon run id assigned to the CURRENT initiative (cursor). Set
   *  by the runner when it kicks each step; cleared on run.done /
   *  run.cancelled so the next-step trigger has a clean slot. */
  currentDaemonRunId: string | null;
  /** Initiatives that the runner started but failed (daemon returned
   *  an error from /runs or chat dispatch). The roadmap pass keeps
   *  going to the next one and surfaces failures on completion. */
  failures: Array<{ initiativeId: string; reason: string }>;
}

interface State {
  run: RoadmapRun | null;
  hydrated: boolean;
}

const STORE_KEY_PREFIX = 'mc-roadmap-run-v1::';

const [state, setState] = createStore<State>({ run: null, hydrated: false });
const [clusterId, setClusterId] = createSignal<string | null>(null);

function storeKey(): string | null {
  const c = clusterId();
  return c ? STORE_KEY_PREFIX + c : null;
}

function persist(): void {
  const k = storeKey();
  if (!k) return;
  try {
    if (state.run) localStorage.setItem(k, JSON.stringify(state.run));
    else localStorage.removeItem(k);
  } catch {
    /* quota */
  }
}

function load(): void {
  const k = storeKey();
  if (!k) {
    setState('run', null);
    return;
  }
  try {
    const raw = localStorage.getItem(k);
    if (!raw) {
      setState('run', null);
      return;
    }
    const parsed = JSON.parse(raw) as Partial<RoadmapRun>;
    if (!parsed || !Array.isArray(parsed.queue)) {
      setState('run', null);
      return;
    }
    const restored: RoadmapRun = {
      queue: parsed.queue.map(String),
      cursor: typeof parsed.cursor === 'number' ? parsed.cursor : 0,
      // Resumed runs come back in the same status; the RoadmapRunner
      // will check the daemon to decide whether to resume or wait.
      status: (parsed.status as RoadmapRunStatus) ?? 'idle',
      startedAt: typeof parsed.startedAt === 'string' ? parsed.startedAt : new Date().toISOString(),
      currentDaemonRunId: typeof parsed.currentDaemonRunId === 'string' ? parsed.currentDaemonRunId : null,
      failures: Array.isArray(parsed.failures) ? (parsed.failures as RoadmapRun['failures']) : [],
    };
    setState('run', restored);
  } catch (e) {
    log.warn('roadmap-run load failed', e instanceof Error ? e.message : String(e));
    setState('run', null);
  }
}

function bindCluster(cluster: string | null): void {
  setClusterId(cluster);
  load();
  setState('hydrated', true);
}

function start(initiativeIds: string[]): void {
  if (!initiativeIds.length) {
    log.warn('roadmap-run: empty queue');
    return;
  }
  const run: RoadmapRun = {
    queue: [...initiativeIds],
    cursor: 0,
    status: 'running',
    startedAt: new Date().toISOString(),
    currentDaemonRunId: null,
    failures: [],
  };
  setState('run', run);
  persist();
}

function setCurrentDaemonRunId(runId: string | null): void {
  if (!state.run) return;
  setState('run', { ...state.run, currentDaemonRunId: runId });
  persist();
}

function advance(): void {
  if (!state.run) return;
  const next = state.run.cursor + 1;
  if (next >= state.run.queue.length) {
    setState('run', { ...state.run, cursor: next, status: 'done', currentDaemonRunId: null });
  } else {
    setState('run', { ...state.run, cursor: next, currentDaemonRunId: null });
  }
  persist();
}

function recordFailure(initiativeId: string, reason: string): void {
  if (!state.run) return;
  setState('run', {
    ...state.run,
    failures: [...state.run.failures, { initiativeId, reason }],
  });
  persist();
}

function setStatus(status: RoadmapRunStatus): void {
  if (!state.run) return;
  setState('run', { ...state.run, status });
  persist();
}

function clear(): void {
  setState('run', null);
  persist();
}

function currentInitiativeId(): string | null {
  const r = state.run;
  if (!r) return null;
  return r.queue[r.cursor] ?? null;
}

function isActive(): boolean {
  const r = state.run;
  return !!r && (r.status === 'running' || r.status === 'stopping');
}

export const roadmapRunStore = {
  state,
  bindCluster,
  start,
  setCurrentDaemonRunId,
  advance,
  recordFailure,
  setStatus,
  clear,
  currentInitiativeId,
  isActive,
};

log.debug('state/roadmap-run loaded');
