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
 * V86e (revised py-1.10.18) — Probe the operator's last-known port +
 * the canonical 5570–5574 in parallel. Rationale: a sequence of
 * `kill -TERM` + restart will often migrate the daemon by 1–2 ports
 * because the kernel keeps the prior listener in TIME_WAIT briefly.
 * The original "last + 5570" range missed that case silently and
 * left the cockpit stuck on "No daemon detected". Parallel probe
 * means the cold-boot path is still ~one round-trip total instead of
 * 5×TIMEOUT serial.
 *
 * Full-range discovery (5570–5589) still lives behind the operator's
 * explicit "Scan ports" button in the rail.
 */
export const BOOT_PROBE_TIMEOUT_MS = 1200;

export function bootProbePorts(): number[] {
  const last = parseInt(localStorage.getItem('meshcore-last-port') || '0', 10);
  const ordered: number[] = [];
  if (last >= 5570 && last <= 5589) ordered.push(last);
  for (let p = 5570; p <= 5574; p++) {
    if (!ordered.includes(p)) ordered.push(p);
  }
  return ordered;
}

export async function probeLocal(timeoutMs = BOOT_PROBE_TIMEOUT_MS): Promise<{ port: number; health: HealthResponse } | null> {
  // V107.17 — sticky-project boot. The operator's last-selected port is
  // already saved (ProjectsRailRow / switchProject). When multiple
  // daemons are running, the previous `Promise.any` race winner was
  // non-deterministic — whichever daemon's `/health` responded first
  // became "the project" after reload. Now we do a fast solo probe of
  // the saved port FIRST so the cockpit lands on the project the
  // operator was actually using. If the saved port is dead (daemon
  // stopped / port shifted), we fall through to the parallel race.
  const last = parseInt(localStorage.getItem('meshcore-last-port') || '0', 10);
  if (last >= 5570 && last <= 5589) {
    const soloCtl = new AbortController();
    const soloTimer = setTimeout(() => soloCtl.abort(), Math.min(timeoutMs, 600));
    try {
      const res = await fetch(`${daemonHttpBase(last)}/health`, { signal: soloCtl.signal });
      if (res.ok) {
        const health = await res.json() as HealthResponse;
        clearTimeout(soloTimer);
        return { port: last, health };
      }
    } catch {
      // Saved port unreachable — fall through to the parallel race.
    } finally {
      clearTimeout(soloTimer);
      soloCtl.abort();
    }
  }

  const ports = bootProbePorts();
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  // Promise.any resolves with the FIRST fulfilled probe; we abort the
  // rest as soon as a winner is known to avoid 4 wasted fetches sitting
  // in CONNECTING. Each probe rejects on non-OK / network error so
  // they don't accidentally "win" with a stale daemon's bad response.
  try {
    const winner = await Promise.any(
      ports.map(async (port) => {
        const res = await fetch(`${daemonHttpBase(port)}/health`, { signal: ctl.signal });
        if (!res.ok) throw new Error(`port ${port}: HTTP ${res.status}`);
        const health = await res.json() as HealthResponse;
        return { port, health };
      }),
    );
    return winner;
  } catch {
    // All probes failed (AggregateError from Promise.any) or the
    // outer timeout fired — caller treats this as no-daemon.
    return null;
  } finally {
    clearTimeout(timer);
    ctl.abort();
  }
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

  const ports = bootProbePorts();
  setStatus({ kind: 'probing', message: `Looking for the daemon on ${ports.map((p) => `:${p}`).join(', ')}…` });
  const probe = await probeLocal();
  if (!probe) {
    setStatus({ kind: 'no-daemon', portsTried: ports });
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
