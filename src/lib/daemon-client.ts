/**
 * daemon-client.ts — typed HTTP wrapper over the meshcore daemon REST
 * surface.
 *
 * The cockpit hits the daemon for every state read / mutation. This
 * module is the single source of truth for the request shapes and
 * response types. Higher-level state stores (M2) wrap it; components
 * (M3+) never call fetch directly.
 *
 * Usage:
 *   const client = new DaemonClient(localTransport(5570, token));
 *   const h = await client.health();
 *   if (h.ok) log.info('daemon ready', h.data.identity, h.daemonVersion);
 *
 * All methods return `Result<T>` (a discriminated union):
 *   - { ok: true, data, status, daemonVersion? }   on 2xx
 *   - { ok: false, status, body }                  on non-2xx or network error
 *
 * No exceptions thrown for ordinary HTTP errors — callers branch on
 * `result.ok`. Exceptions only escape for programmer errors (e.g.
 * passing a malformed URL).
 *
 * AbortSignal is accepted on every method so the operator can cancel
 * an in-flight request when navigating away or switching cluster.
 *
 * The daemon version header (`x-meshkore-daemon-version`) is surfaced
 * on the result for callers that need it (health check, version gate).
 */

import type { TransportConfig } from './transport';
import { log } from './log';

// ─── Result type ────────────────────────────────────────────────────

export type Result<T> =
  | { ok: true; data: T; status: number; daemonVersion?: string }
  | { ok: false; status: number; body: string; error?: string };

// ─── Response shapes ────────────────────────────────────────────────

/** Standard v22 `GET /storage/usage` response. */
export interface StorageBucket {
  name: string;
  bytes: number;
  files: number;
  exists: boolean;
  retention_days?: number;
}
export interface StorageUsageResponse {
  root: string;
  total_bytes: number;
  total_files: number;
  buckets: StorageBucket[];
  generated_at: string;
  cache_ttl_secs: number;
}

export interface HealthResponse {
  ok: boolean;
  identity: string;
  port: number;
  mode: string;
  implementation?: string;
  version?: string;
  cluster_id?: string;
  cluster_name?: string;
  cluster_type?: string;
  device?: { hostname: string; platform: string; arch: string; os_release: string };
  features?: string[];
  /** D-TLS-01 — scheme advertised by daemon (py-1.8.0+). */
  tls?: boolean;
  /** D-TLS-01 — full URL the cockpit should target. */
  endpoint?: string;
  /** py-1.2.0 — cluster.yaml.daemon block. Drives the auto-update flow. */
  daemon?: {
    auto_update?: boolean;
    auto_update_source?: string;
  };
  ts?: string;
}

// py-1.11.3 — Credentials CRUD wire shapes. Listing returns names +
// metadata only (never values). credentialRead returns the value with
// `protected: true` for daemon-managed entries (portal-token).
export interface CredentialListEntry {
  name: string;
  size: number | null;
  is_symlink: boolean;
  protected: boolean;
}
export type CredentialsListResponse = CredentialListEntry[];

export interface CredentialReadResponse {
  name: string;
  value: string;
  protected: boolean;
}

export interface InfoResponse {
  ok: boolean;
  root: string;
  cluster_id?: string;
  cluster_name?: string;
  port: number;
  pid: number;
  [k: string]: unknown;
}

export interface DaemonEvent {
  type: string;
  ts?: string;
  conv?: string;
  author?: string;
  [k: string]: unknown;
}

export interface DispatchResponse {
  conv: string;
  runner: string;
  identity: string;
  pid: number;
  stream_id: string;
  agent_type?: string;
}

export interface SelfUpdateResponse {
  ok: boolean;
  new_pid: number;
  new_port: number;
  shutdown_in_sec: number;
  old_backup: string;
  old_version: string;
  source_url: string;
}

export interface CronJob {
  id: string;
  name: string;
  schedule: string;
  cmd: string;
  cwd?: string | null;
  env?: Record<string, string>;
  enabled: boolean;
  max_runtime_sec: number;
  restart_policy: 'never' | 'on-failure' | 'always';
  retention_runs: number;
  destructive: boolean;
  next_run: string;
  running: boolean;
}

export interface CronListResponse {
  jobs: CronJob[];
  coordinator: boolean;
  owner: string | null;
  identity: string;
  tick_sec: number;
}

export interface CronTriggerResponse {
  id: string;
  started_at: string;
  pid: number;
  log_path: string;
  status: string;
}

