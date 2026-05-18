/**
 * DaemonClient — typed wrapper over the daemon HTTP+WS surface.
 *
 * Daemon API reference (canonical: daemon/src/server.ts header):
 *
 *   GET   /health                       (public — no auth)
 *   GET   /state                        full bundle (cluster, roadmap, docs, …)
 *   GET   /state/{roadmap|docs|cluster|modules|timeline}
 *   GET   /agents
 *   GET   /credentials                  metadata only
 *   GET   /reload                       force state rebuild
 *   GET   /docs/<path>                  raw markdown
 *   GET   /tasks/<path>                 raw markdown
 *   GET   /modules/<path>
 *   POST  /messages                     append chat.user
 *   POST  /tasks                        create task
 *   POST  /tasks/{id}/transition        update status
 *   POST  /tasks/{id}/dispatch          spawn worker
 *   POST  /tasks/{id}/cancel
 *   POST  /chat/dispatch                coordinator chat
 *   WS    /events                       JSON-line event stream
 *
 * Auth: Bearer in `Authorization` header. On WebSocket upgrade, the
 * daemon also accepts `?token=<token>` query (browsers can't set headers
 * on a WS handshake). We use the query-string variant for WS so the
 * browser side works without extra plumbing.
 */

import type { TransportConfig } from './transport';

export interface HealthResponse {
  ok: boolean;
  identity: string;
  port: number;
  mode: string;
  cluster_id?: string;
  cluster_name?: string;
  cluster_type?: string;
  device?: { hostname: string; platform: string; arch: string; os_release: string };
  ts: string;
}

/** A single event coming off the daemon's /events stream. */
export interface DaemonEvent {
  type: string;
  ts?: string;
  [k: string]: unknown;
}

export class DaemonError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export class DaemonClient {
  constructor(public readonly transport: TransportConfig) {}

  // ─── HTTP ────────────────────────────────────────────────────────────────

  async health(signal?: AbortSignal): Promise<HealthResponse> {
    const res = await fetch(`${this.transport.httpBase}/health`, { signal });
    if (!res.ok) throw new DaemonError(res.status, await res.text());
    return res.json() as Promise<HealthResponse>;
  }

  async state(signal?: AbortSignal): Promise<unknown> {
    return this.get('/state', signal);
  }

  async agents(signal?: AbortSignal): Promise<unknown[]> {
    return this.get<unknown[]>('/agents', signal);
  }

  async credentials(signal?: AbortSignal): Promise<unknown[]> {
    return this.get<unknown[]>('/credentials', signal);
  }

  async reload(): Promise<{ ok: boolean; generated_at: string }> {
    return this.get('/reload');
  }

  // ─── Mutating ────────────────────────────────────────────────────────────

  async postMessage(body: { text: string; author?: string; conv?: string }): Promise<DaemonEvent> {
    return this.post<DaemonEvent>('/messages', body);
  }

  async chatDispatch(body: { text: string; author?: string; conv?: string }): Promise<unknown> {
    return this.post<unknown>('/chat/dispatch', body);
  }

  async taskDispatch(id: string, body: Record<string, unknown> = {}): Promise<unknown> {
    return this.post<unknown>(`/tasks/${encodeURIComponent(id)}/dispatch`, body);
  }

  async taskCancel(id: string): Promise<unknown> {
    return this.post<unknown>(`/tasks/${encodeURIComponent(id)}/cancel`, {});
  }

  // ─── WebSocket ───────────────────────────────────────────────────────────

  /**
   * Open the /events stream. Reconnection is the caller's job (an upstream
   * store layer handles backoff + state machine).
   */
  openEvents(onEvent: (ev: DaemonEvent) => void, onState: (s: 'open' | 'closed' | 'error') => void): WebSocket {
    const url = new URL('/events', this.transport.wsBase);
    if (this.transport.token) url.searchParams.set('token', this.transport.token);
    const ws = new WebSocket(url.toString());
    ws.addEventListener('open', () => onState('open'));
    ws.addEventListener('close', () => onState('closed'));
    ws.addEventListener('error', () => onState('error'));
    ws.addEventListener('message', (msg) => {
      try {
        onEvent(JSON.parse(typeof msg.data === 'string' ? msg.data : '') as DaemonEvent);
      } catch {
        // Daemon only ever emits JSON lines; if parsing fails, drop silently.
        // A user-visible logger goes here in a follow-up.
      }
    });
    return ws;
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private async get<T = unknown>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(`${this.transport.httpBase}${path}`, {
      signal,
      headers: this.authHeaders(),
    });
    if (!res.ok) throw new DaemonError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private async post<T = unknown>(path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${this.transport.httpBase}${path}`, {
      method: 'POST',
      headers: { ...this.authHeaders(), 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) throw new DaemonError(res.status, await res.text());
    return res.json() as Promise<T>;
  }

  private authHeaders(): Record<string, string> {
    return this.transport.token ? { authorization: `Bearer ${this.transport.token}` } : {};
  }
}
