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
}

/** Default daemon port range from the spec — try first in order. */
export const DEFAULT_DAEMON_PORTS = [5570, 5571, 5572, 5573, 5574];

/**
 * Build a LOCAL transport for a given port. No token resolution here — the
 * caller injects it (from localStorage, prompt, or auto-discovery).
 */
export function localTransport(port: number, token: string): TransportConfig {
  return {
    kind: 'local',
    httpBase: `http://localhost:${port}`,
    wsBase: `ws://localhost:${port}`,
    token,
    label: `localhost:${port}`,
  };
}

/** LAN transport — same shape, different host. */
export function lanTransport(host: string, port: number, token: string): TransportConfig {
  return {
    kind: 'lan',
    httpBase: `http://${host}:${port}`,
    wsBase: `ws://${host}:${port}`,
    token,
    label: `${host}:${port}`,
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
