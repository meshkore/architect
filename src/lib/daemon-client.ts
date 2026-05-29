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
  /** py-1.10.2 — convs with a live ChatRunner right now. Cockpit
   *  consumes this at boot to mark agents working + show the
   *  preparing bubble without waiting for the next WS delta. */
  chat_active_convs?: string[];
  ts?: string;
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

  async credentials(signal?: AbortSignal): Promise<Result<unknown[]>> {
    return this.request<unknown[]>('GET', '/credentials', undefined, signal);
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

  // ── Mutating endpoints ────────────────────────────────────────────

  async chatDispatch(body: DispatchBody, signal?: AbortSignal): Promise<Result<DispatchResponse>> {
    return this.request<DispatchResponse>('POST', '/chat/dispatch', body, signal);
  }

  async chatCancel(conv: string, signal?: AbortSignal): Promise<Result<unknown>> {
    return this.request<unknown>('POST', '/chat/cancel', { conv }, signal);
  }

  /** V102 — Fetch the daemon's archived-conv list. Cockpit calls this
   *  at boot so locally-deleted-then-refreshed convs stay archived,
   *  and to pick up archive actions performed outside this tab
   *  (CLI, another browser). Response shape:
   *  `{ archived: { <conv>: { archived_at, by } } }`. */
  async chatArchives(signal?: AbortSignal): Promise<Result<{ archived: Record<string, { archived_at?: string; by?: string }> }>> {
    return this.request<{ archived: Record<string, { archived_at?: string; by?: string }> }>(
      'GET', '/chat/archives', undefined, signal, /*requireAuth*/ false,
    );
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
    method: 'GET' | 'POST',
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    requireAuth = true,
  ): Promise<Result<T>> {
    const url = `${this.transport.httpBase}${path}`;
    const headers: Record<string, string> = {};
    if (method === 'POST') headers['content-type'] = 'application/json';
    if (requireAuth && this.transport.token) {
      headers['authorization'] = `Bearer ${this.transport.token}`;
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method,
        headers,
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
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
