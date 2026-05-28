/**
 * state/chat.ts — reactive store for the chat layer.
 *
 * Holds: per-conversation message map, active conversation, agent
 * status (idle / thinking / working), archived conversations,
 * conversation metadata (agent type, model, title, location),
 * conversation title overrides, and the synthetic onboarding conv.
 *
 * Persistence:
 *   - `convMeta` (M2.4 V79r) — `mc-conv-meta-v1::<cluster_id>` JSON
 *     map. Restored when the active cluster changes; saved on every
 *     ensureConvMeta call. This is what survives reloads — the type
 *     of every service agent the operator created. The daemon
 *     pairs this with its own `conv_meta.json` sidecar (py-1.7.0)
 *     so chained turns keep their agent_type even if the cockpit
 *     forgets to re-send it.
 *
 * REMEMBER-line stripping:
 *   - The daemon strips REMEMBER lines server-side before broadcasting
 *     `chat.assistant.final`, but we belt-and-braces strip again on
 *     ingest so a stray line from a `delta` (before the final lands)
 *     never reaches the UI.
 */

import { createStore } from 'solid-js/store';
import { createSignal } from 'solid-js';
import type { DaemonClient, DaemonEvent, DispatchBody } from '~/lib/daemon-client';
import { log } from '~/lib/log';
import { onboardingWelcomeText, ONBOARDING_COORDINATOR_AUTHOR } from '~/lib/onboarding-brief';

export const ONBOARDING_CONV_ID = '_onboarding_v1';

export type AgentType = 'custom' | 'deploy' | 'db' | 'testing' | 'audit' | 'docs' | 'review';

export interface ConvMeta {
  agentId: string;
  model: string;
  type: AgentType;
  title: string;
  location: { type: 'local' | 'remote'; host?: string; provider?: string };
}

export type AgentStatusKind = 'idle' | 'thinking' | 'working';

export interface AgentStatus {
  state: AgentStatusKind;
  conv?: string;
  runId?: string;
  lastText?: string;
}

export interface ChatMsg {
  kind: 'user' | 'assistant';
  text: string;
  author?: string;
  ts?: string;
  streaming?: boolean;
  stream_id?: string;
  cancelled?: boolean;
  _placeholder_user?: boolean;
  _placeholder?: boolean;
}

/** MP5 — per-cluster activity indicators surfaced on the projects
 *  rail. Tracked GLOBALLY (across all clusters), not swapped on
 *  bindCluster, because we want to know "B is working" while we're
 *  on A. */
export interface ClusterActivity {
  /** Wall-clock ts of the last event received on this cluster's WS. */
  lastEventAt: number;
  /** Wall-clock ts when the cockpit last bound to this cluster. */
  lastReadAt: number;
  /** Convs currently streaming an assistant reply on this cluster. */
  workingConvs: string[];
}

export interface ChatStoreState {
  convMap: Record<string, ChatMsg[]>;
  activeConv: string | null;
  agentStatus: Record<string, AgentStatus>;
  archivedConvs: Record<string, true>;
  convMeta: Record<string, ConvMeta>;
  convTitleOverrides: Record<string, string>;
  /** MP5 — global per-cluster activity. NOT swapped on bindCluster. */
  clusterActivity: Record<string, ClusterActivity>;
  /** V86p — convs the operator just dispatched into, awaiting the
   *  first assistant chunk over WS. Carries the dispatch timestamp
   *  so the UI can show "preparing… Ns elapsed". Cleared when the
   *  first `chat.assistant.delta` (or `final` / `cancelled`) lands. */
  pendingReplyConvs: Record<string, number>;
}

const initial: ChatStoreState = {
  convMap: {},
  activeConv: null,
  agentStatus: {},
  archivedConvs: {},
  convMeta: {},
  convTitleOverrides: {},
  clusterActivity: {},
  pendingReplyConvs: {},
};

const [state, setState] = createStore<ChatStoreState>(initial);
const [activeClusterId, setActiveClusterId] = createSignal<string | null>(null);

// ── convMeta persistence (V79r) ─────────────────────────────────────

const CONV_META_KEY_PREFIX = 'mc-conv-meta-v1::';
function metaKey(): string {
  return CONV_META_KEY_PREFIX + (activeClusterId() ?? 'unknown');
}

