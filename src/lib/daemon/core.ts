/**
 * core.ts — the ONE HTTP pipeline every daemon call goes through.
 *
 * `DaemonCore` owns the wire mechanics; the domain method classes in
 * `./methods/` extend it and never touch `fetch` directly. Everything a
 * request needs to be correct lives here exactly once:
 *
 *   - Authorization + `X-MeshKore-Project` headers (FC-1 project routing)
 *   - the 15s timeout bound composed with the caller's AbortSignal (V108)
 *   - the FC-2 401 self-heal (re-acquire the local token, retry ONCE)
 *   - the V94 daemon-version header fan-out
 *
 * Two public shapes sit on top of that pipeline: `request<T>()` (JSON)
 * and `requestText()` (raw text). Before AX16 the three raw-text reads
 * hand-rolled their own `fetch` and therefore silently opted out of all
 * four bullets above — that class of bug is what `send()` exists to
 * make impossible.
 *
 * ─── The sanctioned client→store back-channel ──────────────────────────
 *
 * `setDaemonVersionListener` / `setReauthHandler` are the ONLY sanctioned
 * edge from this client back into the cockpit's stores, and they run in
 * ONE direction: a store registers a callback into the client at module
 * init (see `state/daemon.ts`); the client NEVER imports a store. That
 * inversion is what keeps `lib/` a leaf layer — anything else (a store
 * import here, a component import there) is a layering violation.
 *
 * Both are process-wide singletons rather than per-client fields on
 * purpose: the cockpit runs several DaemonClient instances (one per
 * attached project plus transient probes), and the handlers disambiguate
 * by `transport.httpBase`, which every invocation passes.
 */

import type { TransportConfig } from '../transport';
import { log } from '../log';
import type { Result, TextResult } from './result';

/** V108 — hard bound on EVERY request; a stalled TLS handshake or a
 *  saturated per-host pool used to hang the boot scan forever. */
const REQUEST_TIMEOUT_MS = 15000;

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

/**
 * V94 — Global listener for daemon-version-header changes. Every
 * successful HTTP response from any DaemonClient invokes this hook after
 * parsing `x-meshkore-daemon-version`. daemonStore updates the active
 * instance's recorded version and re-computes `outdated` / `ahead`, so a
 * mid-session daemon self-update lands as a UI signal within one
 * round-trip instead of waiting for a reconnect.
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
 *  for that httpBase. If it returns a fresh token, the pipeline updates the
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

/** Percent-encode each segment of a relative path, keeping the slashes. */
export function encodePathSegments(rel: string): string {
  return rel.split('/').map(encodeURIComponent).join('/');
}

/** `send()` either produced a Response or never reached the daemon. */
type SendOutcome = { res: Response } | { netError: string };

export class DaemonCore {
  constructor(public readonly transport: TransportConfig) {}

  /**
   * The single fetch chokepoint: headers, timeout, 401 self-heal, version
   * fan-out. Returns the raw Response so both the JSON and the text
   * decoder can sit on top of identical wire behaviour.
   */
  private async send(
    method: HttpMethod,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    requireAuth: boolean,
    reauthRetried: boolean,
  ): Promise<SendOutcome> {
    const url = `${this.transport.httpBase}${path}`;
    const headers: Record<string, string> = {};
    const sendsBody = method === 'POST' || method === 'PUT' || method === 'PATCH';
    if (sendsBody) headers['content-type'] = 'application/json';
    // `requireAuth: false` does not merely permit an anonymous call — it
    // SUPPRESSES the Authorization header even with a token in hand, and
    // disables the 401 self-heal below. Only pass it for genuinely public
    // routes (/health, /storage/usage, GET /team).
    if (requireAuth && this.transport.token) {
      headers['authorization'] = `Bearer ${this.transport.token}`;
    }
    // FC-1 (daemon-centralized) — one chokepoint, so every client method
    // inherits project routing. Absent projectId → no header → daemon's
    // default (boot) project.
    if (this.transport.projectId) {
      headers['x-meshkore-project'] = this.transport.projectId;
    }
    const timeoutSignal = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    const effectiveSignal = signal ? AbortSignal.any([signal, timeoutSignal]) : timeoutSignal;
    let res: Response;
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
      return { netError: msg };
    }
    // FC-2 — a stale token recovers by re-fetching the daemon's current local
    // token and retrying ONCE, instead of surfacing "Unauthorized".
    if (res.status === 401 && requireAuth && reauthHandler && !reauthRetried) {
      try {
        const fresh = await reauthHandler(this.transport.httpBase);
        if (fresh && fresh !== this.transport.token) {
          this.transport.token = fresh;
          return this.send(method, path, body, signal, requireAuth, true);
        }
      } catch { /* fall through to the normal 401 result below */ }
    }
    const daemonVersion = res.headers.get('x-meshkore-daemon-version');
    if (daemonVersion && daemonVersionListener) {
      try { daemonVersionListener(this.transport.httpBase, daemonVersion); }
      catch { /* never let a listener crash the request */ }
    }
    return { res };
  }

  /** JSON call. 2xx with an empty body decodes to `{}`. */
  protected async request<T>(
    method: HttpMethod,
    path: string,
    body: unknown,
    signal: AbortSignal | undefined,
    requireAuth = true,
  ): Promise<Result<T>> {
    const out = await this.send(method, path, body, signal, requireAuth, false);
    if ('netError' in out) return { ok: false, status: 0, body: '', error: out.netError };
    const { res } = out;
    const daemonVersion = res.headers.get('x-meshkore-daemon-version') ?? undefined;
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

  /**
   * AX16 — raw-text GET on the same pipeline as `request()`. An empty
   * 2xx body is a legitimate result (`{ ok: true, body: '' }`), and a
   * 404 is "the file isn't there", which every caller renders as absent
   * rather than as a failure — hence no warn on 404 specifically.
   */
  protected async requestText(path: string, signal?: AbortSignal): Promise<TextResult> {
    const out = await this.send('GET', path, undefined, signal, true, false);
    if ('netError' in out) return { ok: false, status: 0, error: out.netError };
    const { res } = out;
    if (!res.ok) {
      if (res.status !== 404) log.warn('daemon text non-2xx', path, res.status);
      return { ok: false, status: res.status };
    }
    try {
      return { ok: true, body: await res.text() };
    } catch (e) {
      return { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
  }
}