export interface LogEntry {
  name: string;
  date: string | null;
  size: number | null;
  mtime: string | null;
}
export interface LogListResponse {
  entries: LogEntry[];
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

// V107.34 — Standard v14 project context tree, served by the daemon's
// /context endpoint (py-1.12.10+).
export interface ContextNode {
  kind: 'file' | 'dir';
  name: string;
  path: string;
  title: string;
  updated?: string;
  status?: string;
  words?: number;
  over_cap?: boolean;
  children?: ContextNode[];
}
export interface ContextTreeResponse {
  exists: boolean;
  root: string;
  total_words: number;
  token_estimate: number;
  budget_tokens: number;
  over_budget: boolean;
  warnings: string[];
  tree: ContextNode[];
}

// knowledge-tree-unified KT3 — the unified knowledge tree, served by the
// daemon's /knowledge endpoint (py-1.24.0+). A conceptual overlay over
// context/+docs/+modules/ defined in context/_index.yaml. Each node is a
// CONCEPT (never a filename); load policy decides what the agent gets at
// spawn (pinned = full body, skeleton = map line only, on-demand = fetched).
export type KnowledgeLoad = 'pinned' | 'skeleton' | 'on-demand';
export interface KnowledgeNode {
  id: string;
  title: string;
  desc: string;
  load: KnowledgeLoad;
  words: number;
  has_body: boolean;
  src?: string;
  updated?: string;
  feeds?: string;
  children: KnowledgeNode[];
}
export interface KnowledgeTreeResponse {
  exists: boolean;
  root: string;
  version?: number;
  spawn_tokens: number;
  skeleton_tokens?: number;
  pinned_tokens?: number;
  budget_tokens: number;
  over_budget: boolean;
  warnings: string[];
  tree: KnowledgeNode[];
}
export interface KnowledgeNodeBody {
  id: string;
  title: string;
  desc: string;
  has_body: boolean;
  body?: string | null;
  src?: string;
  error?: string;
}


export interface InitiativeActivityCommit {
  repo?: string;
  sha: string;
  short_sha: string;
  ts: string;
  author: string;
  subject: string;
  files: string[];
  files_truncated?: boolean;
}
export interface InitiativeActivity {
  initiative_id: string;
  commits: InitiativeActivityCommit[];
  generated_at: string;
  error?: string;
}

// py-1.10.0 — RunStore endpoints.
export type RunStatus = 'running' | 'stopping' | 'cancelled' | 'done' | 'failed';

export interface RunRecord {
  id: string;
  initiative_id: string;
  initiative_title: string;
  conv: string;
  agent_id: string;
  agent_title: string;
  task_ids: string[];
  cursor: number;
  status: RunStatus;
  started_at: string;
  last_step_at: string;
  ended_at: string | null;
  stream_id: string | null;
  error: string | null;
  /** Derived server-side: is there a live chat session for the conv right
   *  now? `false` while between steps OR after the daemon restarts. */
  live: boolean;
}

export interface RunsList { runs: RunRecord[]; count: number }
export interface RunStartBody {
  initiative_id: string;
  initiative_title: string;
  conv: string;
  agent_id: string;
  agent_title: string;
  task_ids: string[];
}

export interface LinksLocal {
  url?: string;
  command?: string;
  health?: string;
}
export interface LinksProd {
  url?: string;
  provider?: string;
  project?: string;
  region?: string;
  deploy_command?: string;
  deployed_version?: string;
  deployed_sha?: string;
  deployed_at?: string;
  deployed_by?: string;
}
export interface LinksRepo {
  branch?: string;
  head_sha?: string;
}
export interface LinksModule {
  id: string;
  local?: LinksLocal;
  prod?: LinksProd;
  repo?: LinksRepo;
}
export interface LinksRegistry {
  version?: number;
  modules: LinksModule[];
}

export interface ProtocolSummary {
  id: string;
  title: string;
  scope?: string;
  status?: string;
  priority?: string;
  owner?: string;
  updated?: string;
  tags?: string[];
  file?: string;
  log_count?: number;
}
export interface ProtocolListResponse {
  protocols: ProtocolSummary[];
}
export interface ProtocolDetail {
  id: string;
  title: string;
  frontmatter: Record<string, unknown>;
  body: string;
  file?: string;
}

// ─── py-1.11.0: chat-state-rearchitecture (initiative
//     `chat-state-rearchitecture`). Canonical conv list + paginated
//     message reads + consolidated boot snapshot. Cockpit uses these
//     when `chat.snapshot.v1` is in `health.features`; older daemons
//     keep the legacy /state + /chat/archives path. ────────────────

/** py-1.28.3 — live-task overlay row from GET /roadmap/live. */
export interface LiveTaskEntry {
  conv: string;
  task_id: string;
  initiative_id: string | null;
  agent_id: string | null;
}
export interface LiveTasksResponse {
  tasks: LiveTaskEntry[];
  ts: string;
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

export interface TaskCreateBody {
  id?: string;
  title: string;
  module?: string;
  status?: string;
  initiative?: string;
  body?: string;
  [k: string]: unknown;
}

// ─── agent-team (ATM9 daemon contract) ──────────────────────────────
//
// The team roster is a set of member profiles under `.meshkore/team/`.
// Each member is a markdown file: frontmatter (identity + defaults) +
// an init-prompt body. The daemon serves them at /team; the cockpit's
// teamStore (state/team.ts) mirrors the list and lazy-loads bodies.
//
//   GET    /team           → TeamMember[] (frontmatter + instances count),
//                            sorted by pinned_order
//   GET    /team/<id>      → TeamMemberDetail (frontmatter + body)
//   POST   /team           → create (always kind:'profile'; model required)
//   PATCH  /team/<id>      → partial update (kind & required immutable)
//   DELETE /team/<id>      → 409 when required:true
//   POST   /team/draft     → LLM normaliser: free text → structured draft
//
// WS events team.created | team.updated | team.deleted { id, ts }.

export type TeamMemberKind = 'singleton' | 'profile';

/** One roster member's frontmatter + live instance count. */
export interface TeamMember {
  id: string;
  name: string;
  emoji: string;
  color?: string;
  kind: TeamMemberKind;
  required: boolean;
  agent_type?: string;
  /** Default model for instances of this member (required by the schema). */
  model: string;
  effort?: string;
  pinned_order?: number;
  refs?: string[];
  credentials_hint?: string;
  created?: string;
  updated?: string;
  /** Non-archived live convs currently bound to this member (from GET /team). */
  instances?: number;
}

/** Full member incl. the init-prompt markdown body (GET /team/<id>). */
export interface TeamMemberDetail extends TeamMember {
  body: string;
}

/** POST /team — the final shape the operator confirms in the dialog.
 *  `kind` is always `profile` for operator-created members; the daemon
 *  rejects anything else. `model` is mandatory (no auto). */
export interface TeamCreateBody {
  name: string;
  emoji: string;
  model: string;
  effort?: string;
  kind?: 'profile';
  refs?: string[];
  /** The init-prompt markdown body. */
  prompt: string;
  color?: string;
}

/** PATCH /team/<id> — only the editable fields. `kind`/`required` are
 *  immutable (daemon rejects them). Each caller sends only the section
 *  it edited (ATM6 per-section save). */
export interface TeamPatchBody {
  name?: string;
  emoji?: string;
  color?: string;
  model?: string;
  effort?: string;
  refs?: string[];
  prompt?: string;
}

/** POST /team/draft — LLM normaliser input + output. */
export interface TeamDraftBody {
  name: string;
  emoji: string;
  raw_text: string;
}
export interface TeamDraftResponse {
  id?: string;
  name: string;
  emoji: string;
  model: string;
  effort: string;
  kind?: string;
  refs: string[];
  prompt: string;
}

// ─── Client ─────────────────────────────────────────────────────────

/**
 * V94 — Global listener for daemon-version-header changes. Every
 * successful HTTP response from any DaemonClient invokes this hook
 * after parsing the `x-meshkore-daemon-version` header. daemonStore
 * registers a listener to update the active instance's recorded
 * version and re-compute `outdated` / `ahead` reactively — so a
 * daemon self-update that bumps the version while the cockpit is
 * mid-session lands as a UI signal (refresh banner / outdated
 * lock) within one round-trip instead of waiting for a reconnect.
 *
 * Process-wide singleton (not per-client) because the cockpit
 * inspects WHICH instance the response came from via the
 * `transport.httpBase` URL inside the listener.
 */
type DaemonVersionListener = (httpBase: string, version: string) => void;
let daemonVersionListener: DaemonVersionListener | null = null;
export function setDaemonVersionListener(fn: DaemonVersionListener | null): void {
  daemonVersionListener = fn;
}

/** FC-2 (daemon-centralized) — 401 self-heal. ANY authed request that comes
 *  back 401 (a stale per-cluster token — common after the per-daemon→central
 *  daemon migration, where the old per-project token was cached under the
 *  cluster key) calls this handler to re-fetch the daemon's CURRENT local token
 *  for that httpBase. If it returns a fresh token, request() updates the
 *  transport and retries ONCE — so a stale token recovers silently instead of
 *  bricking a chat dispatch with "Unauthorized — re-unlock". Returns null when
 *  it can't auto-acquire (remote daemon / opt-out) → the 401 surfaces normally.
 *  Wired from state/daemon.ts (which owns fetchLocalToken + the token store). */
type ReauthHandler = (httpBase: string) => Promise<string | null>;
let reauthHandler: ReauthHandler | null = null;
export function setReauthHandler(fn: ReauthHandler | null): void {
  reauthHandler = fn;
}

/** V107.26 — Map a cluster-relative `.meshkore/<area>/...` path into
 *  the static-file route the daemon actually exposes. See readMarkdownFile
 *  for context. Returns the input untouched if no rule matches (caller
 *  hits the daemon's default 404 for unknown routes, same as before).
 *  Exported for tests / other call sites that need the same translation. */
export function rewriteMeshkoreStaticPath(rel: string): string {
  // Tolerate both `.meshkore/x/y` and bare `x/y` (some path fields
  // arrive without the `.meshkore/` prefix). Match on the area name.
  const stripped = rel.replace(/^\.meshkore\//, '');
  // `.meshkore/roadmap/...` → `/tasks/...` (the daemon's route is
  // historically named after tasks even though it serves the whole
  // roadmap subtree, including `initiatives/`, `log/`, etc.).
  if (stripped.startsWith('roadmap/')) return 'tasks/' + stripped.slice('roadmap/'.length);
  // The other two areas keep their name.
  if (stripped.startsWith('docs/')) return stripped;
  if (stripped.startsWith('modules/')) return stripped;
  // `.meshkore/log/<file>` is served by a dedicated /log/<file> route
  // (daemon.py: see `if p == "/log"` / `if p.startswith("/log/")`).
  if (stripped.startsWith('log/')) return stripped;
  // Unknown area — leave as-is so the 404 surfaces in the original
  // route shape; helps diagnosis vs silently rewriting to something
  // the daemon also doesn't serve.
  return rel;
}

export class DaemonClient {
  constructor(public readonly transport: TransportConfig) {}

  // ── Read endpoints ────────────────────────────────────────────────

  async health(signal?: AbortSignal): Promise<Result<HealthResponse>> {
    return this.request<HealthResponse>('GET', '/health', undefined, signal, /*requireAuth*/ false);
  }

  async state(signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', '/state', undefined, signal);
  }

  /** py-1.28.3 — tiny live-task overlay (which task each live subagent works on
   *  RIGHT NOW). Polled (~2.5s) so the roadmap loader is reliable even if a
   *  conv.* WS event was missed (reconnect / project switch). */
  async liveTasks(signal?: AbortSignal): Promise<Result<LiveTasksResponse>> {
    return this.request<LiveTasksResponse>('GET', '/roadmap/live', undefined, signal);
  }

  async stateSubset(name: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', `/state/${encodeURIComponent(name)}`, undefined, signal);
  }

  /** Standard v22 — `GET /storage/usage`. Returns the per-bucket
   *  disk-usage breakdown of `.meshkore/`. Cached by the daemon
   *  (`cache_ttl_secs`, default 5) so polling is cheap. */
  async storageUsage(signal?: AbortSignal): Promise<Result<StorageUsageResponse>> {
    return this.request<StorageUsageResponse>('GET', '/storage/usage', undefined, signal, /*requireAuth*/ false);
  }

  async info(signal?: AbortSignal): Promise<Result<InfoResponse>> {
    return this.request<InfoResponse>('GET', '/info', undefined, signal);
  }

  async credentials(signal?: AbortSignal): Promise<Result<CredentialsListResponse>> {
    return this.request<CredentialsListResponse>('GET', '/credentials', undefined, signal);
  }

  /** py-1.11.3 — Read a single credential's value. Auth-required.
   *  Cockpit only calls this when the operator clicks "reveal" so the
   *  value never moves over the wire until explicitly requested. */
  async credentialRead(name: string, signal?: AbortSignal): Promise<Result<CredentialReadResponse>> {
    return this.request<CredentialReadResponse>(
      'GET',
      `/credentials/${encodeURIComponent(name)}`,
      undefined,
      signal,
    );
  }

  /** py-1.11.3 — Create or overwrite a credential. Protected names
   *  (portal-token) return 403 — managed by the daemon itself. */
  async credentialWrite(name: string, value: string, signal?: AbortSignal): Promise<Result<{ name: string; size: number }>> {
    return this.request<{ name: string; size: number }>(
      'PUT',
      `/credentials/${encodeURIComponent(name)}`,
      { value },
      signal,
    );
  }

  /** py-1.11.3 — Delete a credential file. Protected names → 403. */
  async credentialDelete(name: string, signal?: AbortSignal): Promise<Result<{ deleted: boolean; name: string }>> {
    return this.request<{ deleted: boolean; name: string }>(
      'DELETE',
      `/credentials/${encodeURIComponent(name)}`,
      undefined,
      signal,
    );
  }

  async agents(signal?: AbortSignal): Promise<Result<unknown[]>> {
    return this.request<unknown[]>('GET', '/agents', undefined, signal);
  }

  async cronList(signal?: AbortSignal): Promise<Result<CronListResponse>> {
    return this.request<CronListResponse>('GET', '/cron/list', undefined, signal);
  }

  async cronTrigger(id: string, signal?: AbortSignal): Promise<Result<CronTriggerResponse>> {
    return this.request<CronTriggerResponse>('POST', `/cron/${encodeURIComponent(id)}/trigger`, {}, signal);
  }

  async cronCancel(id: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; id: string; cancelled: boolean }>> {
    return this.request<{ ok: boolean; id: string; cancelled: boolean }>(
      'POST', `/cron/${encodeURIComponent(id)}/cancel`, {}, signal,
    );
  }

  async protocols(signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', '/protocols', undefined, signal);
  }

  /** V86w — Per-initiative git activity. Returns commits whose
   *  subject/body mentions the initiative id, plus the files each
   *  commit touched. Multi-repo workspaces walk depth-1
   *  sub-repos and combine results. */
  async initiativeActivity(id: string, signal?: AbortSignal): Promise<Result<InitiativeActivity>> {
    return this.request<InitiativeActivity>('GET', `/initiative/${encodeURIComponent(id)}/activity`, undefined, signal);
  }

  /** Move an initiative to a wall at a given position. The daemon writes
   *  `status: <wall>` + `wall_order` to the .md (walls.py), recompacts the
   *  wall, and broadcasts `initiative.reordered`. The Queue wall (py-1.22+)
   *  uses this as the shared, disk-persisted staging primitive: stage =
   *  move to `next`; unstage = move to `active`. A CLI agent reading the
   *  standard sees the same `status: next` + `wall_order` order. */
  async initiativeReorder(
    id: string,
    wall: 'active' | 'next' | 'backlog' | 'archived',
    order: number,
    signal?: AbortSignal,
  ): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/initiative/reorder', { id, wall, order }, signal);
  }

  /** V86j — Single protocol body + frontmatter. The daemon serves
   *  it at `/protocols/<id>` (id is the P<N> slug). */
  async protocolDetail(id: string, signal?: AbortSignal): Promise<Result<ProtocolDetail>> {
    return this.request<ProtocolDetail>('GET', `/protocols/${encodeURIComponent(id)}`, undefined, signal);
  }

  async links(signal?: AbortSignal): Promise<Result<LinksRegistry>> {
    return this.request<LinksRegistry>('GET', '/links', undefined, signal);
  }

  /** py-1.9.0 — daily narrative log index. Returns descending-by-date
   *  metadata for every `.meshkore/log/<date>.md` file. The Diary tab
   *  uses this to drive its scroll-paged viewer. */
  async logList(signal?: AbortSignal): Promise<Result<LogListResponse>> {
    return this.request<LogListResponse>('GET', '/log', undefined, signal);
  }

  /** py-1.9.0 — fetch ONE day-log body as raw markdown. Returns the
   *  raw text via the standard transport — the cockpit handles
   *  rendering. */
  async logFile(name: string, signal?: AbortSignal): Promise<{ ok: true; body: string } | { ok: false; status: number; error?: string }> {
    const url = this.transport.httpBase + '/log/' + encodeURIComponent(name);
    const token = this.transport.token;
    try {
      const r = await fetch(url, {
        signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(this.transport.projectId
            ? { 'X-MeshKore-Project': this.transport.projectId }
            : {}),
        },
      });
      if (!r.ok) return { ok: false, status: r.status };
      const body = await r.text();
      return { ok: true, body };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Standard v16 chat-turn queue (V107.41, daemon py-1.12.12+) ────
  async queueList(conv: string, signal?: AbortSignal): Promise<Result<ChatQueueResponse>> {
    return this.request<ChatQueueResponse>(
      'GET', `/chat/conv/${encodeURIComponent(conv)}/queue`, undefined, signal,
    );
  }
  async queueEnqueue(conv: string, text: string, signal?: AbortSignal): Promise<Result<ChatQueueItem>> {
    return this.request<ChatQueueItem>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue`, { text }, signal,
    );
  }
  async queueEdit(conv: string, id: string, text: string, signal?: AbortSignal): Promise<Result<ChatQueueItem>> {
    return this.request<ChatQueueItem>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}/edit`, { text }, signal,
    );
  }
  async queueMove(conv: string, id: string, position: number, signal?: AbortSignal): Promise<Result<{ items: ChatQueueItem[] }>> {
    return this.request<{ items: ChatQueueItem[] }>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}/move`, { position }, signal,
    );
  }
  async queuePromote(conv: string, id: string, signal?: AbortSignal): Promise<Result<ChatQueueItem>> {
    return this.request<ChatQueueItem>(
      'POST', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}/promote`, undefined, signal,
    );
  }
  async queueDelete(conv: string, id: string, signal?: AbortSignal): Promise<Result<{ removed: string }>> {
    return this.request<{ removed: string }>(
      'DELETE', `/chat/conv/${encodeURIComponent(conv)}/queue/${encodeURIComponent(id)}`, undefined, signal,
    );
  }

