/**
 * connection.ts — discover the daemon and produce a ready DaemonClient.
 *
 * Strategy:
 *   1. Read mode from URL (?cluster=… → cloud, else local).
 *   2. For LOCAL: probe ports 5570..5574 with /health (no auth). First
 *      200 wins. Token comes from localStorage (`mc-architect-token`)
 *      OR a manual prompt the user fills once and we cache.
 *   3. For LAN: not yet implemented in this milestone.
 *   4. For CLOUD: trust the `?cluster=<token>` URL param.
 *
 * The returned object carries connection state for the UI to render.
 */

import { DaemonClient, type HealthResponse } from './daemon-client';
import {
  DEFAULT_DAEMON_PORTS,
  cloudTransport,
  daemonHttpBase,
  localTransport,
  modeFromUrl,
  type TransportConfig,
} from './transport';
import {
  clusterTokenKey,
  tokenForCluster,
  saveTokenForCluster,
} from './tokens';

export type ConnectionStatus =
  | { kind: 'probing'; message: string }
  | { kind: 'connected'; client: DaemonClient; health: HealthResponse }
  | { kind: 'no-daemon'; portsTried: number[] }
  | { kind: 'unauthorized'; transport: TransportConfig; clusterKey: string }
  | { kind: 'cloud-pending'; token: string }
  | { kind: 'error'; message: string };

/**
 * Look up the bearer token for the current cluster. M1.3 routes
 * through the per-cluster store (`meshkore-tokens-v1`) with a fallback
 * to the legacy singleton `meshcore-token` slot. Callers that need to
 * compute the key themselves should use `clusterTokenKey` directly.
 */
export function readStoredToken(health?: HealthResponse, port?: number): string {
  return tokenForCluster(clusterTokenKey({ cluster_id: health?.cluster_id, port }));
}

/**
 * Persist a token for the current cluster. M1.3 — replaces the
 * pre-Solid singleton-token store; callers MUST pass the cluster
 * identity (from /health) so we file the token under the right slot.
 */
export function storeToken(token: string, health?: HealthResponse, port?: number): void {
  saveTokenForCluster(clusterTokenKey({ cluster_id: health?.cluster_id, port }), token);
}

/**
 * Probe localhost ports until /health returns 200.
 * /health is unauthenticated so we can identify the daemon before we
 * have a token. Returns the first responsive port + its HealthResponse.
 */
export async function probeLocal(timeoutMs = 1200): Promise<{ port: number; health: HealthResponse } | null> {
  for (const port of DEFAULT_DAEMON_PORTS) {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${daemonHttpBase(port)}/health`, { signal: ctl.signal });
      clearTimeout(t);
      if (res.ok) {
        const health = await res.json() as HealthResponse;
        return { port, health };
      }
    } catch {
      clearTimeout(t);
      // Connection refused / aborted — try the next port.
    }
  }
  return null;
}

/**
 * One-shot connection bootstrap. Async generator-ish: caller passes a
 * setter that the UI binds to a reactive store. Each yield reflects a
 * step the user can see ("probing…", "connected", "needs token").
 */
export async function connect(setStatus: (s: ConnectionStatus) => void): Promise<void> {
  const { kind, token } = modeFromUrl();

  if (kind === 'cloud') {
    setStatus({ kind: 'cloud-pending', token: token ?? '' });
    // Cluster Cloud P1 fills this in. Until then we stop here with a
    // clear UI message; this branch is intentionally a dead-end.
    void cloudTransport;
    return;
  }

  setStatus({ kind: 'probing', message: 'Looking for a local daemon on ports 5570–5574…' });
  const probe = await probeLocal();
  if (!probe) {
    setStatus({ kind: 'no-daemon', portsTried: [...DEFAULT_DAEMON_PORTS] });
    return;
  }

  const userToken = readStoredToken(probe.health, probe.port);
  const transport = localTransport(probe.port, userToken);
  const client = new DaemonClient(transport);

  // Authenticated probe — /state requires a Bearer. If 401 we ask the
  // user for the token in the UI. M1.1: DaemonClient returns Result<T>
  // instead of throwing on non-2xx, so branch on `.ok`.
  const stateRes = await client.state();
  const clusterKey = clusterTokenKey({ cluster_id: probe.health.cluster_id, port: probe.port });
  if (stateRes.ok) {
    setStatus({ kind: 'connected', client, health: probe.health });
  } else if (stateRes.status === 401) {
    setStatus({ kind: 'unauthorized', transport, clusterKey });
  } else {
    setStatus({ kind: 'error', message: stateRes.error ?? stateRes.body.slice(0, 200) });
  }
}
