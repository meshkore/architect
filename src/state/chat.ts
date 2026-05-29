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

export const ONBOARDING_CONV_ID = '_onboarding_v1';

export type AgentType = 'custom' | 'deploy' | 'db' | 'testing' | 'audit' | 'docs' | 'review' | 'roadmap-architect';

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
  /** V89.2 — Ephemeral flag set when the cockpit witnesses
   *  `chat.assistant.final` LIVE (not during a timeline rehydrate).
   *  Causes the bubble to auto-expand on arrival so the operator
   *  sees the full summary without having to click. Once they toggle
   *  the bubble manually OR the page is reloaded, the flag isn't
   *  carried (CollapsibleText keeps its own local expand state and
   *  rehydration goes through the gated codepath). */
  _freshFinal?: boolean;
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
  /** V89.2 — wall-clock ts of the most recent `chat.assistant.delta`
   *  seen for each conv. The streaming AssistantBubble reads this to
   *  decide whether the agent has been quiet "too long" (>~1.5 s) and
   *  should swap the streaming-tail view for a rotating "Working…
   *  Planning… Researching…" placeholder. Cleared on final/cancelled. */
  lastDeltaTsByConv: Record<string, number>;
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
  lastDeltaTsByConv: {},
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
  // V89.1 — Always reset pendingReplyConvs on cluster swap, BEFORE
  // either the cached or the fresh path runs. Reason: pendingReplyConvs
  // is global state (not part of ClusterChatSlice), and the onboarding
  // conv id is a fixed string shared across clusters. Without this
  // reset, the operator dispatching on cluster A's coordinator and
  // then switching to cluster B saw a fake "Processing…" bubble on
  // B's coordinator. In-flight turn state belongs to the active
  // session only.
  setState('pendingReplyConvs', {});
  // V89.2 — same logic for the streaming-idle marker.
  setState('lastDeltaTsByConv', {});
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
  // V86x — Operator's rule: NEVER inject synthetic messages into a
  // conv. The Coordinator's "welcome bubble" was always a fake — it
  // had a fresh timestamp every refresh, it survived next to real
  // chat history, and it landed in the conv as if the agent had
  // just said hello. Now we just create the empty slot so the rail
  // card stays (V82 design), and let the Coordinator introduce
  // itself organically when the operator sends the first prompt.
  // The bootstrap brief still attaches as context_doc to the first
  // dispatch (see ChatComposer + onboardingBootstrapBrief).
  setState('convMap', ONBOARDING_CONV_ID, []);
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
  // V86x — Operator's rule: never inject synthetic messages. New
  // typed agents (deploy / db / testing / audit / docs / review)
  // arrive as empty convs; the agent itself introduces itself on
  // the first turn (its prompt + role is already loaded server-side
  // via cluster.yaml / agent_type registry). Per-type welcomes
  // (welcomeForAgentType) live in onboarding-brief.ts for the
  // operator's own reference but no longer auto-render.
  if (!state.convMap[slug]) setState('convMap', slug, []);
  ensureConvMeta(slug, { type: opts.type, title: opts.title, model: opts.model });
  setState('activeConv', slug);
  return slug;
}

/**
 * V87 — Spawn a fresh agent + conv for a story run. Called from
 * `InitiativeCard.startRun`. Always returns a brand-new slug — never
 * reuses an existing one — because the operator's contract is "play =
 * new agent, new context, isolated cancel domain". The new conv lands
 * in convMap so the rail picks it up immediately, with a convMeta
 * agentId assigned via `nextAgentId` and the initiative's title as
 * the agent's display name.
 */
