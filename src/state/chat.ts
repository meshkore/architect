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
import type {
  DaemonClient,
  DaemonEvent,
  DispatchBody,
  ChatConvSummary,
  ChatSnapshotResponse,
  ChatQueueItem,
  ChatUsageTotal,
} from '~/lib/daemon-client';
import { log } from '~/lib/log';
import { viewStore } from '~/state/view';

export const ONBOARDING_CONV_ID = '_onboarding_v1';

export type AgentType = 'custom' | 'deploy' | 'db' | 'testing' | 'audit' | 'docs' | 'review' | 'roadmap-architect';

export interface ConvMeta {
  agentId: string;
  model: string;
  type: AgentType;
  title: string;
  location: { type: 'local' | 'remote'; host?: string; provider?: string };
}

/** py-1.11.0 — Status kind used by the rail's `AgentCard` prop. Was
 *  the surface of the (now-deleted) `agentStatus` map; kept as a
 *  string union so AgentCard's prop type doesn't have to change.
 *  Computed by `ChatRail.statusOf` from `chatStore.state.convs`. */
export type AgentStatusKind = 'idle' | 'thinking' | 'working';

/** Chat attachment served by the daemon. The `url` is daemon-relative
 *  (e.g. `/chat/uploads/2026-06-10/abc.png`); resolve against the
 *  active daemon's httpBase to display. */
export interface ChatAttachment {
  kind: 'image' | 'file';
  media_type: string;
  url: string;
  size_bytes?: number;
  filename?: string;
}

export interface ChatMsg {
  /**
   * 'user'      — operator-typed message (and its echoes from the daemon).
   * 'assistant' — agent reply (deltas + final).
   * 'system'    — CLIENT-ONLY notice. Used to surface dispatch errors
   *               and other in-band warnings the operator should see in
   *               the chat thread instead of buried in console logs.
   *               Never broadcast over WS, never persisted by the daemon.
   *               2026-06-10 operator request: "si hay un error lo
   *               deberíamos poner ahí" (in the chat).
   */
  kind: 'user' | 'assistant' | 'system';
  text: string;
  author?: string;
  ts?: string;
  streaming?: boolean;
  stream_id?: string;
  cancelled?: boolean;
  /** Set on client-side 'system' messages so renderers can pick the
   *  right severity styling. */
  system_kind?: 'error' | 'warning' | 'info';
  /** py-1.12.21 — chat attachments persisted by the daemon. Each entry
   *  carries a `url` that resolves to `GET /chat/uploads/<bucket>/<file>`
   *  on the daemon. Currently emitted only for `kind: 'user'` events
   *  whose dispatch carried images / docs. */
  attachments?: ChatAttachment[];
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
  /** py-1.11.0 — chat-state-rearchitecture. Daemon-authoritative conv
   *  summaries from `GET /chat/snapshot` + WS conv.* events. When
   *  populated, this is the single source of truth for the rail list
   *  AND for "is this conv live / coordinating / waiting on who".
   *  Empty `{}` when the daemon lacks `chat.snapshot.v1` — cockpit
   *  falls back to convMap+convMeta union + chat_activity. */
  convs: Record<string, ChatConvSummary>;
  /** ISO ts of the last full snapshot hydration. Cockpit uses this to
   *  decide whether to trust `convs` (recent enough) or refetch.
   *  Null on cold start or after a cluster swap. */
  convsHydratedAt: string | null;
  /** V107.41 — Standard v16 chat-turn queue. Per-conv list of items
   *  waiting to be dispatched. Daemon-authoritative (auto-flushes the
   *  head when the conv goes idle after a turn final). Cockpit ingests
   *  via WS `queue.item.*` events. Empty array when no queue. */
  queues: Record<string, ChatQueueItem[]>;
  /** 2026-06-12 — per-conv pagination cursor for the windowed history
   *  loader. A long-lived conv has hundreds of persisted messages; the
   *  UI only ever renders a sliding window (INITIAL_PAGE on focus,
   *  +PAGE on scroll-up, hard-capped at UI_MESSAGE_CAP). The storage
   *  keeps everything; we just don't paint past the cap. */
  paging: Record<string, ChatPaging>;
}

export interface ChatPaging {
  /** Daemon says there are older messages beyond what we've loaded. */
  hasMore: boolean;
  /** ISO ts of the oldest message currently in convMap (the `before`
   *  cursor for the next older page). */
  oldestTs: string;
  /** A page fetch is in flight (prevents double-trigger on scroll). */
  loading: boolean;
  /** UI cap reached: even if `hasMore`, we stop loading to protect the
   *  render + memory. The history still exists on disk. */
  capped: boolean;
}

const initial: ChatStoreState = {
  convMap: {},
  activeConv: null,
  archivedConvs: {},
  convMeta: {},
  convTitleOverrides: {},
  clusterActivity: {},
  pendingReplyConvs: {},
  lastDeltaTsByConv: {},
  convs: {},
  convsHydratedAt: null,
  queues: {},
  paging: {},
};

// 2026-06-12 — windowed history loader knobs.
//   INITIAL_PAGE — messages loaded when a conv gains focus / on reload.
//   PAGE         — messages loaded per scroll-up step.
//   UI_MESSAGE_CAP — hard ceiling on rendered messages per conv. Past
//                    this we stop loading older pages AND trim the
//                    oldest as live finals append, so a long session
//                    never balloons the DOM. The daemon keeps the full
//                    history; the operator just can't scroll past it
//                    in the cockpit.
export const INITIAL_PAGE = 20;
export const PAGE = 20;
export const UI_MESSAGE_CAP = 100;

const [state, setState] = createStore<ChatStoreState>(initial);
const [activeClusterId, setActiveClusterId] = createSignal<string | null>(null);

// ── convMeta persistence (V79r) ─────────────────────────────────────

const CONV_META_KEY_PREFIX = 'mc-conv-meta-v1::';
function metaKey(): string {
  return CONV_META_KEY_PREFIX + (activeClusterId() ?? 'unknown');
}

// V107.17 — sticky-last-conv per cluster. The operator's most-recent
// active conv is written here on every `setActiveConv`, and read back
// at boot by App.pickDefaultConv so a reload lands on the same agent
// (master Architect or any other) rather than "most recently active".
const LAST_CONV_KEY_PREFIX = 'mc-last-conv-v1::';
function lastConvKey(clusterId: string | null): string {
  return LAST_CONV_KEY_PREFIX + (clusterId ?? 'unknown');
}
export function loadLastActiveConv(clusterId: string | null): string | null {
  try {
    return localStorage.getItem(lastConvKey(clusterId));
  } catch {
    return null;
  }
}