function loadConvMeta(): void {
  try {
    const raw = localStorage.getItem(metaKey());
    if (!raw) {
      setState('convMeta', {});
      return;
    }
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const out: Record<string, ConvMeta> = {};
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (isConvMeta(v)) out[k] = v;
      }
      setState('convMeta', out);
    }
  } catch (e) {
    log.warn('convMeta load failed', e instanceof Error ? e.message : String(e));
  }
}

function isConvMeta(v: unknown): v is ConvMeta {
  if (!v || typeof v !== 'object') return false;
  const r = v as Record<string, unknown>;
  return typeof r.agentId === 'string' && typeof r.type === 'string';
}

function saveConvMeta(): void {
  try {
    localStorage.setItem(metaKey(), JSON.stringify(state.convMeta));
  } catch {
    /* quota / private mode */
  }
}

// ── MP3 — per-cluster chat state ────────────────────────────────────
//
// `bindCluster` was just loading convMeta from localStorage; chat
// messages, agent status and archived convs were single-tenant in
// memory, so switching projects wiped them.
//
// Now we hold a parallel snapshot per cluster in `clusterSnapshots`.
// When bindCluster fires we save the current visible state under the
// prior key and restore the next cluster's slice if we've seen it
// before. Convmeta still persists to localStorage (operator's
// previous sessions); the in-memory snapshot is the live channel.
//
// Notes:
//   - In-flight WS events from INACTIVE clusters are still dropped
//     today because event-bus.ts only attaches to the active
//     instance. MP4 puts a bus on each instance so background
//     activity lands in the right slice.
//   - clusterSnapshots stays in JS memory only — survives tab session,
//     not a reload. Reload restores convMeta from localStorage and
//     the daemon serves message history via /state on attach.

interface ClusterChatSlice {
  convMap: Record<string, ChatMsg[]>;
  activeConv: string | null;
  agentStatus: Record<string, AgentStatus>;
  archivedConvs: Record<string, true>;
  convMeta: Record<string, ConvMeta>;
  convTitleOverrides: Record<string, string>;
}

const clusterSnapshots = new Map<string, ClusterChatSlice>();

function snapshotCurrent(): ClusterChatSlice {
  return {
    convMap: { ...state.convMap },
    activeConv: state.activeConv,
    agentStatus: { ...state.agentStatus },
    archivedConvs: { ...state.archivedConvs },
    convMeta: { ...state.convMeta },
    convTitleOverrides: { ...state.convTitleOverrides },
  };
}

function restoreSlice(slice: ClusterChatSlice): void {
  setState({
    convMap: slice.convMap,
    activeConv: slice.activeConv,
    agentStatus: slice.agentStatus,
    archivedConvs: slice.archivedConvs,
    convMeta: slice.convMeta,
    convTitleOverrides: slice.convTitleOverrides,
  });
}

// ── Public actions ──────────────────────────────────────────────────

function bindCluster(clusterId: string | null): void {
  const prevId = activeClusterId();
  // Save current state to the prior cluster's slice (skipped on first
  // boot when prevId is null).
  if (prevId) clusterSnapshots.set(prevId, snapshotCurrent());
  setActiveClusterId(clusterId);
  // MP5 — stamp lastReadAt so the rail's unread dot clears when the
  // operator visits this cluster. We keep lastEventAt untouched so
  // the comparison "did anything happen since I last looked" stays
  // meaningful.
  if (clusterId) {
    setState('clusterActivity', clusterId, (prev) => ({
      lastEventAt: prev?.lastEventAt ?? 0,
      lastReadAt: Date.now(),
      workingConvs: prev?.workingConvs ?? [],
    }));
  }
  // Restore the new cluster's slice if we've seen it this session.
  const cached = clusterId ? clusterSnapshots.get(clusterId) : null;
  if (cached) {
    restoreSlice(cached);
    return;
  }
  // First time visiting this cluster this session — reset visible
  // state and load convMeta from localStorage.
  setState({
    convMap: {},
    activeConv: null,
    agentStatus: {},
    archivedConvs: {},
    convMeta: {},
    convTitleOverrides: {},
  });
  loadConvMeta();
}

