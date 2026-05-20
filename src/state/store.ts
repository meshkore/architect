/**
 * store.ts — reactive state for the cockpit.
 *
 * One global store, populated by:
 *   • initial GET /state when a daemon connection is established
 *   • subsequent state.rebuilt WS events trigger a refetch
 *   • finer-grained events (task.created, chat.*, agent.online) patch the
 *     store locally without round-tripping when possible
 *
 * Solid signals are used everywhere. Components read via `state.tasks()`
 * and re-render on change.
 */

import { createSignal } from 'solid-js';
import { createStore } from 'solid-js/store';
import type { DaemonClient, DaemonEvent } from '~/lib/daemon-client';
import { log } from '~/lib/log';

export interface ClusterInfo {
  id?: string;
  name?: string;
  type?: string;
}

export interface Task {
  id: string;
  title: string;
  status: string;
  category?: string;
  module?: string;
  priority?: string;
  initiative?: string;
  tags?: string[];
  [k: string]: unknown;
}

export interface Module {
  id: string;
  name?: string;
  kind?: string;
  path?: string;
  status?: string;
  [k: string]: unknown;
}

export interface Initiative {
  id: string;
  title: string;
  status?: string;
  oneliner?: string;
  [k: string]: unknown;
}

export interface DaemonSnapshot {
  generated_at?: string;
  cluster?: ClusterInfo;
  modules?: Module[];
  roadmap?: { tasks?: Task[]; stats?: Record<string, number> };
  initiatives?: Initiative[];
  timeline?: { recent?: DaemonEvent[] };
  members?: unknown[];
  docs?: unknown;
}

// ─── Snapshot ──────────────────────────────────────────────────────────────

const [snapshot, setSnapshot] = createStore<DaemonSnapshot>({});

// ─── Event log (last N) ────────────────────────────────────────────────────

const MAX_EVENTS = 500;
const [events, setEvents] = createSignal<DaemonEvent[]>([]);

// ─── WebSocket connection state ────────────────────────────────────────────

export type WsState = 'connecting' | 'open' | 'closed' | 'error';
const [wsState, setWsState] = createSignal<WsState>('connecting');

export interface StoreApi {
  // Reads
  snapshot: typeof snapshot;
  events: typeof events;
  wsState: typeof wsState;
  tasks: () => Task[];
  modules: () => Module[];
  initiatives: () => Initiative[];
  cluster: () => ClusterInfo;
  // Writes
  refresh: () => Promise<void>;
  appendEvent: (ev: DaemonEvent) => void;
  setWsState: typeof setWsState;
  // Lifecycle
  attach: (client: DaemonClient) => Promise<void>;
}

let attachedClient: DaemonClient | null = null;

async function refresh(): Promise<void> {
  if (!attachedClient) {
    log.warn('refresh called before attach');
    return;
  }
  try {
    const s = await attachedClient.state() as DaemonSnapshot;
    setSnapshot(s);
    log.info('snapshot updated', {
      tasks: s.roadmap?.tasks?.length ?? 0,
      modules: s.modules?.length ?? 0,
      initiatives: s.initiatives?.length ?? 0,
    });
  } catch (err) {
    log.error('failed to fetch /state', err);
  }
}

function appendEvent(ev: DaemonEvent): void {
  setEvents((prev) => {
    const next = [...prev, ev];
    return next.length > MAX_EVENTS ? next.slice(next.length - MAX_EVENTS) : next;
  });
  // Drive snapshot refresh on full rebuild signals. Finer events (task.*,
  // chat.*) update the snapshot via dedicated reducers below.
  if (ev.type === 'state.rebuilt') {
    void refresh();
  }
}

async function attach(client: DaemonClient): Promise<void> {
  attachedClient = client;
  setWsState('connecting');
  await refresh();
  log.info('store attached to', client.transport.label);
}

export const store: StoreApi = {
  snapshot,
  events,
  wsState,
  tasks: () => snapshot.roadmap?.tasks ?? [],
  modules: () => snapshot.modules ?? [],
  initiatives: () => snapshot.initiatives ?? [],
  cluster: () => snapshot.cluster ?? {},
  refresh,
  appendEvent,
  setWsState,
  attach,
};
