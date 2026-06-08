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

export interface ChatConvSummary {
  conv: string;
  agent_type: string | null;
  agent_id: string | null;
  parent_conv: string | null;
  initiative_id: string | null;
  task_id: string | null;
  archived: boolean;
  archived_at: string | null;
  archived_by: string | null;
  live: boolean;
  coordinating: boolean;
  waiting_on: string[];
  created_at: string;
  last_activity_at: string;
  msg_count: number;
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

  async stateSubset(name: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('GET', `/state/${encodeURIComponent(name)}`, undefined, signal);
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
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!r.ok) return { ok: false, status: r.status };
      const body = await r.text();
      return { ok: true, body };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
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
        headers: token ? { Authorization: `Bearer ${token}` } : {},
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
    method: 'GET' | 'POST' | 'PUT' | 'DELETE',
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    requireAuth = true,
  ): Promise<Result<T>> {
    const url = `${this.transport.httpBase}${path}`;
    const headers: Record<string, string> = {};
    const sendsBody = method === 'POST' || method === 'PUT';
    if (sendsBody) headers['content-type'] = 'application/json';
    if (requireAuth && this.transport.token) {
      headers['authorization'] = `Bearer ${this.transport.token}`;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: sendsBody ? JSON.stringify(body ?? {}) : undefined,
        signal,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('daemon request failed', method, path, msg);
      return { ok: false, status: 0, body: '', error: msg };
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