/** MP5 — bump a cluster's activity counters from event-bus dispatch. */
function recordActivity(clusterKey: string, ev: DaemonEvent): void {
  setState('clusterActivity', clusterKey, (prev) => {
    const working = new Set(prev?.workingConvs ?? []);
    const conv = typeof ev.conv === 'string' ? ev.conv : null;
    if (conv) {
      if (ev.type === 'chat.assistant.delta') working.add(conv);
      else if (ev.type === 'chat.assistant.final' || ev.type === 'chat.cancelled') working.delete(conv);
    }
    return {
      lastEventAt: Date.now(),
      lastReadAt: prev?.lastReadAt ?? 0,
      workingConvs: [...working],
    };
  });
}

/** Wipe the in-memory slice for a cluster (used by Forget). */
function clearClusterChat(clusterId: string): void {
  clusterSnapshots.delete(clusterId);
  // MP5 — also clear activity tracking for this cluster.
  setState('clusterActivity', (prev) => {
    const next = { ...prev };
    delete next[clusterId];
    return next;
  });
  if (activeClusterId() === clusterId) {
    setState({
      convMap: {},
      activeConv: null,
      agentStatus: {},
      archivedConvs: {},
      convMeta: {},
      convTitleOverrides: {},
    });
  }
}

/**
 * MP4 — Apply a chat event to a NON-ACTIVE cluster's cached slice.
 * Same semantics as ingestEvent (placeholder dedup, streaming
 * upsert, cancel handling) but mutates the plain JS object rather
 * than the reactive store. When the operator switches back to this
 * cluster via bindCluster, the slice is restored and the events
 * become visible.
 *
 * Active-cluster events still flow through `ingestEvent` (above),
 * which uses setState so the UI updates in real time.
 */
function ingestEventForCluster(clusterKey: string, ev: DaemonEvent): void {
  // MP5 — always record activity (regardless of active/inactive)
  // so the rail's working slug and unread dot react to events on
  // background daemons too.
  recordActivity(clusterKey, ev);
  if (activeClusterId() === clusterKey) {
    ingestEvent(ev);
    return;
  }
  const conv = typeof ev.conv === 'string' ? ev.conv : null;
  if (!conv) return;
  let slice = clusterSnapshots.get(clusterKey);
  if (!slice) {
    slice = {
      convMap: {},
      activeConv: null,
      agentStatus: {},
      archivedConvs: {},
      convMeta: {},
      convTitleOverrides: {},
    };
    clusterSnapshots.set(clusterKey, slice);
  }
  const arr = slice.convMap[conv] ?? [];

  if (ev.type === 'chat.user') {
    const text = typeof ev.text === 'string' ? ev.text : '';
    const author = typeof ev.author === 'string' ? ev.author : undefined;
    const phIdx = arr.findIndex(
      (m) => m.kind === 'user' && m._placeholder_user && m.text === text && (!author || m.author === author),
    );
    if (phIdx >= 0) {
      const next = arr.slice();
      const prev = next[phIdx]!;
      next[phIdx] = { ...prev, author, ts: typeof ev.ts === 'string' ? ev.ts : undefined, _placeholder_user: undefined };
      slice.convMap[conv] = next;
      return;
    }
    slice.convMap[conv] = [...arr, { kind: 'user', text, author, ts: typeof ev.ts === 'string' ? ev.ts : undefined }];
    return;
  }
  if (ev.type === 'chat.assistant.delta') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    if (!streamId) return;
    const idx = arr.findIndex((m) => m.kind === 'assistant' && m.stream_id === streamId);
    const cleaned = stripRememberLines(text);
    if (idx >= 0) {
      const next = arr.slice();
      const prev = next[idx]!;
      next[idx] = { ...prev, text: cleaned, streaming: true };
      slice.convMap[conv] = next;
    } else {
      slice.convMap[conv] = [
        ...arr,
        {
          kind: 'assistant',
          text: cleaned,
          author: typeof ev.author === 'string' ? ev.author : undefined,
          ts: typeof ev.ts === 'string' ? ev.ts : undefined,
          streaming: true,
          stream_id: streamId,
        },
      ];
    }
    return;
  }
  if (ev.type === 'chat.assistant.final') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    const cleaned = stripRememberLines(text);
    const idx = arr.findIndex((m) => m.kind === 'assistant' && streamId !== undefined && m.stream_id === streamId);
    if (idx >= 0) {
      const next = arr.slice();
      const prev = next[idx]!;
      next[idx] = { ...prev, text: cleaned, streaming: false };
      slice.convMap[conv] = next;
    } else {
      slice.convMap[conv] = [
        ...arr,
        {
          kind: 'assistant',
          text: cleaned,
          author: typeof ev.author === 'string' ? ev.author : undefined,
          ts: typeof ev.ts === 'string' ? ev.ts : undefined,
          streaming: false,
          stream_id: streamId,
        },
      ];
    }
    return;
  }
  if (ev.type === 'chat.cancelled') {
    const last = arr[arr.length - 1];
    if (last && last.kind === 'assistant' && last.streaming) {
      const next = arr.slice();
      next[arr.length - 1] = { ...last, streaming: false, cancelled: true };
      slice.convMap[conv] = next;
    }
  }
}

