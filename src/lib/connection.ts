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

import { DaemonClient, type HealthResponse, DaemonError } from './daemon-client';
import {
  DEFAULT_DAEMON_PORTS,
  cloudTransport,
  localTransport,
  modeFromUrl,
  type TransportConfig,
} from './transport';

export type ConnectionStatus =
  | { kind: 'probing'; message: string }
  | { kind: 'connected'; client: DaemonClient; health: HealthResponse }
  | { kind: 'no-daemon'; portsTried: number[] }
  | { kind: 'unauthorized'; transport: TransportConfig }
  | { kind: 'cloud-pending'; token: string }
  | { kind: 'error'; message: string };

const TOKEN_STORAGE_KEY = 'mc-architect-token';

export function readStoredToken(): string {
  try { return localStorage.getItem(TOKEN_STORAGE_KEY) ?? ''; } catch { return ''; }
}

export function storeToken(token: string): void {
  try { localStorage.setItem(TOKEN_STORAGE_KEY, token); } catch { /* private mode */ }
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
      const res = await fetch(`http://localhost:${port}/health`, { signal: ctl.signal });
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

  const userToken = readStoredToken();
  const transport = localTransport(probe.port, userToken);
  const client = new DaemonClient(transport);

  // Authenticated probe — /state requires a Bearer. If 401 we ask the
  // user for the token in the UI.
  try {
    await client.state();
    setStatus({ kind: 'connected', client, health: probe.health });
  } catch (err) {
    if (err instanceof DaemonError && err.status === 401) {
      setStatus({ kind: 'unauthorized', transport });
    } else {
      setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
    }
  }
}
