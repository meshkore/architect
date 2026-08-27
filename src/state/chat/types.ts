/**
 * state/chat/types.ts — the chat layer's shapes and constants.
 *
 * No store, no side effects: every other module in the package may
 * import this one, and nothing here may import them back.
 */

import type { ChatConvSummary, ChatQueueItem } from '~/lib/daemon-client';
import type { ChatAttachment } from '~/lib/chat-sanitize';

export type { ChatAttachment };

export const ONBOARDING_CONV_ID = '_onboarding_v1';

/** The two fixed/system agents present in every project: the Architect
 *  Agent (`_onboarding_v1`, the planner) and the live Roadmap Architect
 *  conv (`roadmap-architect-*`, the queue executor). Neither can be
 *  archived, reordered, or removed from the rail's pinned head — see
 *  ChatRail's head/body split and AgentCard's draggable guard. */
export function isFixedAgentConv(conv: string | null | undefined): boolean {
  return conv === ONBOARDING_CONV_ID || !!(conv && conv.startsWith('roadmap-architect-'));
}

export type AgentType =
  | 'custom' | 'deploy' | 'db' | 'testing' | 'audit' | 'docs' | 'review' | 'roadmap-architect';

export interface ConvMeta {
  agentId: string;
  model: string;
  /** MP3 (2026-06-12) — reasoning-depth dial → claude-code `--effort`.
   *  'default' / undefined = no flag. */
  effort?: string;
  /** DM-CLI-02 (multi-cli-clients) — which CLI dispatches this conv's
   *  turns. undefined/'claude-code' = the default. */
  client?: string;
  type: AgentType;
  title: string;
  /** agent-team (ATM7/ATM10) — the roster member this conv is bound to
   *  (`developer`, `api-developer`, …). Set at creation from the picker
   *  and frozen after the first dispatch. Passed as `member` on every
   *  dispatch so the daemon loads that member's init prompt + refs. */
  member?: string;
  location: { type: 'local' | 'remote'; host?: string; provider?: string };
}

/** py-1.11.0 — Status kind used by the rail's `AgentCard` prop. */
export type AgentStatusKind = 'idle' | 'thinking' | 'working';

export interface ChatMsg {
  /**
   * 'user'      — operator-typed message (and its echoes from the daemon).
   * 'assistant' — agent reply (deltas + final).
   * 'system'    — CLIENT-ONLY notice. Surfaces dispatch errors and other
   *               in-band warnings in the thread instead of the console.
   *               Never broadcast over WS, never persisted by the daemon.
   */
  kind: 'user' | 'assistant' | 'system';
  text: string;
  author?: string;
  ts?: string;
  streaming?: boolean;
  stream_id?: string;
  cancelled?: boolean;
  /** Severity styling for client-side 'system' messages. */
  system_kind?: 'error' | 'warning' | 'info';
  /** py-1.12.21 — attachments persisted by the daemon. Each entry's
   *  `url` resolves to `GET /chat/uploads/<bucket>/<file>`. Emitted
   *  only for `kind: 'user'` events whose dispatch carried images/docs. */
  attachments?: ChatAttachment[];
  _placeholder_user?: boolean;
  _placeholder?: boolean;
}

/** MP5 — per-cluster activity indicators surfaced on the projects rail.
 *  Tracked GLOBALLY (across all clusters), not swapped on bindCluster,
 *  because we want to know "B is working" while we're on A. */