function nextAgentId(): string {
  const used = new Set(Object.values(state.convMeta).map((m) => m.agentId));
  for (let i = 1; i < 1000; i += 1) {
    const id = 'A' + String(i).padStart(3, '0');
    if (!used.has(id)) return id;
  }
  return 'A???';
}

function ensureConvMeta(convId: string, init: Partial<ConvMeta> = {}): ConvMeta {
  const existing = state.convMeta[convId];
  if (existing) return existing;
  const meta: ConvMeta = {
    agentId: init.agentId ?? nextAgentId(),
    model: init.model ?? 'auto',
    type: (init.type ?? 'custom') as AgentType,
    title: init.title ?? '',
    location: init.location ?? { type: 'local', host: 'this machine' },
  };
  setState('convMeta', convId, meta);
  saveConvMeta();
  return meta;
}

function setActiveConv(conv: string | null): void {
  setState('activeConv', conv);
}

/**
 * Seed the synthetic Coordinator conversation (V46 / V78b). Idempotent —
 * only creates the conv if it doesn't exist yet. Caller is responsible
 * for the `isProjectEmpty` gate; this function just builds the shape.
 *
 * After seeding: a single assistant bubble (author='coordinator'),
 * convMeta titled 'Coordinator' as a custom-type agent, and if no
 * conversation is currently active, this one becomes active so the
 * user lands on the welcome bubble.
 */
function seedOnboardingConv(): void {
  if (state.convMap[ONBOARDING_CONV_ID]) return;
  const ts = new Date().toISOString();
  setState('convMap', ONBOARDING_CONV_ID, [
    {
      kind: 'assistant',
      text: onboardingWelcomeText(),
      author: ONBOARDING_COORDINATOR_AUTHOR,
      ts,
      streaming: false,
    },
  ]);
  ensureConvMeta(ONBOARDING_CONV_ID, {
    title: 'Coordinator',
    type: 'custom',
    location: { type: 'local', host: 'this machine' },
  });
  if (!state.activeConv) setState('activeConv', ONBOARDING_CONV_ID);
}

/**
 * True when the synthetic Coordinator conv already received at least one
 * real user message. Used by (a) ChatComposer to gate the bootstrap-brief
 * attachment to the FIRST dispatch only and (b) ChatRail's retire memo
 * so the card stays visible after the user starts chatting even once
 * initiatives appear.
 */
function onboardingHasUserMessages(): boolean {
  const list = state.convMap[ONBOARDING_CONV_ID];
  if (!list || list.length === 0) return false;
  return list.some((m) => m.kind === 'user');
}

/**
 * Create an empty conversation with metadata and select it. Used by the
 * NewAgentWizard (M6.5). Slug mirrors V79's `newConvSlugFromScope`:
 * scope-encoded for custom agents, type+timestamp for services. Returns
 * the slug so the caller can focus the composer.
 */