// py-1.11.0 Phase 2 — `archivedConvs` localStorage cache removed.
// The set is now authored server-side and arrives via:
//   1. `GET /chat/snapshot` on boot (seeded by hydrateFromSnapshot)
//   2. `conv.archived` / `conv.unarchived` WS events (handled by
//      ingestConvEvent)
// The pre-Phase-2 mc-archived-convs-v1::* key is intentionally NOT
// cleaned up here — leftover entries are harmless and will be garbage-
// collected by the browser's normal localStorage churn.
const saveArchivedConvs = (): void => { /* no-op; daemon is the source */ };

/**
 * V107.8 — Infer agent_type from the conv slug pattern.
 *
 * The cockpit's createConv produces slugs like `roadmap-architect-XXXXX`
 * for typed agents. The slug is the unforgeable signal of intent —
 * every other channel (meta.type in localStorage, body.agent_type in
 * the dispatch, daemon's conv_meta sidecar) can drift out of sync.
 *
 * When the slug carries the type, treat it as the source of truth.
 * Sister of the daemon's _agent_type_from_conv_slug (py-1.10.12).
 */
const SLUG_TYPE_PREFIXES: Array<[string, AgentType]> = [
  ['roadmap-architect-', 'roadmap-architect'],
  ['deploy-', 'deploy'],
  ['db-', 'db'],
  ['testing-', 'testing'],
  ['audit-', 'audit'],
  ['docs-', 'docs'],
  ['review-', 'review'],
];
function agentTypeFromSlug(conv: string): AgentType | null {
  if (!conv) return null;
  for (const [prefix, implied] of SLUG_TYPE_PREFIXES) {
    if (conv.startsWith(prefix)) return implied;
  }
  return null;
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
      let migrated = 0;
      for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
        if (!isConvMeta(v)) continue;
        let healed = { ...v };
        let touched = false;
        // V107.8 — heal stale slug/type mismatches on load.
        const slugImplied = agentTypeFromSlug(k);
        if (slugImplied && healed.type !== slugImplied) {
          healed = { ...healed, type: slugImplied };
          touched = true;
        }
        // V107.12 — rename the onboarding master from the legacy
        // 'Coordinator' label to 'Architect Agent'. Only flips the
        // default — if the operator renamed it themselves, their
        // custom title is preserved.
        if (k === ONBOARDING_CONV_ID && healed.title === 'Coordinator') {
          healed = { ...healed, title: 'Architect Agent' };
          touched = true;
        }
        if (touched) migrated += 1;
        out[k] = healed;
      }
      setState('convMeta', out);
      if (migrated > 0) {
        log.info('convMeta migrated stale agent_type entries', { count: migrated });
        // Persist the healed entries back to localStorage so subsequent
        // sessions don't repeat the migration work.
        saveConvMeta();
      }
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
  archivedConvs: Record<string, true>;
  convMeta: Record<string, ConvMeta>;
  convTitleOverrides: Record<string, string>;
}

const clusterSnapshots = new Map<string, ClusterChatSlice>();

function snapshotCurrent(): ClusterChatSlice {
  return {
    convMap: { ...state.convMap },
    activeConv: state.activeConv,
    archivedConvs: { ...state.archivedConvs },
    convMeta: { ...state.convMeta },
    convTitleOverrides: { ...state.convTitleOverrides },
  };
}

function restoreSlice(slice: ClusterChatSlice): void {
  setState({
    convMap: slice.convMap,
    activeConv: slice.activeConv,
    archivedConvs: slice.archivedConvs,
    convMeta: slice.convMeta,
    convTitleOverrides: slice.convTitleOverrides,
  });
}

// ── Public actions ──────────────────────────────────────────────────

function bindCluster(clusterId: string | null): void {
  const prevId = activeClusterId();
  // Idempotent — repeated notifyActiveChanged for the same cluster must
  // not reset activeConv / conv maps (that ping-pongs with App's default-
  // conv effect and can blow the Solid flush stack on refresh).
  if (prevId === clusterId) return;
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
  // py-1.11.2-cockpit — Always reset the daemon-authoritative state
  // (`convs` + `convsHydratedAt`) on swap, BEFORE the cached-slice
  // restore. ClusterChatSlice only caches the chat-wall slice
  // (messages, title overrides, archived set, convMeta) — it never
  // captured `convs`, so a cached restore would leave the rail showing
  // the prior cluster's daemon-authoritative entries. Fixes the bug
  // where switching from project A to project B (both visited this
  // session) made B's rail render A's convs until the snapshot fetch
  // resolved.
  setState({ convs: {}, convsHydratedAt: null });
  // Restore the new cluster's slice if we've seen it this session.
  const cached = clusterId ? clusterSnapshots.get(clusterId) : null;
  if (cached) {
    restoreSlice(cached);
    return;
  }
  // First time visiting this cluster this session — reset everything
  // else too. Hydration comes from `chatStore.hydrateFromSnapshot`
  // (App.tsx boot path) populating both `convs` and `convMeta` from
  // the daemon payload. `loadConvMeta` is the optimistic cache for
  // frame 1 (rail renders something before the snapshot fetch resolves).
  setState({
    convMap: {},
    activeConv: null,
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
      archivedConvs: {},
      convMeta: {},
      convTitleOverrides: {},
      convs: {},
      convsHydratedAt: null,
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
/** Validate + normalise the daemon's `chat.user.attachments` field.
 *  Returns undefined if no valid entries; the caller treats undefined
 *  the same as "no attachments". */
function parseAttachments(raw: unknown): ChatAttachment[] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const out: ChatAttachment[] = [];
  for (const e of raw) {
    if (!e || typeof e !== 'object') continue;
    const rec = e as Record<string, unknown>;
    const url = typeof rec.url === 'string' ? rec.url : '';
    const media_type = typeof rec.media_type === 'string' ? rec.media_type : '';
    if (!url || !media_type) continue;
    const kind = rec.kind === 'image' ? 'image' : 'file';
    out.push({
      kind,
      media_type,
      url,
      size_bytes: typeof rec.size_bytes === 'number' ? rec.size_bytes : undefined,
      filename: typeof rec.filename === 'string' ? rec.filename : undefined,
    });
  }
  return out.length ? out : undefined;
}

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
    const attachments = parseAttachments(ev.attachments);
    const phIdx = arr.findIndex(
      (m) => m.kind === 'user' && m._placeholder_user && m.text === text && (!author || m.author === author),
    );
    if (phIdx >= 0) {
      const next = arr.slice();
      const prev = next[phIdx]!;
      next[phIdx] = {
        ...prev,
        author,
        ts: typeof ev.ts === 'string' ? ev.ts : undefined,
        attachments,
        _placeholder_user: undefined,
      };
      slice.convMap[conv] = next;
      return;
    }
    slice.convMap[conv] = [
      ...arr,
      {
        kind: 'user',
        text,
        author,
        ts: typeof ev.ts === 'string' ? ev.ts : undefined,
        attachments,
      },
    ];
    return;
  }
  if (ev.type === 'chat.assistant.delta') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    if (!streamId) return;
    const idx = arr.findIndex((m) => m.kind === 'assistant' && m.stream_id === streamId);
    const cleaned = stripAnchorMarkers(stripRememberLines(text));
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
    const cleaned = stripAnchorMarkers(stripRememberLines(text));
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
  // V107.17 — persist per-cluster so a reload lands on the same agent.
  try {
    const key = lastConvKey(activeClusterId());
    if (conv) localStorage.setItem(key, conv);
    else localStorage.removeItem(key);
  } catch { /* quota — non-fatal */ }
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
    // V107.12 — Renamed from 'Coordinator' to 'Architect Agent' per
    // operator request 2026-05-30: the new label is distinctive from
    // the transient roadmap-architect (which is spawned per Run All
    // pass) and reinforces that THIS is the always-on master that
    // owns the project. The conv id (_onboarding_v1) is unchanged
    // — only the operator-visible name changes.
    title: 'Architect Agent',
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
  // V107.30 — Use setActiveConv (not raw setState) so the picked slug
  // is persisted in localStorage (`mc-last-conv-v1::<cluster>`). Pre-fix,
  // reloading right after creating an agent dropped the selection back
  // to Master because activeConv was set in-memory only.
  setActiveConv(slug);
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
  saveArchivedConvs();
}

