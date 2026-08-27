/**
 * types/chat.ts — conversation surface: dispatch, the py-1.11.0 snapshot
 * API (chat-state-rearchitecture) and the Standard v16 turn queue.
 */

import type { DaemonEvent } from './system';

export interface DispatchResponse {
  conv: string;
  runner: string;
  identity: string;
  pid: number;
  stream_id: string;
  agent_type?: string;
}

export interface DispatchBody {
  conv?: string;
  author?: string;
  text: string;
  agent_type?: string;
  agent_id?: string;
  /** agent-team (ATM10) — the roster member this turn is bound to
   *  (`developer`, `api-developer`, …). The daemon loads that member's
   *  init prompt + refs on turn 1 and stamps conv_meta so chained turns
   *  keep the identity. `model` / `effort` in this body still override
   *  the member's defaults on ANY turn. */
  member?: string;
  /** MP1 (daemon py-1.13.3) — per-conv model. `auto` / empty = let
   *  claude-code pick; otherwise one of `opus` / `sonnet` / `haiku`
   *  (or an explicit model id like `claude-opus-4-7`). */
  model?: string;
  /** MP3 (daemon py-1.14.2) — reasoning depth → `--effort`.
   *  low|medium|high|xhigh|max; `default`/empty = no flag. */
  effort?: string;
  module_id?: string;
  task_id?: string;
  initiative_id?: string;
  context_docs?: Array<{ filename: string; content: string }>;
  images?: Array<{ type: 'image'; media_type: string; data: string }>;
}

// V107.41 — Standard v16 chat-turn queue. Per-conv FIFO with auto-flush
// (daemon py-1.12.12+). The cockpit consumes:
//   GET    /chat/conv/<conv>/queue                       → list
//   POST   /chat/conv/<conv>/queue           { text }    → enqueue
//   POST   /chat/conv/<conv>/queue/<id>/edit { text }    → edit
//   POST   /chat/conv/<conv>/queue/<id>/move { position }→ reorder
//   POST   /chat/conv/<conv>/queue/<id>/promote          → flush this now
//   DELETE /chat/conv/<conv>/queue/<id>                  → remove
// WS events: queue.item.added | updated | removed | sent (each carries
// { conv, item }).
export type QueueItemStatus = 'queued' | 'sending' | 'sent' | 'failed' | 'cancelled';
export interface ChatQueueItem {
  id: string;
  text: string;
  created_at: string;
  position: number;
  status: QueueItemStatus;
  sent_at?: string;
  failed_reason?: string;
}
export interface ChatQueueResponse {
  conv: string;
  version: number;
  items: ChatQueueItem[];
}

export interface ChatUsageTotal {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
  cost_usd: number;
  turns: number;
}

/** CTX1 (daemon py-1.28.0) — per-turn context-window fill, carried on the
 *  `chat.usage` event. The daemon resolves a per-PLATFORM policy: claude-code
 *  knows its window + self-compacts; an unmodelled runtime sends window=null
 *  (→ no gauge). `fill_ratio` is prompt_tokens / window in [0,1] (null when the
 *  window is unknown). `should_compact` flips at `threshold` (0.5). */
export interface ChatContextBlock {
  platform: string;
  window: number | null;
  prompt_tokens: number;
  fill_ratio: number | null;
  supports_compaction: boolean;
  threshold: number | null;
  should_compact: boolean;
}

// ─── py-1.11.0: chat-state-rearchitecture. Canonical conv list +
//     paginated message reads + consolidated boot snapshot. Cockpit uses
//     these when `chat.snapshot.v1` is in `health.features`; older
//     daemons keep the legacy /state + /chat/archives path. ────────────

export interface ChatConvSummary {
  conv: string;
  agent_type: string | null;
  agent_id: string | null;
  parent_conv: string | null;
  initiative_id: string | null;
  task_id: string | null;
  /** MP1 (daemon py-1.13.3) — per-conv model preference. `null` for
   *  legacy convs OR explicit `auto` → claude-code default. */
  model?: string | null;
  /** MP3 (daemon py-1.14.2) — per-conv effort (reasoning depth).
   *  `null`/`default` → no `--effort` flag. */
  effort?: string | null;
  /** DM-CLI-02 (daemon, multi-cli-clients) — per-conv CLI-client
   *  preference. `null` → claude-code. */
  client?: string | null;
  /** multi-provider-agents (MPV1) — the LLM backend the claude-code
   *  client talks to. `null`/'anthropic' → native. */
  provider?: string | null;
  /** agent-team (ATM10) — the roster member this conv is bound to.
   *  `null` for convs not created from/bound to a team profile. */
  member?: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  live: boolean;
  coordinating: boolean;
  waiting_on: string[];
  created_at: string;
  last_activity_at: string;
  msg_count: number;
  /** CU1 (daemon py-1.13.3) — cumulative token usage + cost for this
   *  conv. Absent until the first turn finalises. Resets on daemon
   *  restart. */
  usage?: ChatUsageTotal;
  /** CTX1 (daemon py-1.28.0) — last turn's context-window fill. Absent until
   *  the first turn finalises, or when the runtime has no known window. */
  context?: ChatContextBlock;
}

export interface ChatSnapshotResponse {
  convs: ChatConvSummary[];
  paused_agent_types: Record<string, unknown>;
  quota: Record<string, unknown>;
  debug: { enabled: boolean };
  version: string;
  generated_at: string;
}

export interface ChatConvsResponse {
  convs: ChatConvSummary[];
  generated_at: string;
}

export interface ChatConvMetaResponse {
  conv: string;
  agent_type: string | null;
  agent_id: string | null;
  parent_conv: string | null;
  initiative_id: string | null;
  task_id: string | null;
  archived: boolean;
  live: boolean;
  created_at: string;
  last_activity_at: string;
  msg_count: number;
}

export interface ChatConvMessagesResponse {
  conv: string;
  messages: DaemonEvent[];
  count: number;
  has_more: boolean;
  oldest_ts: string;
}