export interface ClusterActivity {
  /** Wall-clock ts of the last event received on this cluster's WS. */
  lastEventAt: number;
  /** Wall-clock ts when the cockpit last bound to this cluster. */
  lastReadAt: number;
  /** Convs currently streaming an assistant reply on this cluster. */
  workingConvs: string[];
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

export interface ChatStoreState {
  convMap: Record<string, ChatMsg[]>;
  activeConv: string | null;
  archivedConvs: Record<string, true>;
  convMeta: Record<string, ConvMeta>;
  convTitleOverrides: Record<string, string>;
  /** MP5 — global per-cluster activity. NOT swapped on bindCluster. */
  clusterActivity: Record<string, ClusterActivity>;
  /** V86p — convs the operator just dispatched into, awaiting the first
   *  assistant chunk over WS. Carries the dispatch timestamp so the UI
   *  can show "preparing… Ns elapsed". Cleared on the first
   *  delta / final / cancelled. */
  pendingReplyConvs: Record<string, number>;
  /** V89.2 — wall-clock ts of the most recent `chat.assistant.delta`
   *  per conv, so the streaming bubble can tell when the agent has been
   *  quiet "too long" (>~1.5 s). Cleared on final/cancelled. */
  lastDeltaTsByConv: Record<string, number>;
  /** py-1.11.0 — daemon-authoritative conv summaries from
   *  `GET /chat/snapshot` + WS conv.* events. When populated this is the
   *  single source of truth for the rail list AND for "is this conv live
   *  / coordinating / waiting on who". Empty `{}` when the daemon lacks
   *  `chat.snapshot.v1`. */
  convs: Record<string, ChatConvSummary>;
  /** ISO ts of the last full snapshot hydration. Null before the first
   *  hydration of a cluster the cockpit has never seen this session. */
  convsHydratedAt: string | null;
  /** AX3 — `convs`/`convsHydratedAt` were restored from the in-memory
   *  cluster cache on switch-back and have NOT been revalidated yet.
   *  The workspace paints from them immediately (that is the point) but
   *  surfaces a "refreshing…" marker; `hydrateFromSnapshot` clears the
   *  flag, and fresh daemon data always wins over the cached copy. */
  convsStale: boolean;
  /** V107.41 — Standard v16 chat-turn queue. Per-conv list of items
   *  waiting to be dispatched. Daemon-authoritative. */
  queues: Record<string, ChatQueueItem[]>;
  /** 2026-06-12 — per-conv pagination cursor for the windowed history
   *  loader. Storage keeps everything; we just don't paint past the cap. */
  paging: Record<string, ChatPaging>;
}

/** The per-cluster chat slice cached in memory across a project switch.
 *  AX3 added `convs`/`convsHydratedAt` so switch-back paints instantly
 *  instead of blocking on two serial round-trips. */
export interface ClusterChatSlice {
  convMap: Record<string, ChatMsg[]>;
  activeConv: string | null;
  archivedConvs: Record<string, true>;
  convMeta: Record<string, ConvMeta>;
  convTitleOverrides: Record<string, string>;
  convs: Record<string, ChatConvSummary>;
  convsHydratedAt: string | null;
}

export const initialChatState: ChatStoreState = {
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
  convsStale: false,
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
//                    history; the operator just can't scroll past it.
export const INITIAL_PAGE = 20;
export const PAGE = 20;
export const UI_MESSAGE_CAP = 100;

/**
 * V107.8 — Infer agent_type from the conv slug pattern.
 *
 * The slug is the unforgeable signal of intent — every other channel
 * (meta.type in localStorage, body.agent_type in the dispatch, the
 * daemon's conv_meta sidecar) can drift out of sync. Sister of the
 * daemon's `_agent_type_from_conv_slug` (py-1.10.12).
 */
const SLUG_TYPE_PREFIXES: ReadonlyArray<readonly [string, AgentType]> = [
  ['roadmap-architect-', 'roadmap-architect'],
  ['deploy-', 'deploy'],
  ['db-', 'db'],
  ['testing-', 'testing'],
  ['audit-', 'audit'],
  ['docs-', 'docs'],
  ['review-', 'review'],
];

export function agentTypeFromSlug(conv: string): AgentType | null {
  if (!conv) return null;
  for (const [prefix, implied] of SLUG_TYPE_PREFIXES) {
    if (conv.startsWith(prefix)) return implied;
  }
  return null;
}

/** Agent types whose chat renders as one continuous autonomous run. */
export const AUTONOMOUS_AGENT_TYPES: ReadonlySet<AgentType> = new Set<AgentType>(['roadmap-architect']);

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