  /** V107.34 — Standard v14 project context. GET /context returns
   *  the .meshkore/context/ tree (folders + files with parsed
   *  frontmatter + word counts + budget warnings). GET /context/<path>
   *  serves the raw markdown body of a single file. Cockpit's
   *  Context tab consumes both. Daemon must be at py-1.12.10+. */
  async contextTree(signal?: AbortSignal): Promise<Result<ContextTreeResponse>> {
    return this.request<ContextTreeResponse>('GET', '/context', undefined, signal);
  }

  async contextFile(path: string, signal?: AbortSignal): Promise<{ ok: true; body: string } | { ok: false; status: number; error?: string }> {
    const rel = path.replace(/^\/+/, '');
    const url = this.transport.httpBase + '/context/' + rel.split('/').map(encodeURIComponent).join('/');
    const token = this.transport.token;
    try {
      const r = await fetch(url, {
        signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(this.transport.projectId
            ? { 'X-MeshKore-Project': this.transport.projectId }
            : {}),
        },
      });
      if (!r.ok) return { ok: false, status: r.status };
      const body = await r.text();
      return { ok: true, body };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  /** knowledge-tree-unified KT3 — the unified knowledge tree. GET
   *  /knowledge returns the manifest-driven concept tree (overlay over
   *  context/+docs/+modules/; per-node load policy + spawn-token budget).
   *  GET /knowledge/<id> serves a single node's processed body, lazily.
   *  Daemon must be at py-1.24.0+. */
  async knowledgeTree(signal?: AbortSignal): Promise<Result<KnowledgeTreeResponse>> {
    return this.request<KnowledgeTreeResponse>('GET', '/knowledge', undefined, signal);
  }

  async knowledgeNode(id: string, signal?: AbortSignal): Promise<Result<KnowledgeNodeBody>> {
    return this.request<KnowledgeNodeBody>('GET', '/knowledge/' + encodeURIComponent(id), undefined, signal);
  }

  /** V107.22 — fetch ANY file under the cluster root as raw markdown
   *  via the daemon's static file route. `path` is the repo-relative
   *  string the daemon embeds in task / initiative records
   *  (`.meshkore/modules/<m>/tasks/<file>.md`, etc.). Used by the
   *  Roadmap UI to render rich initiative descriptions + task bodies
   *  on expand without bloating the /state payload.
   *
   *  V107.26 — Map the cluster-relative `.meshkore/<subdir>/...` path
   *  into the daemon's actual static routes. The daemon does NOT mount
   *  `.meshkore/` at root; it exposes three explicit prefixes under
   *  different names (see daemon.py do_GET, py-1.12.x):
   *
   *    `.meshkore/docs/...`     → `GET /docs/...`
   *    `.meshkore/modules/...`  → `GET /modules/...`
   *    `.meshkore/roadmap/...`  → `GET /tasks/...`   ← yes, renamed
   *    `.meshkore/log/...`      → `GET /log/<file>`  (handled below)
   *
   *  Pre-V107.26 every fetch hit `/.meshkore/...` directly → 404 every
   *  time. Symptom: InitiativeCard descriptions + TaskCard bodies +
   *  Diary entries all stuck on "no body" / blank on any project
   *  whose conversation history wasn't already in convMap from a live
   *  WS session (Cavioca field report 2026-06-02). */
  async readMarkdownFile(path: string, signal?: AbortSignal): Promise<{ ok: true; body: string } | { ok: false; status: number; error?: string }> {
    // Strip a leading slash; the daemon mounts the cluster root at /
    const rel = path.replace(/^\/+/, '');
    const mapped = rewriteMeshkoreStaticPath(rel);
    const url = this.transport.httpBase + '/' + mapped.split('/').map(encodeURIComponent).join('/');
    const token = this.transport.token;
    try {
      const r = await fetch(url, {
        signal,
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(this.transport.projectId
            ? { 'X-MeshKore-Project': this.transport.projectId }
            : {}),
        },
      });
      if (!r.ok) return { ok: false, status: r.status };
      const body = await r.text();
      const head = body.slice(0, 200).toLowerCase();
      if (head.includes('<!doctype') || head.includes('<html')) {
        return { ok: false, status: 0, error: 'daemon returned HTML for markdown request' };
      }
      return { ok: true, body };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Mutating endpoints ────────────────────────────────────────────

  async chatDispatch(body: DispatchBody, signal?: AbortSignal): Promise<Result<DispatchResponse>> {
    return this.request<DispatchResponse>('POST', '/chat/dispatch', body, signal);
  }

  async chatCancel(conv: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/chat/cancel', { conv }, signal);
  }

  /** V104 — POST /chat/archive. The cockpit's local archive button
   *  used to ONLY update the per-tab `archivedConvs` signal, never
   *  syncing to the daemon. Hard refresh + V102 hydrate then re-
   *  populated the rail with the un-synced convs because the daemon
   *  had no record. Now the local archive path calls this and the
   *  daemon broadcasts `chat.archived` so EVERY tab updates. */
  async chatArchive(conv: string, signal?: AbortSignal): Promise<Result<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('POST', '/chat/archive', { conv }, signal);
  }

  /** V104 — POST /chat/unarchive. Symmetric to chatArchive. */
  async chatUnarchive(conv: string, signal?: AbortSignal): Promise<Result<{ ok: boolean }>> {
    return this.request<{ ok: boolean }>('POST', '/chat/unarchive', { conv }, signal);
  }

  // ── py-1.11.0: chat-state-rearchitecture (initiative
  //   `chat-state-rearchitecture`). Replaces the implicit
  //   /state.timeline.recent_events replay path with a canonical
  //   daemon-authoritative conv API. Cockpit only calls these when
  //   `chat.snapshot.v1` is advertised in /health.features. ──────

  /** Boot consolidated payload — convs + archives + paused + quota +
   *  debug in one round-trip. Replaces the legacy chain of /state +
   *  /chat/archives + /health.chat_active_convs hydration. Anonymous
   *  read (matches /chat/archives). */
  async chatSnapshot(signal?: AbortSignal): Promise<Result<ChatSnapshotResponse>> {
    return this.request<ChatSnapshotResponse>('GET', '/chat/snapshot', undefined, signal, /*requireAuth*/ false);
  }

  /** Canonical conv list. Cockpit reads this on WS `state.rebuilt` or
   *  any conv.* event when the snapshot.v1 path is active and we
   *  need to resync. */
  async chatConvs(signal?: AbortSignal): Promise<Result<ChatConvsResponse>> {
    return this.request<ChatConvsResponse>('GET', '/chat/convs', undefined, signal, /*requireAuth*/ false);
  }

  /** One conv's normalised metadata. Deep-link / resync helper. */
  async chatConvMeta(conv: string, signal?: AbortSignal): Promise<Result<ChatConvMetaResponse>> {
    return this.request<ChatConvMetaResponse>(
      'GET', `/chat/conv/${encodeURIComponent(conv)}/meta`, undefined, signal, /*requireAuth*/ false,
    );
  }

  /** Paginated message reader. `before` is the ISO ts of the oldest
   *  event from the previous page (omit to fetch the newest page).
   *  Returns events in chronological order (oldest → newest); the
   *  cockpit's reducer expects that ordering. */
  async chatConvMessages(
    conv: string,
    opts?: { before?: string; limit?: number },
    signal?: AbortSignal,
  ): Promise<Result<ChatConvMessagesResponse>> {
    const params = new URLSearchParams();
    if (opts?.before) params.set('before', opts.before);
    if (opts?.limit) params.set('limit', String(opts.limit));
    const qs = params.toString();
    const path = `/chat/conv/${encodeURIComponent(conv)}/messages${qs ? '?' + qs : ''}`;
    return this.request<ChatConvMessagesResponse>('GET', path, undefined, signal, /*requireAuth*/ false);
  }

  // py-1.10.0 — Story-run coordinator.
  async runsList(activeOnly = false, signal?: AbortSignal): Promise<Result<RunsList>> {
    return this.request<RunsList>('GET', `/runs${activeOnly ? '?active=1' : ''}`, undefined, signal);
  }

  async runStart(body: RunStartBody, signal?: AbortSignal): Promise<Result<{ ok: boolean; run: RunRecord }>> {
    return this.request<{ ok: boolean; run: RunRecord }>('POST', '/runs', body, signal);
  }

  async runCancel(id: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; run: RunRecord }>> {
    return this.request<{ ok: boolean; run: RunRecord }>('POST', `/runs/${encodeURIComponent(id)}/cancel`, {}, signal);
  }

  async runAdvance(id: string, cursor: number, streamId?: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; run: RunRecord }>> {
    const body: Record<string, unknown> = { cursor };
    if (streamId) body.stream_id = streamId;
    return this.request<{ ok: boolean; run: RunRecord }>('POST', `/runs/${encodeURIComponent(id)}/advance`, body, signal);
  }

  async runFinish(id: string, status: 'done' | 'failed', error?: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; run: RunRecord }>> {
    const body: Record<string, unknown> = { status };
    if (error) body.error = error;
    return this.request<{ ok: boolean; run: RunRecord }>('POST', `/runs/${encodeURIComponent(id)}/finish`, body, signal);
  }

  async runSetStream(id: string, streamId: string, signal?: AbortSignal): Promise<Result<{ ok: boolean; run: RunRecord }>> {
    return this.request<{ ok: boolean; run: RunRecord }>('POST', `/runs/${encodeURIComponent(id)}/stream`, { stream_id: streamId }, signal);
  }

  async messages(body: { text: string; author?: string; conv?: string }, signal?: AbortSignal): Promise<Result<DaemonEvent>> {
    return this.request<DaemonEvent>('POST', '/messages', body, signal);
  }

  async tasksCreate(body: TaskCreateBody, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/tasks', body, signal);
  }

  // ── agent-team roster (ATM9 daemon contract) ──────────────────────

  /** GET /team — full roster (frontmatter + live instance counts),
   *  sorted by pinned_order. Anonymous read (matches /chat/snapshot). */
  async teamList(signal?: AbortSignal): Promise<Result<TeamMember[]>> {
    return this.request<TeamMember[]>('GET', '/team', undefined, signal, /*requireAuth*/ false);
  }

  /** GET /team/<id> — one member incl. its init-prompt body. */
  async teamGet(id: string, signal?: AbortSignal): Promise<Result<TeamMemberDetail>> {
    return this.request<TeamMemberDetail>('GET', `/team/${encodeURIComponent(id)}`, undefined, signal, /*requireAuth*/ false);
  }

  /** POST /team — create a new member (always kind:'profile'). */
  async teamCreate(body: TeamCreateBody, signal?: AbortSignal): Promise<Result<TeamMember>> {
    return this.request<TeamMember>('POST', '/team', body, signal);
  }

  /** PATCH /team/<id> — partial update. `kind`/`required` are immutable
   *  (the daemon rejects them); send only the edited section's fields. */
  async teamUpdate(id: string, body: TeamPatchBody, signal?: AbortSignal): Promise<Result<TeamMember>> {
    return this.request<TeamMember>('PATCH', `/team/${encodeURIComponent(id)}`, body, signal);
  }

  /** DELETE /team/<id> — 409 when the member is required. */
  async teamDelete(id: string, signal?: AbortSignal): Promise<Result<{ deleted: boolean; id: string }>> {
    return this.request<{ deleted: boolean; id: string }>('DELETE', `/team/${encodeURIComponent(id)}`, undefined, signal);
  }

  /** POST /team/draft — LLM normaliser: free-text mission → structured
   *  draft the operator reviews before saving (ATM4/ATM5). */
  async teamDraft(body: TeamDraftBody, signal?: AbortSignal): Promise<Result<TeamDraftResponse>> {
    return this.request<TeamDraftResponse>('POST', '/team/draft', body, signal);
  }

  async taskTransition(id: string, status: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', `/tasks/${encodeURIComponent(id)}/transition`, { status }, signal);
  }

  async taskCancel(id: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', `/tasks/${encodeURIComponent(id)}/cancel`, {}, signal);
  }

  async agentsCreate(body: Record<string, unknown>, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/agents', body, signal);
  }

  async reload(signal?: AbortSignal): Promise<Result<{ ok: boolean; generated_at: string }>> {
    return this.request<{ ok: boolean; generated_at: string }>('POST', '/reload', {}, signal);
  }

  async shutdown(signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/shutdown', {}, signal);
  }

  async selfUpdate(body: { url?: string } = {}, signal?: AbortSignal): Promise<Result<SelfUpdateResponse>> {
    return this.request<SelfUpdateResponse>('POST', '/self-update', body, signal);
  }

  async versionNext(body: { key: string; bump?: 'major' | 'minor' | 'patch' }, signal?: AbortSignal): Promise<Result<{ version: string }>> {
    return this.request<{ version: string }>('POST', '/version/next', body, signal);
  }

  // ── WebSocket (temporary — moves to lib/transport in M1.2) ───────

  /**
   * Open the daemon's /events WebSocket stream. Returns the raw socket
   * — reconnection / backoff / state machine is the caller's job (or
   * gets wrapped in M1.2's transport layer).
   *
   * @deprecated until M1.2. Use the future `Transport.openEvents` once
   * it lands.
   */
  openEvents(
    onEvent: (ev: DaemonEvent) => void,
    onState: (s: 'open' | 'closed' | 'error') => void,
  ): WebSocket {
    const url = new URL('/events', this.transport.wsBase);
    if (this.transport.token) url.searchParams.set('token', this.transport.token);
    const ws = new WebSocket(url.toString());
    ws.addEventListener('open', () => onState('open'));
    ws.addEventListener('close', () => onState('closed'));
    ws.addEventListener('error', () => onState('error'));
    ws.addEventListener('message', (msg) => {
      try {
        const data = typeof msg.data === 'string' ? msg.data : '';
        if (!data) return;
        onEvent(JSON.parse(data) as DaemonEvent);
      } catch (e) {
        log.warn('events parse failed', e instanceof Error ? e.message : String(e));
      }
    });
    return ws;
  }

  // ── Internals ─────────────────────────────────────────────────────

  private async request<T>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    requireAuth = true,
    _reauthRetried = false,
  ): Promise<Result<T>> {
    const url = `${this.transport.httpBase}${path}`;
    const headers: Record<string, string> = {};
    const sendsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    if (sendsBody) headers['content-type'] = 'application/json';
    if (requireAuth && this.transport.token) {
      headers['authorization'] = `Bearer ${this.transport.token}`;
    }
    // FC-1 (daemon-centralized) — one chokepoint, so every one of the 52
    // client methods inherits project routing. Absent projectId → no header →
    // daemon's default (boot) project = today's behaviour.
    if (this.transport.projectId) {
      headers['x-meshkore-project'] = this.transport.projectId;
    }
    let res: Response;
    // V108 — bound EVERY request. Most callers (boot path: health /
    // state / chatSnapshot, the discovery scan) pass no signal, so a
    // stalled connection (TLS handshake hiccup, saturated per-host pool)
    // hung the fetch forever — that's what stranded both the "Looking
    // for the daemon" scan AND the hydration BootingPanel with no
    // escape. Cap at 15s and compose with any caller-supplied signal.
    const timeoutSignal = AbortSignal.timeout(15000);
    const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: sendsBody ? JSON.stringify(body ?? {}) : undefined,
        signal: effectiveSignal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('daemon request failed', method, path, msg);
      return { ok: false, status: 0, body: '', error: msg };
    }
    // FC-2 — 401 self-heal: a stale token recovers by re-fetching the daemon's
    // current local token and retrying ONCE, instead of surfacing "Unauthorized".
    if (res.status === 401 && requireAuth && reauthHandler && !_reauthRetried) {
      try {
        const fresh = await reauthHandler(this.transport.httpBase);
        if (fresh && fresh !== this.transport.token) {
          this.transport.token = fresh;
          return this.request<T>(method, path, body, signal, requireAuth, true);
        }
      } catch { /* fall through to the normal 401 result below */ }
    }
    const daemonVersion = res.headers.get('x-meshkore-daemon-version') ?? undefined;
    // V94 — fan-out the version header to the registered listener so
    // daemonStore can detect mid-session bumps (self-update on the
    // daemon, manual P4 upgrade, etc.) and flip outdated/ahead flags.
    if (daemonVersion && daemonVersionListener) {
      try { daemonVersionListener(this.transport.httpBase, daemonVersion); } catch { /* never let a listener crash the request */ }
    }
    const text = await res.text();
    if (!res.ok) {
      log.warn('daemon non-2xx', method, path, res.status, text.slice(0, 200));
      return { ok: false, status: res.status, body: text };
    }
    let data: T;
    try {
      data = (text ? JSON.parse(text) : {}) as T;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('daemon JSON parse failed', path, msg);
      return { ok: false, status: res.status, body: text, error: 'invalid JSON' };
    }
    return { ok: true, data, status: res.status, daemonVersion };
  }
}

export class DaemonError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'DaemonError';
  }
}