function createConv(opts: {
  type: AgentType;
  title: string;
  model: string;
  scope?: { module?: string | null; taskId?: string | null };
}): string {
  const stamp = new Date().toISOString().slice(5, 16).replace(/[:T-]/g, '').toLowerCase();
  let slug: string;
  if (opts.type === 'custom') {
    const tid = opts.scope?.taskId?.trim();
    const mod = opts.scope?.module?.trim();
    if (tid) slug = `${(mod || 'general')}-${tid.toLowerCase()}-${stamp}`;
    else if (mod) slug = `${mod}-${stamp}`;
    else slug = `general-${stamp}`;
  } else {
    slug = `${opts.type}-${Date.now().toString(36).slice(-5)}`;
  }
  if (!state.convMap[slug]) setState('convMap', slug, []);
  ensureConvMeta(slug, { type: opts.type, title: opts.title, model: opts.model });
  setState('activeConv', slug);
  return slug;
}

function setConvTitle(conv: string, title: string): void {
  ensureConvMeta(conv);
  setState('convMeta', conv, 'title', title);
  saveConvMeta();
}

function archiveConv(conv: string): void {
  // V82 — Coordinator is never archivable; it's the always-on agent
  // for roadmap / cluster comms. Silently ignore archive attempts on
  // the synthetic conv so a stray click in the UI doesn't strand the
  // operator without a default chat.
  if (conv === ONBOARDING_CONV_ID) return;
  setState('archivedConvs', conv, true);
}

function unarchiveConv(conv: string): void {
  setState('archivedConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
}

function setAgentStatus(agentId: string, status: AgentStatus): void {
  setState('agentStatus', agentId, status);
}

function clearAgentStatus(agentId: string): void {
  setState('agentStatus', (xs) => {
    const { [agentId]: _drop, ...rest } = xs;
    return rest;
  });
}

function stripRememberLines(text: string): string {
  if (!text) return text;
  return text
    .split('\n')
    .filter((ln) => !/^\s*(?:[-*]\s+)?REMEMBER:\s/i.test(ln))
    .join('\n')
    .trimEnd();
}

/**
 * Ingest one daemon event into the chat store. Idempotent — same
 * stream_id replaces in place rather than appending duplicates.
 */
function ingestEvent(ev: DaemonEvent): void {
  const conv = typeof ev.conv === 'string' ? ev.conv : null;
  if (!conv) return;
  const arr = state.convMap[conv] ?? [];
  if (ev.type === 'chat.user') {
    const text = typeof ev.text === 'string' ? ev.text : '';
    const author = typeof ev.author === 'string' ? ev.author : undefined;
    // Replace any optimistic placeholder with the canonical echo so the
    // bubble isn't duplicated (timestamps differ between client + daemon).
    const phIdx = arr.findIndex(
      (m) => m.kind === 'user' && m._placeholder_user && m.text === text && (!author || m.author === author),
    );
    if (phIdx >= 0) {
      setState('convMap', conv, phIdx, {
        author,
        ts: typeof ev.ts === 'string' ? ev.ts : undefined,
        _placeholder_user: undefined,
      });
      return;
    }
    setState('convMap', conv, [
      ...arr,
      { kind: 'user', text, author, ts: typeof ev.ts === 'string' ? ev.ts : undefined },
    ]);
    return;
  }
  if (ev.type === 'chat.assistant.delta') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    if (!streamId) return;
    // Find existing live bubble for this stream.
    const idx = arr.findIndex((m) => m.kind === 'assistant' && m.stream_id === streamId);
    const cleaned = stripRememberLines(text);
    if (idx >= 0) {
      setState('convMap', conv, idx, { text: cleaned, streaming: true });
    } else {
      setState('convMap', conv, [
        ...arr,
        {
          kind: 'assistant',
          text: cleaned,
          author: typeof ev.author === 'string' ? ev.author : undefined,
          ts: typeof ev.ts === 'string' ? ev.ts : undefined,
          streaming: true,
          stream_id: streamId,
        },
      ]);
    }
    // V86p — first assistant chunk is here; drop the "preparing" flag.
    clearPendingReply(conv);
    return;
  }
  if (ev.type === 'chat.assistant.final') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    const cleaned = stripRememberLines(text);
    const idx = arr.findIndex(
      (m) => m.kind === 'assistant' && streamId !== undefined && m.stream_id === streamId,
    );
    if (idx >= 0) {
      setState('convMap', conv, idx, {
        text: cleaned,
        streaming: false,
      });
    } else {
      setState('convMap', conv, [
        ...arr,
        {
          kind: 'assistant',
          text: cleaned,
          author: typeof ev.author === 'string' ? ev.author : undefined,
          ts: typeof ev.ts === 'string' ? ev.ts : undefined,
          streaming: false,
          stream_id: streamId,
        },
      ]);
    }
    // V86p — final without prior delta also drops the pending flag.
    clearPendingReply(conv);
    return;
  }
  if (ev.type === 'chat.cancelled') {
    const last = arr[arr.length - 1];
    if (last && last.kind === 'assistant' && last.streaming) {
      setState('convMap', conv, arr.length - 1, { streaming: false, cancelled: true });
    }
    clearPendingReply(conv);
  }
}

