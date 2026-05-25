/**
 * state/story.ts — reactive store for the active story run.
 *
 * One story run is active at a time, owned by the cockpit. When the
 * operator hits RUN on an initiative card, the runner builds the
 * task list, kicks off task 1 via `/chat/dispatch`, and watches the
 * daemon's WS feed to advance.
 *
 * The visible counter MUST be tasks, never claude-code tool-use
 * steps — that was the V80 UX bug M4.5 exists to fix.
 *
 * Persistence: serialised to `mk-story-run-v1` so a reload during a
 * run resumes the banner. Restored runs come back as `paused` (the
 * tab can't reliably resume an in-flight turn).
 */

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import { log } from '~/lib/log';

const STORE_KEY = 'mk-story-run-v1';

export type StoryStatus = 'running' | 'paused' | 'stopping' | 'cancelled' | 'done' | 'failed';

export interface StoryRun {
  id: string;
  initiativeId: string;
  initiativeTitle: string;
  conv: string;
  taskIds: string[];
  cursor: number;
  startedAt: string;
  taskStartedAt: string;
  status: StoryStatus;
  lastStream: string | null;
  failures: Array<{ taskId: string; reason: string }>;
}

interface StoryStoreState {
  run: StoryRun | null;
  /** Updated every second while a run is active so the elapsed timer ticks. */
  nowMs: number;
}

const [state, setState] = createStore<StoryStoreState>({ run: null, nowMs: Date.now() });
const [tickerStarted, setTickerStarted] = createSignal(false);

function persist(): void {
  try {
    if (state.run) localStorage.setItem(STORE_KEY, JSON.stringify(state.run));
    else localStorage.removeItem(STORE_KEY);
  } catch {
    /* quota / private mode */
  }
}

function loadFromStorage(): void {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return;
    const r = parsed as Partial<StoryRun>;
    if (!r.id || !r.initiativeId || !Array.isArray(r.taskIds) || typeof r.conv !== 'string') return;
    const restored: StoryRun = {
      id: r.id,
      initiativeId: r.initiativeId,
      initiativeTitle: r.initiativeTitle ?? r.initiativeId,
      conv: r.conv,
      taskIds: r.taskIds,
      cursor: typeof r.cursor === 'number' ? r.cursor : 0,
      startedAt: r.startedAt ?? new Date().toISOString(),
      taskStartedAt: r.taskStartedAt ?? new Date().toISOString(),
      // Resumed runs are always paused — we can't pick up an in-flight turn.
      status: r.status === 'done' ? 'done' : 'paused',
      lastStream: null,
      failures: Array.isArray(r.failures) ? r.failures : [],
    };
    setState('run', restored);
  } catch (e) {
    log.warn('story load failed', e instanceof Error ? e.message : String(e));
  }
}

function ensureTicker(): void {
  if (tickerStarted()) return;
  setTickerStarted(true);
  setInterval(() => setState('nowMs', Date.now()), 1000);
}

// ── Actions ────────────────────────────────────────────────────────

function start(input: {
  id: string;
  initiativeId: string;
  initiativeTitle: string;
  conv: string;
  taskIds: string[];
}): void {
  const now = new Date().toISOString();
  const run: StoryRun = {
    id: input.id,
    initiativeId: input.initiativeId,
    initiativeTitle: input.initiativeTitle,
    conv: input.conv,
    taskIds: input.taskIds,
    cursor: 0,
    startedAt: now,
    taskStartedAt: now,
    status: 'running',
    lastStream: null,
    failures: [],
  };
  setState('run', run);
  persist();
  ensureTicker();
}

function advance(): void {
  const r = state.run;
  if (!r) return;
  if (r.cursor + 1 >= r.taskIds.length) {
    setState('run', { ...r, cursor: r.taskIds.length, status: 'done', lastStream: null });
  } else {
    setState('run', {
      ...r,
      cursor: r.cursor + 1,
      taskStartedAt: new Date().toISOString(),
      lastStream: null,
    });
  }
  persist();
}

function setStream(streamId: string | null): void {
  if (!state.run) return;
  setState('run', { ...state.run, lastStream: streamId });
  persist();
}

function setStatus(status: StoryStatus): void {
  if (!state.run) return;
  setState('run', { ...state.run, status });
  persist();
}

function recordFailure(taskId: string, reason: string): void {
  if (!state.run) return;
  setState('run', {
    ...state.run,
    failures: [...state.run.failures, { taskId, reason }],
    status: 'paused',
  });
  persist();
}

function clear(): void {
  setState('run', null);
  persist();
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

export const storyStore = {
  state,
  start,
  advance,
  setStream,
  setStatus,
  recordFailure,
  clear,
  currentTaskId,
  elapsedTaskMs,
};

loadFromStorage();
ensureTicker();
log.debug('state/story loaded');