function createStoryConv(opts: { initiativeId: string; initiativeTitle: string }): string {
  const stamp = Date.now().toString(36);
  const slug = `story-${opts.initiativeId}-${stamp}`;
  if (!state.convMap[slug]) setState('convMap', slug, []);
  ensureConvMeta(slug, {
    type: 'custom',
    title: opts.initiativeTitle,
    location: { type: 'local', host: 'this machine' },
  });
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

/**
 * V102 — Hydrate the archive set from the daemon's authoritative
 * `/chat/archives`. Called once on cluster bind so archived convs
 * land in the cockpit's filter EVEN if they were archived from
 * another tab / the CLI / a cleanup script. Before V102 the
 * cockpit's `archivedConvs` was cockpit-local-only: archiving in
 * one tab didn't affect another, and `POST /chat/archive` from a
 * script never reached the rail.
 */
function hydrateArchives(map: Record<string, unknown>): void {
  if (!map) return;
  const out: Record<string, true> = {};
  for (const k of Object.keys(map)) {
    if (k && k !== ONBOARDING_CONV_ID) out[k] = true;
  }
  setState('archivedConvs', out);
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

// V89.2 — Set while replaying timeline events on cockpit boot. Read by
// ingestEvent's chat.assistant.final branch to skip the auto-expand
// "_freshFinal" flag — otherwise every rehydrated assistant message
// would expand on reload, defeating the design ("only the LIVE summary
// auto-expands; persisted bubbles default to collapsed").
let hydrating = false;

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
    // V89.2 — stamp last-delta timestamp so the bubble's idle-loader
    // can tell when the agent has been silent for a while.
    setState('lastDeltaTsByConv', conv, Date.now());
    return;
  }
  if (ev.type === 'chat.assistant.final') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    const cleaned = stripRememberLines(text);
    const idx = arr.findIndex(
      (m) => m.kind === 'assistant' && streamId !== undefined && m.stream_id === streamId,
    );
    // V89.2 — only flag _freshFinal on LIVE events. During timeline
    // rehydration we re-run every historical final through the same
    // reducer; flagging fresh on those would make every old summary
    // auto-expand on reload, which is the opposite of the design.
    const freshFinal = !hydrating;
    if (idx >= 0) {
      setState('convMap', conv, idx, {
        text: cleaned,
        streaming: false,
        _freshFinal: freshFinal || undefined,
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
          _freshFinal: freshFinal || undefined,
        },
      ]);
    }
    // V86p — final without prior delta also drops the pending flag.
    clearPendingReply(conv);
    // V89.2 — turn is over; drop the idle-loader marker.
    if (state.lastDeltaTsByConv[conv] !== undefined) {
      setState('lastDeltaTsByConv', (xs) => {
        const { [conv]: _drop, ...rest } = xs;
        return rest;
      });
    }
    // V89.4 — clear server-derived agentStatus (set by
    // hydrateActiveConvs on boot). Without this, the rail card stays
    // on "working" forever after a final because statusOf checks
    // agentStatus BEFORE the streaming derivation.
    clearAgentStatusFor(conv);
    return;
  }
  if (ev.type === 'chat.cancelled') {
    const last = arr[arr.length - 1];
    if (last && last.kind === 'assistant' && last.streaming) {
      setState('convMap', conv, arr.length - 1, { streaming: false, cancelled: true });
    }
    clearPendingReply(conv);
    if (state.lastDeltaTsByConv[conv] !== undefined) {
      setState('lastDeltaTsByConv', (xs) => {
        const { [conv]: _drop, ...rest } = xs;
        return rest;
      });
    }
    clearAgentStatusFor(conv);
  }
  // V102 — daemon-driven archive sync. The daemon broadcasts
  // `chat.archived` / `chat.unarchived` whenever `/chat/archive`
  // is hit (from any tab, the CLI, a cleanup script). Before V102
  // these were ignored — the rail filter stayed cockpit-local.
  if (ev.type === 'chat.archived') {
    if (conv && conv !== ONBOARDING_CONV_ID) {
      setState('archivedConvs', conv, true);
    }
  } else if (ev.type === 'chat.unarchived') {
    if (conv) {
      setState('archivedConvs', (xs) => {
        const { [conv]: _drop, ...rest } = xs;
        return rest;
      });
    }
  }
}

/** V89.4 — derive the agentId for a conv and clear its status. Used
 *  by ingestEvent on terminal turn events so the rail card flips
 *  back to "idle" once the daemon's chat session is gone. */
function clearAgentStatusFor(conv: string): void {
  const meta = state.convMeta[conv];
  if (meta?.agentId) clearAgentStatus(meta.agentId);
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
  // V89.1 — Mark pending BEFORE the HTTP round-trip. The daemon
  // sometimes emits the first assistant delta (or even the final, for
  // fast prompts) BEFORE this fetch resolves. If we set the flag
  // after the fetch, ingestEvent's clearPendingReply runs against an
  // empty entry and is a no-op, then we set the flag AFTER the events
  // already cleared → bubble stuck forever showing "Generando…" on a
  // conv that finished seconds ago. Setting eagerly here lets the
  // event handler clear it correctly even on the fast-path race.
  setState('pendingReplyConvs', conv, Date.now());
  const res = await client.chatDispatch(body);
  if (!res.ok) {
    const list = state.convMap[conv] ?? [];
    const idx = list.findIndex((m) => m._placeholder_user && m.ts === localTs);
    if (idx >= 0) {
      setState('convMap', conv, list.filter((_, i) => i !== idx));
    }
    // Roll back the optimistic pending flag if the dispatch failed.
    clearPendingReply(conv);
    log.warn('chat dispatch failed', res.status, res.body);
    return { ok: false, status: res.status, error: res.body };
  }
  if (!state.activeConv) setState('activeConv', res.data.conv ?? conv);
  // If the daemon picked a different conv id (very rare — happens
  // when we send conv=null in the body), migrate the flag.
  const finalConv = res.data.conv ?? conv;
  if (finalConv !== conv) {
    clearPendingReply(conv);
    setState('pendingReplyConvs', finalConv, Date.now());
  }
  return { ok: true, conv: finalConv };
}