function unarchiveConv(conv: string): void {
  setState('archivedConvs', (xs) => {
    const { [conv]: _drop, ...rest } = xs;
    return rest;
  });
  saveArchivedConvs();
}

// py-1.11.2 — `scheduleSubagentAutoArchive` / `cancelSubagentAutoArchive`
// removed. The daemon now archives finished `work-*` subagent convs
// server-side in the runner's final handler and broadcasts
// `conv.archived` so every cockpit drops them from the active list in
// one tick. The cockpit no longer needs a 6 s timer for this.

/**
 * V106 — Cross-cockpit selector: is there a Roadmap Architect
 * conv alive right now? Used by both InitiativesPanel (Run all
 * button state) and InitiativeCard (per-initiative play button
 * cross-disable). Returns the most-recent non-archived
 * architect conv id, or null. Double predicate (type === or
 * slug startsWith) — same as InitiativesPanel.archCandidates
 * V99 — so a convMeta entry whose `type` field got corrupted by
 * a pre-V92 bundle still counts.
 */
function findActiveArchitectConv(): string | null {
  let best: string | null = null;
  let bestTs = '';
  for (const [conv, meta] of Object.entries(state.convMeta)) {
    if (state.archivedConvs[conv]) continue;
    const looksArch = meta.type === 'roadmap-architect' || conv.startsWith('roadmap-architect-');
    if (!looksArch) continue;
    const ts = (state.convMap[conv] ?? []).at(-1)?.ts ?? '';
    if (ts >= bestTs) { best = conv; bestTs = ts; }
  }
  return best;
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
 * 2026-06-12 — Belt-and-suspenders strip for the daemon-frontend
 * `⟦anchor⟧ {...}` / `⟦anchor-progress⟧ {...}` wire-protocol markers.
 * Daemon py-1.13.2 strips them server-side before persisting, but
 * older daemons OR historical messages persisted by py-1.13.0/1.13.1
 * still carry them. Defensive scrub at the cockpit so the operator
 * never sees the wire format leak into chat regardless of daemon
 * version on the other end.
 */
function stripAnchorMarkers(text: string): string {
  if (!text || !text.includes('⟦anchor')) return text;
  return text
    .replace(/^[\s\n]*⟦anchor⟧\s*\{[^\n]*\}[ \t]*\n?/, '')
    .replace(/⟦anchor-progress⟧\s*\{[^\n]*\}[ \t]*\n?/g, '');
}

// py-1.11.0 — Set while pre-seeding convMap from a `chatConvMessages`
// pagination fetch, so the ingest reducer treats historical messages
// as rehydration (e.g. the work-* conv auto-unarchive guard below
// stays inert). Set by `loadConvMessagesPage` around the seed loop.
let hydrating = false;

/**
 * Ingest one daemon event into the chat store. Idempotent — same
 * stream_id replaces in place rather than appending duplicates.
 */
function ingestEvent(ev: DaemonEvent): void {
  const conv = typeof ev.conv === 'string' ? ev.conv : null;
  if (!conv) return;
  // py-1.11.0 — Safety net: if a previously-archived work-* conv
  // starts talking again (rare — the daemon would normally emit
  // `conv.unarchived` first), un-archive locally. Cheap insurance.
  if (
    !hydrating &&
    state.archivedConvs[conv] &&
    conv.startsWith('work-') &&
    (ev.type === 'chat.user' ||
      ev.type === 'chat.assistant.delta' ||
      ev.type === 'chat.assistant.final')
  ) {
    unarchiveConv(conv);
  }
  const arr = state.convMap[conv] ?? [];
  if (ev.type === 'chat.user') {
    const text = typeof ev.text === 'string' ? ev.text : '';
    const author = typeof ev.author === 'string' ? ev.author : undefined;
    const attachments = parseAttachments(ev.attachments);
    // Replace any optimistic placeholder with the canonical echo so the
    // bubble isn't duplicated (timestamps differ between client + daemon).
    const phIdx = arr.findIndex(
      (m) => m.kind === 'user' && m._placeholder_user && m.text === text && (!author || m.author === author),
    );
    if (phIdx >= 0) {
      setState('convMap', conv, phIdx, {
        author,
        ts: typeof ev.ts === 'string' ? ev.ts : undefined,
        attachments,
        _placeholder_user: undefined,
      });
      return;
    }
    setState('convMap', conv, [
      ...arr,
      { kind: 'user', text, author, ts: typeof ev.ts === 'string' ? ev.ts : undefined, attachments },
    ]);
    return;
  }
  if (ev.type === 'chat.assistant.delta') {
    const streamId = typeof ev.stream_id === 'string' ? ev.stream_id : undefined;
    const text = typeof ev.text === 'string' ? ev.text : '';
    if (!streamId) return;
    // Find existing live bubble for this stream.
    const idx = arr.findIndex((m) => m.kind === 'assistant' && m.stream_id === streamId);
    const cleaned = stripAnchorMarkers(stripRememberLines(text));
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
    const cleaned = stripAnchorMarkers(stripRememberLines(text));
    const idx = arr.findIndex(
      (m) => m.kind === 'assistant' && streamId !== undefined && m.stream_id === streamId,
    );
    // V107.36 — _freshFinal auto-expand removed (it un-clamped every
    // fresh reply → 50-line walls landed expanded). Fresh finals now
    // respect the CollapsibleText clamp; contract-following agents
    // self-disclose via <details> and aren't clamped at all.
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
    // V89.2 — turn is over; drop the idle-loader marker.
    if (state.lastDeltaTsByConv[conv] !== undefined) {
      setState('lastDeltaTsByConv', (xs) => {
        const { [conv]: _drop, ...rest } = xs;
        return rest;
      });
    }
    // py-1.11.2 — Auto-archive moved server-side. The daemon archives
    // finished work-* subagent convs in its runner's final handler and
    // broadcasts conv.archived; the cockpit just reacts via
    // ingestConvEvent.
    // 2026-06-12 — windowed-history cap. After a LIVE final appends,
    // trim the conv's rendered window to the newest UI_MESSAGE_CAP so a
    // long session doesn't balloon the DOM. Only during live ingest
    // (not hydrating — the initial page is already ≤ INITIAL_PAGE). The
    // daemon keeps the full history; we just cap what's painted.
    if (!hydrating) capConvWindow(conv);
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
  }
  // py-1.11.0 Phase 2 — legacy `chat.archived` / `chat.unarchived`
  // events were deleted from the daemon's broadcast set. The
  // snapshot.v1 path now uses `conv.archived` / `conv.unarchived`
  // (routed via ingestConvEvent in event-bus.ts).
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
  // V107.8 — Slug-implied agent_type wins. The conv slug pattern
  // `roadmap-architect-XXXXX` is unforgeable — if it carries the
  // type, the dispatch body MUST carry it too. Heals two failure
  // modes observed in production:
  //   1. Stale localStorage convMeta from a pre-AgentType-union build
  //      that has `type: 'custom'` on an architect slug.
  //   2. A race where dispatchMessage fires before ensureConvMeta has
  //      finished writing to the store (shouldn't happen with Solid's
  //      sync setState, but the safety net is cheap).
  // Sister of the daemon's _agent_type_from_conv_slug (py-1.10.12).
  const slugImplied = agentTypeFromSlug(conv);
  const finalType = slugImplied ?? meta?.type;
  if (finalType) body.agent_type = finalType;
  if (meta?.agentId) body.agent_id = meta.agentId;
  // MP2 (2026-06-12) — propagate the per-conv model preference from
  // convMeta (set by NewAgentWizard) to the dispatch. Daemon py-1.13.3+
  // persists it in conv_meta and ChatRunner.spawn injects
  // `--model <id>` into claude-code. `auto` / empty = let the CLI
  // default — omitted from the body so older daemons that don't yet
  // understand `model` aren't confused.
  if (meta?.model && meta.model !== 'auto') body.model = meta.model;
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
  // 2026-06-11 operator field report: a 400 "empty dispatch" came back
  // for a send that visibly had text + image attached. To diagnose, log
  // the request shape on EVERY dispatch (image data redacted) so a
  // failed send leaves a console breadcrumb of what was actually on the
  // wire. Cheap (a few fields, no payload echo).
  const _diagShape = {
    conv,
    text_len: (body.text ?? '').length,
    text_preview: (body.text ?? '').slice(0, 60),
    images: (body.images ?? []).length,
    context_docs: (body.context_docs ?? []).length,
    agent_type: body.agent_type ?? null,
    initiative_id: body.initiative_id ?? null,
    task_id: body.task_id ?? null,
  };
  log.info('chat dispatch →', _diagShape);
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
    log.warn('chat dispatch failed', res.status, res.body, 'sent:', _diagShape);
    // 2026-06-10 operator request: surface dispatch errors INSIDE the
    // chat thread, not just in the console. Distinguish two regimes:
    //   • 4xx           → prompt-side error (validation, auth, etc.).
    //                     Push a system bubble explaining the problem
    //                     so the operator can fix the input and resend.
    //   • status === 0  → transport failure (daemon offline, network).
    //                     The central OfflinePanel handles this case —
    //                     suppressing the in-chat bubble here so we
    //                     don't double-surface the same problem.
    //   • 5xx           → daemon crashed mid-dispatch. The OfflinePanel
    //                     will catch it on the next health probe;
    //                     surface a brief notice in-chat too so the
    //                     operator has immediate feedback.
    if (res.status !== 0) {
      const errBody = (res.body || '').toString();
      let humanMsg = '';
      try {
        const parsed = JSON.parse(errBody) as { error?: string };
        if (parsed && typeof parsed.error === 'string') humanMsg = parsed.error;
      } catch {
        humanMsg = errBody;
      }
      const verb = res.status === 401
        ? 'Unauthorized — token rejected. Re-unlock and retry.'
        : res.status === 413
        ? 'Payload too large — attachment exceeds the daemon limit.'
        : res.status >= 500
        ? 'Daemon error — the request reached the daemon but it failed mid-handling.'
        : 'Dispatch refused';
      const detail = humanMsg && humanMsg !== verb ? ` (${humanMsg})` : '';
      // Annotate the bubble with what was actually on the wire so the
      // operator can compare against what they thought they sent. For
      // "empty dispatch" this exposes the bug: text_len=0 + images=0 +
      // context_docs=0 → "you clicked send but the body was empty".
      const shapeDetail = ` · sent text:${_diagShape.text_len}ch images:${_diagShape.images} docs:${_diagShape.context_docs}`;
      const currentList = state.convMap[conv] ?? [];
      // Dedup consecutive identical system errors within a 2 s window —
      // the cockpit's retry/route-on-401 logic can fire the same 400
      // back-to-back; one bubble is enough.
      const last = currentList[currentList.length - 1];
      const nextText = `${verb}${detail}${shapeDetail}`;
      const lastTs = last?.ts ? Date.parse(last.ts) : 0;
      const isDuplicate =
        last?.kind === 'system' &&
        last?.system_kind === 'error' &&
        last?.text === nextText &&
        Date.now() - lastTs < 2000;
      if (!isDuplicate) {
        setState('convMap', conv, [
          ...currentList,
          {
            kind: 'system',
            system_kind: 'error',
            text: nextText,
            ts: new Date().toISOString(),
          },
        ]);
      }
    }
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

// ── py-1.11.0: chat-state-rearchitecture (initiative
//   `chat-state-rearchitecture`). Daemon-authoritative conv list +
//   WS conv.* event ingestion. Cockpit boot flips between this path
//   and the legacy timeline-replay path based on the
//   `chat.snapshot.v1` feature flag on /health.
// ─────────────────────────────────────────────────────────────────

/** Replace the per-conv summary map with the daemon's snapshot. Also
 *  seeds the archived set + convMeta from the same payload so the
 *  rest of the cockpit (which still reads convMeta for titles /
 *  agent type, and archivedConvs for filtering) doesn't need to
 *  fork by code path. */
function hydrateFromSnapshot(snap: ChatSnapshotResponse): void {
  const nextConvs: Record<string, ChatConvSummary> = {};
  const nextArchived: Record<string, true> = {};
  const seenConvs = new Set<string>();
  for (const c of snap.convs) {
    nextConvs[c.conv] = c;
    seenConvs.add(c.conv);
    if (c.archived) nextArchived[c.conv] = true;
    // Seed convMeta for any conv we don't already know about so the
    // legacy code paths (AgentCard title, dispatch body, …) keep
    // rendering correctly. Daemon is source of truth for type/id.
    if (!state.convMeta[c.conv]) {
      const inferredType = (c.agent_type ?? 'custom') as ConvMeta['type'];
      const agentId = c.agent_id ?? '';
      setState('convMeta', c.conv, {
        agentId,
        model: 'auto',
        type: inferredType,
        title: agentId || c.conv,
        location: { type: 'local' },
      });
    } else if (c.agent_id && !state.convMeta[c.conv]?.agentId) {
      // Heal a stale local entry with the daemon-side agent_id.
      setState('convMeta', c.conv, 'agentId', c.agent_id);
    }
  }
  // V107.24 — Prune ghosts. convMeta lives in localStorage and survives
  // across daemon archive/wipe cycles. Without pruning, AgentsPanel and
  // other readers see entries the daemon no longer recognises. The
  // daemon snapshot is authoritative: any convMeta entry not present in
  // it is dead, drop it. ONBOARDING_CONV_ID is exempt (lazy-created on
  // first message, daemon may not have surfaced it yet).
  let prunedMeta = 0;
  for (const cid of Object.keys(state.convMeta)) {
    if (cid === ONBOARDING_CONV_ID) continue;
    if (!seenConvs.has(cid)) {
      setState('convMeta', cid, undefined as unknown as ConvMeta);
      prunedMeta += 1;
    }
  }
  // Same for the local archivedConvs cache — drop entries the daemon
  // no longer recognises so we don't leak archived sets across cluster
  // wipes / migrations.
  let prunedArchived = 0;
  for (const cid of Object.keys(state.archivedConvs)) {
    if (cid === ONBOARDING_CONV_ID) continue;
    if (!seenConvs.has(cid)) {
      setState('archivedConvs', cid, undefined as unknown as true);
      prunedArchived += 1;
    }
  }
  setState('convs', nextConvs);
  setState('archivedConvs', nextArchived);
  setState('convsHydratedAt', snap.generated_at ?? new Date().toISOString());
  saveConvMeta();
  // 2026-06-10 operator field report: a cluster with a live conv but no
  // recent assistant.delta (e.g. a stuck `chat_sessions` slot on the
  // daemon — IKA had its master conv pinned live for 2.5 days because a
  // crashed subprocess never reported final) showed IDLE in the project
  // rail, even though the conv view said "STOP". Iron principle from the
  // operator: "nunca debe existir un instante en el que un agente está
  // trabajando y no se refleja en todas partes."
  //
  // Fix: seed `clusterActivity[active].workingConvs` from the snapshot.
  // The rail's busy indicator now reflects ANY conv the daemon says is
  // live or coordinating, even before the first delta streams (or when
  // no delta ever will — like a stuck conv that needs a STOP). The
  // workingConvs set is the union of (a) live/coordinating convs from
  // the snapshot and (b) any deltas seen since hydration (preserved).
  const activeId = activeClusterId();
  if (activeId) {
    const fromSnapshot = new Set(
      snap.convs.filter((c) => c.live || c.coordinating).map((c) => c.conv),
    );
    setState('clusterActivity', activeId, (prev) => {
      const merged = new Set([...(prev?.workingConvs ?? []), ...fromSnapshot]);
      return {
        lastEventAt: prev?.lastEventAt ?? Date.now(),
        lastReadAt: prev?.lastReadAt ?? 0,
        workingConvs: [...merged],
      };
    });
  }
  // SRL3 (py-1.13.1 daemon-side) — rehydrate mid-turn UI from the
  // snapshot. For every live conv that has `current_turn`, seed the
  // streaming assistant bubble in convMap with the partial text the
  // daemon already accumulated; subsequent chat.assistant.delta
  // events match by stream_id and update the SAME bubble in place.
  // Without this, a refresh while a turn is in flight left the
  // operator staring at a STOP button with no rendered output.
  let rehydratedTurns = 0;
  let rehydratedQueues = 0;
  for (const c of snap.convs) {
    const ct = (c as ChatConvSummary & { current_turn?: { started_at?: string; stream_id?: string; partial_text?: string } }).current_turn;
    if (ct && c.live && ct.stream_id) {
      const partial = stripAnchorMarkers(stripRememberLines(ct.partial_text || ''));
      const existing = state.convMap[c.conv] ?? [];
      // If we already have a streaming bubble for this stream_id (rare —
      // happens when a delta beat the snapshot fetch), don't overwrite.
      const hasLive = existing.some(
        (m) => m.kind === 'assistant' && m.streaming && m.stream_id === ct.stream_id,
      );
      if (!hasLive) {
        setState('convMap', c.conv, [
          ...existing,
          {
            kind: 'assistant',
            text: partial,
            streaming: true,
            stream_id: ct.stream_id,
            ts: ct.started_at || new Date().toISOString(),
          },
        ]);
      }
      // Keep the "preparing…" indicator visible until the next delta
      // overwrites the bubble. pendingReplyConvs is the signal
      // ChatThread reads for this.
      if (ct.started_at) {
        const startedMs = Date.parse(ct.started_at);
        if (!Number.isNaN(startedMs)) {
          setState('pendingReplyConvs', c.conv, startedMs);
        }
      }
      rehydratedTurns += 1;
    }
    const queueItems = (c as ChatConvSummary & { queue?: Array<{ id?: string; text: string; queued_at?: string }> }).queue;
    if (queueItems && queueItems.length > 0) {
      // Map the daemon's snapshot shape onto the cockpit's
      // ChatQueueItem. status="queued" because the snapshot ONLY
      // includes pending items (the head, mid-flight, would be the
      // streaming bubble itself, not a queue entry).
      const mapped: ChatQueueItem[] = queueItems.map((q, i) => ({
        id: q.id ?? `q_${i}`,
        text: q.text,
        created_at: q.queued_at || new Date().toISOString(),
        position: i,
        status: 'queued' as const,
      }));
      setState('queues', c.conv, mapped);
      rehydratedQueues += 1;
    }
  }

  log.debug('chat.snapshot.v1 hydrated', {
    convs: snap.convs.length,
    live: snap.convs.filter((c) => c.live).length,
    archived: Object.keys(nextArchived).length,
    pruned_meta: prunedMeta,
    pruned_archived: prunedArchived,
    rehydrated_turns: rehydratedTurns,
    rehydrated_queues: rehydratedQueues,
  });
}

/** Lazy-load a page of messages for `conv` and seed `convMap[conv]`.
 *  The `setActiveConv` action calls this for the conv the operator
 *  just focused; subsequent "Load earlier" UI fetches older pages with
 *  `opts.before = oldestMsg.ts`. The reducer (`ingestEvent`) is reused
 *  via `hydrating=true` so the same upsert/dedup logic that powers WS
 *  live streaming also seeds the history. */
async function loadConvMessagesPage(
  client: DaemonClient,
  conv: string,
  opts: { before?: string; limit?: number } = {},
): Promise<{ has_more: boolean; oldest_ts: string }> {
  const res = await client.chatConvMessages(conv, opts);
  if (!res.ok) {
    log.warn('loadConvMessagesPage failed', { conv, status: res.status, body: res.body.slice(0, 200) });
    return { has_more: false, oldest_ts: '' };
  }
  // If we're loading the FIRST page (no `before`), reset convMap so a
  // stale entry from a prior session doesn't double up.
  if (!opts.before) setState('convMap', conv, []);
  hydrating = true;
  try {
    for (const ev of res.data.messages) {
      const t = typeof (ev as DaemonEvent).type === 'string' ? (ev as DaemonEvent).type : '';
      if (
        t === 'chat.user' ||
        t === 'chat.assistant' ||
        t === 'chat.assistant.final' ||
        t === 'chat.cancelled'
      ) {
        // Older snapshots emit `chat.assistant` for finalised text; map
        // it to `chat.assistant.final` so the reducer treats it as a
        // closed turn (it expects `final` for the historical case).
        const mapped: DaemonEvent = t === 'chat.assistant'
          ? { ...(ev as DaemonEvent), type: 'chat.assistant.final' }
          : (ev as DaemonEvent);
        ingestEvent(mapped);
      }
    }
  } finally {
    hydrating = false;
  }
  // 2026-06-12 — record the pagination cursor so the windowed loader
  // (loadEarlierMessages) and the UI's "load earlier" affordance know
  // whether older pages exist and where to resume from.
  const list = state.convMap[conv] ?? [];
  const oldest = list.length > 0 ? (list[0].ts ?? '') : (res.data.oldest_ts ?? '');
  setState('paging', conv, {
    hasMore: !!res.data.has_more,
    oldestTs: oldest,
    loading: false,
    capped: list.length >= UI_MESSAGE_CAP,
  });
  return { has_more: res.data.has_more, oldest_ts: res.data.oldest_ts };
}

/** 2026-06-12 — Load the next older PAGE of messages for `conv` and
 *  PREPEND them to convMap. Called by ChatThread when the operator
 *  scrolls near the top. No-ops when: no more history, already loading,
 *  or the UI cap is reached (the daemon keeps the history; we just stop
 *  rendering past UI_MESSAGE_CAP to protect the DOM + memory). Returns
 *  the number of messages prepended so the caller can preserve scroll. */
async function loadEarlierMessages(client: DaemonClient, conv: string): Promise<number> {
  const p = state.paging[conv];
  if (!p || !p.hasMore || p.loading) return 0;
  const before = list_len(conv) >= UI_MESSAGE_CAP;
  if (before) {
    setState('paging', conv, 'capped', true);
    return 0;
  }
  setState('paging', conv, 'loading', true);
  const res = await client.chatConvMessages(conv, { before: p.oldestTs, limit: PAGE });
  if (!res.ok) {
    setState('paging', conv, 'loading', false);
    log.warn('loadEarlierMessages failed', { conv, status: res.status });
    return 0;
  }
  // Build the older-message array WITHOUT touching convMap's live tail,
  // then splice it on the front. We can't reuse ingestEvent here (it
  // appends), so map + prepend manually with the same shape.
  const older: ChatMsg[] = [];
  for (const ev of res.data.messages) {
    const t = typeof (ev as DaemonEvent).type === 'string' ? (ev as DaemonEvent).type : '';
    const e = ev as DaemonEvent;
    if (t === 'chat.user') {
      older.push({ kind: 'user', text: String(e.text ?? ''), author: String(e.author ?? 'operator'), ts: String(e.ts ?? '') });
    } else if (t === 'chat.assistant' || t === 'chat.assistant.final') {
      older.push({ kind: 'assistant', text: stripAnchorMarkers(stripRememberLines(String(e.text ?? ''))), streaming: false, ts: String(e.ts ?? ''), stream_id: typeof e.stream_id === 'string' ? e.stream_id : undefined });
    } else if (t === 'chat.cancelled') {
      older.push({ kind: 'assistant', text: String(e.text ?? ''), streaming: false, cancelled: true, ts: String(e.ts ?? '') });
    }
  }
  const current = state.convMap[conv] ?? [];
  const merged = [...older, ...current];
  // Respect the UI cap: if prepending would blow past it, keep the
  // NEWEST UI_MESSAGE_CAP and flag capped (no more loads). The operator
  // sees a thin "older history hidden" notice in the UI.
  let next = merged;
  let capped = false;
  if (merged.length > UI_MESSAGE_CAP) {
    next = merged.slice(merged.length - UI_MESSAGE_CAP);
    capped = true;
  }
  setState('convMap', conv, next);
  setState('paging', conv, {
    hasMore: !!res.data.has_more && !capped,
    oldestTs: next.length > 0 ? (next[0].ts ?? '') : p.oldestTs,
    loading: false,
    capped,
  });
  return older.length;
}

function list_len(conv: string): number {
  return (state.convMap[conv] ?? []).length;
}

/** 2026-06-12 — Trim a conv's rendered window to the newest
 *  UI_MESSAGE_CAP messages. Called after a live final appends. Once
 *  trimming kicks in, mark `capped` so the scroll-up loader stops
 *  fetching older pages (we'd just trim them right back off). */
function capConvWindow(conv: string): void {
  const list = state.convMap[conv] ?? [];
  if (list.length <= UI_MESSAGE_CAP) return;
  setState('convMap', conv, list.slice(list.length - UI_MESSAGE_CAP));
  const p = state.paging[conv];
  if (p) setState('paging', conv, 'capped', true);
}

/** Apply a WS `conv.*` event to the local convs map. Idempotent —
 *  the daemon may emit the same event twice (e.g. one runner finishing
 *  triggers both its own activity flip AND the parent's). */
function ingestConvEvent(ev: DaemonEvent): void {
  const type = ev.type;
  const conv = typeof ev.conv === 'string' ? ev.conv : '';
  if (!conv) return;
  // Only act when snapshot.v1 has hydrated at least once — otherwise
  // we'd be building convs on top of an empty map and racing the boot
  // fetch. The legacy path handles the pre-hydrate window.
  if (!state.convsHydratedAt) return;
  const cur = state.convs[conv];
  if (type === 'conv.created' || type === 'conv.meta_updated') {
    const merged: ChatConvSummary = {
      conv,
      agent_type: typeof ev.agent_type === 'string' ? ev.agent_type : (cur?.agent_type ?? null),
      agent_id: typeof ev.agent_id === 'string' ? ev.agent_id : (cur?.agent_id ?? null),
      parent_conv: typeof ev.parent_conv === 'string' ? ev.parent_conv : (cur?.parent_conv ?? null),
      initiative_id: typeof ev.initiative_id === 'string' ? ev.initiative_id : (cur?.initiative_id ?? null),
      task_id: typeof ev.task_id === 'string' ? ev.task_id : (cur?.task_id ?? null),
      archived: cur?.archived ?? false,
      archived_at: cur?.archived_at ?? null,
      archived_by: cur?.archived_by ?? null,
      live: cur?.live ?? false,
      coordinating: cur?.coordinating ?? false,
      waiting_on: cur?.waiting_on ?? [],
      created_at: cur?.created_at ?? (typeof ev.ts === 'string' ? ev.ts : ''),
      last_activity_at: typeof ev.ts === 'string' ? ev.ts : (cur?.last_activity_at ?? ''),
      msg_count: cur?.msg_count ?? 0,
    };
    setState('convs', conv, merged);
    return;
  }
  if (type === 'conv.archived') {
    setState('convs', conv, (prev) => ({
      ...(prev ?? ({} as ChatConvSummary)),
      archived: true,
      archived_at: typeof ev.archived_at === 'string' ? ev.archived_at : (typeof ev.ts === 'string' ? ev.ts : null),
      archived_by: typeof ev.by === 'string' ? ev.by : null,
    }));
    setState('archivedConvs', conv, true);
    saveArchivedConvs();
    return;
  }
  if (type === 'conv.unarchived') {
    setState('convs', conv, (prev) => ({
      ...(prev ?? ({} as ChatConvSummary)),
      archived: false,
      archived_at: null,
      archived_by: null,
    }));
    setState('archivedConvs', (prev) => {
      const next = { ...prev };
      delete next[conv];
      return next;
    });
    saveArchivedConvs();
    return;
  }
  // LAL4 (py-1.13.0 daemon-side) — anchor protocol events. The daemon
  // parses `⟦anchor⟧ {...}` markers from agent output and emits these
  // structured events so the cockpit can light up the right roadmap
  // row in real time without a /state poll.
  if (type === 'conv.anchored') {
    setState('convs', conv, (prev) => ({
      ...(prev ?? ({} as ChatConvSummary)),
      conv,
      initiative_id: typeof ev.initiative_id === 'string' ? ev.initiative_id : (prev?.initiative_id ?? null),
      task_id: typeof ev.task_id === 'string' ? ev.task_id : (prev?.task_id ?? null),
      last_activity_at: typeof ev.ts === 'string' ? ev.ts : (prev?.last_activity_at ?? ''),
      archived: prev?.archived ?? false,
      archived_at: prev?.archived_at ?? null,
      archived_by: prev?.archived_by ?? null,
      created_at: prev?.created_at ?? (typeof ev.ts === 'string' ? ev.ts : ''),
      msg_count: prev?.msg_count ?? 0,
      live: prev?.live ?? false,
      coordinating: prev?.coordinating ?? false,
      waiting_on: prev?.waiting_on ?? [],
      agent_type: prev?.agent_type ?? null,
      agent_id: prev?.agent_id ?? null,
      parent_conv: prev?.parent_conv ?? null,
    }));
    // Mark recently-created so LAL5's ✨ NEW badge + flash highlight
    // can fire. TTL is enforced inside viewStore (10 s default).
    // The daemon also calls state_manager.rebuild() after writing the
    // files, so allInitiatives() + allTasks() will pick them up via
    // the existing state.rebuilt event — no explicit serverStore
    // refresh needed here.
    if (ev.is_new_init && typeof ev.initiative_id === 'string') {
      viewStore.markRecentlyCreatedInit(ev.initiative_id);
    }
    if (ev.is_new_task && typeof ev.task_id === 'string') {
      viewStore.markRecentlyCreatedTask(ev.task_id);
    }
    return;
  }
  if (type === 'conv.anchor_rejected') {
    const reason = typeof ev.reason === 'string' ? ev.reason : 'anchor rejected';
    const currentList = state.convMap[conv] ?? [];
    setState('convMap', conv, [
      ...currentList,
      {
        kind: 'system',
        system_kind: 'warn',
        text: `Anchor rejected: ${reason}`,
        ts: typeof ev.ts === 'string' ? ev.ts : new Date().toISOString(),
      },
    ]);
    return;
  }
  if (type === 'conv.anchor_missing') {
    // No bubble; the agent simply skipped the marker. The cockpit
    // could dim a "no anchor" affordance per-turn — for now just log.
    log.info('agent skipped anchor for conv', conv);
    return;
  }
  if (type === 'chat.usage') {
    // CU1 (daemon py-1.13.3) — token usage + cost broadcast after
    // every chat.assistant.final. `total` is the daemon's cumulative
    // dict per-conv; we mirror it onto `convs[conv].usage` so the
    // ChatScopeStrip chip updates instantly. `turn` (per-turn delta)
    // and `model` are available on the event but not stored — they're
    // useful for telemetry / future per-turn breakdown.
    const total = (ev as { total?: ChatUsageTotal }).total;
    if (total && typeof total === 'object') {
      setState('convs', conv, (prev) => ({
        ...(prev ?? ({} as ChatConvSummary)),
        conv,
        usage: total,
      }));
    }
    return;
  }
  if (type === 'conv.task_completed') {
    const taskId = typeof ev.task_id === 'string' ? ev.task_id : null;
    if (!taskId) return;
    // Clear the conv's task_id so LAL5's pulse on that task stops
    // immediately. If the agent emits a fresh ⟦anchor⟧ for the next
    // task, conv.anchored will set it again. The daemon also rebuilds
    // state after writing status:done — allTasks() picks up the new
    // status via the existing state.rebuilt event flow.
    setState('convs', conv, (prev) => ({
      ...(prev ?? ({} as ChatConvSummary)),
      task_id: null,
    }));
    return;
  }
  if (type === 'conv.activity') {
    setState('convs', conv, (prev) => ({
      ...(prev ?? ({} as ChatConvSummary)),
      conv,
      agent_type: typeof ev.agent_type === 'string' ? ev.agent_type : (prev?.agent_type ?? null),
      agent_id: typeof ev.agent_id === 'string' ? ev.agent_id : (prev?.agent_id ?? null),
      parent_conv: typeof ev.parent_conv === 'string' ? ev.parent_conv : (prev?.parent_conv ?? null),
      initiative_id: typeof ev.initiative_id === 'string' ? ev.initiative_id : (prev?.initiative_id ?? null),
      task_id: typeof ev.task_id === 'string' ? ev.task_id : (prev?.task_id ?? null),
      live: ev.live === true,
      coordinating: ev.coordinating === true,
      waiting_on: Array.isArray(ev.waiting_on) ? (ev.waiting_on as string[]) : [],
      last_activity_at: typeof ev.ts === 'string' ? ev.ts : (prev?.last_activity_at ?? ''),
      archived: prev?.archived ?? false,
      archived_at: prev?.archived_at ?? null,
      archived_by: prev?.archived_by ?? null,
      created_at: prev?.created_at ?? (typeof ev.ts === 'string' ? ev.ts : ''),
      msg_count: prev?.msg_count ?? 0,
    }));
    // Keep `clusterActivity.workingConvs` in lockstep with `conv.live`
    // so the project rail reflects daemon state immediately — not only
    // after the first assistant.delta lands. Pair of [[hydrateFromSnapshot]]
    // which seeds the set on cluster bind.
    const activeId2 = activeClusterId();
    const isLive = ev.live === true || ev.coordinating === true;
    if (activeId2) {
      setState('clusterActivity', activeId2, (prev) => {
        const working = new Set(prev?.workingConvs ?? []);
        if (isLive) working.add(conv);
        else working.delete(conv);
        return {
          lastEventAt: Date.now(),
          lastReadAt: prev?.lastReadAt ?? 0,
          workingConvs: [...working],
        };
      });
    }
  }
}

// V107.41 — Standard v16 chat-turn queue. WS event ingest.
function ingestQueueEvent(ev: DaemonEvent): void {
  const type = ev.type;
  const conv = typeof ev.conv === 'string' ? ev.conv : '';
  if (!conv) return;
  const itemEv = (ev as { item?: ChatQueueItem }).item ?? null;
  const list = state.queues[conv] ?? [];
  if (type === 'queue.item.added') {
    if (!itemEv) return;
    // Dedup by id; preserve insertion order by `position`.
    const merged = list.filter((it) => it.id !== itemEv.id).concat(itemEv);
    merged.sort((a, b) => a.position - b.position);
    setState('queues', conv, merged);
    return;
  }
  if (type === 'queue.item.updated') {
    if (!itemEv) return;
    // Apply the update; if positions shifted, the daemon already
    // re-packed them — replace the whole list.
    const merged = list.map((it) => it.id === itemEv.id ? itemEv : it);
    merged.sort((a, b) => a.position - b.position);
    setState('queues', conv, merged);
    return;
  }
  if (type === 'queue.item.removed' || type === 'queue.item.sent') {
    const id = itemEv?.id;
    if (!id) return;
    const pruned = list.filter((it) => it.id !== id);
    setState('queues', conv, pruned);
    return;
  }
}

/** V107.41 — Hydrate one conv's queue from the daemon. Called by the
 *  composer the first time it focuses a conv (lazy fetch — most convs
 *  have no queue, so we skip the round trip unless the user is about
 *  to interact with one). */
async function hydrateQueue(client: DaemonClient, conv: string): Promise<void> {
  try {
    const res = await client.queueList(conv);
    if (res.ok) {
      setState('queues', conv, res.data.items ?? []);
    }
  } catch (e) {
    log.warn('queue hydrate failed', conv, e instanceof Error ? e.message : String(e));
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
  findActiveArchitectConv,
  ingestEvent,
  ingestEventForCluster,
  dispatchMessage,
  // py-1.11.0 — chat-state-rearchitecture (daemon-authoritative path).
  hydrateFromSnapshot,
  ingestConvEvent,
  loadConvMessagesPage,
  loadEarlierMessages,
  // V107.41 — chat-turn queue (Standard v16).
  ingestQueueEvent,
  hydrateQueue,
};

log.debug('state/chat loaded');