export interface DispatchOpts {
  conv: string;
  text: string;
  author?: string;
  images?: Array<{ dataURL: string; mediaType: string }>;
  contextDocs?: Array<{ filename: string; content: string }>;
  scope?: { module?: string; taskId?: string; initiative?: string };
}

export type DispatchOutcome =
  | { ok: true; conv: string }
  | { ok: false; status: number; error?: string };

/**
 * Optimistically push a user bubble, POST /chat/dispatch, and reconcile.
 * The ChatComposer (M5.3) calls this. WS echoes replace the placeholder
 * in `ingestEvent`. On failure the placeholder is dropped so the user
 * can edit + resend.
 */
async function dispatchMessage(client: DaemonClient, opts: DispatchOpts): Promise<DispatchOutcome> {
  const { conv, text, author, images = [], contextDocs = [], scope = {} } = opts;
  const localTs = new Date().toISOString();
  const arr = state.convMap[conv] ?? [];
  setState('convMap', conv, [
    ...arr,
    { kind: 'user', text, author, ts: localTs, _placeholder_user: true },
  ]);
  const meta = state.convMeta[conv];
  const body: DispatchBody = { conv, text };
  if (author) body.author = author;
  if (meta?.type) body.agent_type = meta.type;
  if (meta?.agentId) body.agent_id = meta.agentId;
  if (scope.module) body.module_id = scope.module;
  if (scope.taskId) body.task_id = scope.taskId;
  if (scope.initiative) body.initiative_id = scope.initiative;
  if (images.length) {
    body.images = images.map((i) => ({
      type: 'image',
      media_type: i.mediaType,
      data: i.dataURL.includes(',') ? i.dataURL.split(',')[1] ?? '' : i.dataURL,
    }));
  }
  if (contextDocs.length) body.context_docs = contextDocs;
  const res = await client.chatDispatch(body);
  if (!res.ok) {
    const list = state.convMap[conv] ?? [];
    const idx = list.findIndex((m) => m._placeholder_user && m.ts === localTs);
    if (idx >= 0) {
      setState('convMap', conv, list.filter((_, i) => i !== idx));
    }
    log.warn('chat dispatch failed', res.status, res.body);
    return { ok: false, status: res.status, error: res.body };
  }
  if (!state.activeConv) setState('activeConv', res.data.conv ?? conv);
  // V86p — flag the conv as "awaiting first assistant chunk". UI uses
  // this to show a "preparing response…" stripe so the operator gets
  // movement immediately instead of staring at the user bubble. The
  // dispatch timestamp drives the elapsed counter.
  setState('pendingReplyConvs', res.data.conv ?? conv, Date.now());
  return { ok: true, conv: res.data.conv ?? conv };
}

function clearPendingReply(conv: string): void {
  if (state.pendingReplyConvs[conv] === undefined) return;
  setState('pendingReplyConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
}

export const chatStore = {
  state,
  bindCluster,
  clearClusterChat,
  ensureConvMeta,
  createConv,
  setActiveConv,
  seedOnboardingConv,
  onboardingHasUserMessages,
  setConvTitle,
  archiveConv,
  unarchiveConv,
  setAgentStatus,
  clearAgentStatus,
  ingestEvent,
  ingestEventForCluster,
  dispatchMessage,
};

log.debug('state/chat loaded');