function clearPendingReply(conv: string): void {
  if (state.pendingReplyConvs[conv] === undefined) return;
  setState('pendingReplyConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
}

/**
 * V86q — Rehydrate convMap from the daemon's `/state.timeline.recent_events`
 * payload (py-1.1.0+ — pre-existing channel, no new endpoint needed).
 * Called by App.tsx after `serverStore.refreshNow` lands so a browser
 * refresh doesn't wipe the visible chat. Replays the events through
 * the SAME `ingestEvent` reducer that handles live WS events — no
 * duplicate parsing logic, the assistant-bubble dedup/streaming
 * machinery stays in ONE place.
 *
 * Why a wipe first: ingestEvent is append/upsert by nature, so
 * re-running it on top of an existing convMap would either double up
 * (if user placeholders re-collide) or look fine but quietly leave
 * stale entries. Wiping and rebuilding mirrors the vanilla V80
 * indexEvents() path the daemon's `_recent_timeline_events` was
 * designed for.
 *
 * Skips touching convMeta — that's operator-defined (agent name,
 * id) and persists via its own localStorage slot.
 */
function hydrateFromTimeline(events: DaemonEvent[]): void {
  // Reset the chat-relevant slice first so a re-hydrate after project
  // hot-swap doesn't merge two clusters' bubbles.
  setState('convMap', {});
  hydrating = true;
  try {
    for (const ev of events) {
      const t = typeof ev.type === 'string' ? ev.type : '';
      if (
        t === 'chat.user' ||
        t === 'chat.assistant.delta' ||
        t === 'chat.assistant.final' ||
        t === 'chat.cancelled'
      ) {
        ingestEvent(ev);
      }
    }
  } finally {
    hydrating = false;
  }
  // The daemon emits the timeline oldest→newest already; ingestEvent
  // handles the streaming/final/cancelled lifecycle in that order.
  // ensureConvMeta for any conv we just learned about so the rail
  // shows them.
  for (const conv of Object.keys(state.convMap)) {
    if (!state.convMeta[conv]) ensureConvMeta(conv);
  }
}

/**
 * V89.4 — Seed agent-rail "working" + chat preparing-bubble state
 * from the daemon's /health.chat_active_convs at boot/reconnect.
 *
 * Operator bug: after F5, the cockpit replayed timeline.recent_events
 * (which gave finalised history) and waited for the next WS delta to
 * realise that A001 was still mid-turn. That gap could be ~20 s if
 * the runner was deep in a tool call. py-1.10.2 surfaces the live
 * conv list on /health so the cockpit can paint "working" the
 * instant attach() resolves — zero wait.
 *
 * For each conv in the list:
 *   - Map conv → agentId via convMeta. If no agentId yet, skip (the
 *     rail entry will appear later via ensureConvMeta).
 *   - Mark agentStatus[agentId] = {state: 'working', conv} so
 *     ChatRail.statusOf returns 'working' immediately.
 *   - If no streaming assistant bubble exists in the conv yet,
 *     stamp pendingReplyConvs[conv] so the chat panel shows the
 *     PreparingBubble (rotating verbs). Cleared automatically by
 *     the next delta/final/cancelled.
 *
 * Idempotent — calling it twice with overlapping lists is safe.
 */
function hydrateActiveConvs(convs: string[]): void {
  if (!convs || convs.length === 0) return;
  const now = Date.now();
  for (const conv of convs) {
    if (!conv) continue;
    const meta = state.convMeta[conv];
    if (meta?.agentId) {
      setAgentStatus(meta.agentId, { state: 'working', conv });
    }
    const list = state.convMap[conv] ?? [];
    const hasStream = list.some((m) => m.kind === 'assistant' && m.streaming);
    if (!hasStream && state.pendingReplyConvs[conv] === undefined) {
      setState('pendingReplyConvs', conv, now);
    }
  }
}

export const chatStore = {
  state,
  bindCluster,
  clearClusterChat,
  ensureConvMeta,
  createConv,
  createStoryConv,
  setActiveConv,
  seedOnboardingConv,
  onboardingHasUserMessages,
  setConvTitle,
  archiveConv,
  unarchiveConv,
  hydrateArchives,
  setAgentStatus,
  clearAgentStatus,
  ingestEvent,
  ingestEventForCluster,
  dispatchMessage,
  hydrateFromTimeline,
  hydrateActiveConvs,
};

log.debug('state/chat loaded');
