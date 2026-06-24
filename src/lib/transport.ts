/**
 * Transport — three-way abstraction over the daemon API.
 *
 * The Architect SPA must reach the daemon in one of three modes:
 *
 *   • LOCAL  — http://localhost:5570 (the only mode shipped today)
 *   • LAN    — http://<host>:5570  (e.g. another machine on the network)
 *   • CLOUD  — wss://cluster.meshkore.com/v1/viewer?cluster=<token>
 *              (Cluster Cloud P1, not implemented in this milestone)
 *
 * Higher-level code only sees a `Transport` object. The decision of which
 * concrete implementation to instantiate happens at boot time from the
 * URL (`?cluster=…` → cloud, default → local) so components never branch
 * on mode.
 */

export type TransportKind = 'local' | 'lan' | 'cloud';

export interface TransportConfig {
  kind: TransportKind;
  /** Base URL for HTTP (REST). For local: `http://localhost:5570`. */
  httpBase: string;
  /** Base URL for WebSocket. For local: `ws://localhost:5570`. */
  wsBase: string;
  /** Bearer token. May be empty for `/health` probes; required for everything else. */
  token: string;
  /** Human-readable label shown in the UI ("localhost:5570", "cloud · meshkore-main"). */
  label: string;
  /**
   * FC-1 (daemon-centralized) — the project this transport addresses. Sent as
   * the `X-MeshKore-Project` header on every request so ONE daemon can serve
   * many projects. Absent → the daemon uses its default (boot) project, which
   * is exactly today's one-daemon-per-project behaviour.
   */
  projectId?: string;
}

/** Default daemon port range from the spec — try first in order. */
export const DEFAULT_DAEMON_PORTS = [5570, 5571, 5572, 5573, 5574];

/**
 * V85e — Loopback DNS endpoint. `daemon.meshkore.com` resolves to
 * 127.0.0.1 via a public CF DNS A record. When the daemon serves
 * TLS for this name on its port, the cockpit can talk to it from
 * any HTTPS origin without mixed-content or Local Network Access
 * Issues.
 *
 * Switching is feature-flagged via `localStorage['mc-daemon-via-tls']`
 * (or the `?tls=1` query string). Default OFF until the daemon ships
 * TLS support — flipping the flag without a TLS-serving daemon would
 * just trade mixed-content errors for TLS-handshake errors.
 *
 * About modal shows the current mode so the operator can confirm.
 */
export const LOOPBACK_HOSTNAME = 'daemon.meshkore.com';

/**
 * Whether the cockpit should reach the daemon via
 * `https://daemon.meshkore.com:<port>` (true) or
 * `http://localhost:<port>` (false).
 *
 * Resolution order (first match wins):
 *   1. `?tls=1` / `?tls=0` query string  — debug override, this session only
 *   2. `localStorage['mc-daemon-via-tls']` set to '1' or '0' — explicit preference
 *   3. **Default by origin**: ON when the cockpit page itself is HTTPS,
 *      OFF when it's HTTP. Plain HTTP→HTTP localhost works same-origin;
 *      HTTPS→HTTP localhost is blocked by mixed-content rules, so the
 *      only sensible default from an HTTPS origin is the TLS path.
 *
 * V86 — default-by-origin was added after operators reported
 * 3.8k+ Chrome LNA Issues on architect.meshkore.com because the flag
 * stayed off-by-default and every fetch tripped mixed content.
 */
export function useTlsDaemon(): boolean {
  try {
    if (typeof window === 'undefined') return false;
    const url = new URL(window.location.href);
    if (url.searchParams.get('tls') === '1') return true;
    if (url.searchParams.get('tls') === '0') return false;
    const stored = localStorage.getItem('mc-daemon-via-tls');
    if (stored === '1') return true;
    if (stored === '0') return false;
    return window.location.protocol === 'https:';
  } catch { return false; }
}

/** Compose the HTTP base URL for a daemon on a given port. */
export function daemonHttpBase(port: number): string {
  return useTlsDaemon()
    ? `https://${LOOPBACK_HOSTNAME}:${port}`
    : `http://localhost:${port}`;
}

/** Compose the WebSocket base URL for a daemon on a given port. */
export function daemonWsBase(port: number): string {
  return useTlsDaemon()
    ? `wss://${LOOPBACK_HOSTNAME}:${port}`
    : `ws://localhost:${port}`;
}

/**
 * Build a LOCAL transport for a given port. No token resolution here — the
 * caller injects it (from localStorage, prompt, or auto-discovery).
 */
export function localTransport(
  port: number,
  token: string,
  projectId?: string,
): TransportConfig {
  const tls = useTlsDaemon();
  return {
    kind: 'local',
    httpBase: daemonHttpBase(port),
    wsBase: daemonWsBase(port),
    token,
    label: tls ? `${LOOPBACK_HOSTNAME}:${port}` : `localhost:${port}`,
    projectId,
  };
}

/** LAN transport — same shape, different host. */
export function lanTransport(
  host: string,
  port: number,
  token: string,
  projectId?: string,
): TransportConfig {
  return {
    kind: 'lan',
    httpBase: `http://${host}:${port}`,
    wsBase: `ws://${host}:${port}`,
    token,
    label: `${host}:${port}`,
    projectId,
  };
}

/**
 * CLOUD transport — stub until Cluster Cloud P1 ships. The token in the URL
 * (`?cluster=<token>`) is a viewer JWT; the WS at cluster.meshkore.com fans
 * out events from the operator's daemon(s). See cluster-cloud initiative
 * CC04 for the server side.
 */
export function cloudTransport(token: string): TransportConfig {
  return {
    kind: 'cloud',
    httpBase: 'https://cluster.meshkore.com',
    wsBase: 'wss://cluster.meshkore.com',
    token,
    label: 'cloud · pending',
  };
}

/**
 * Read mode from the URL. Used once at boot in App.tsx to pick the right
 * transport before any data fetching happens.
 */
export function modeFromUrl(): { kind: TransportKind; token: string | null } {
  const params = new URLSearchParams(window.location.search);
  const clusterToken = params.get('cluster');
  if (clusterToken) return { kind: 'cloud', token: clusterToken };
  // No LAN auto-detect for now — operator types the host in a future panel.
  return { kind: 'local', token: null };
}
