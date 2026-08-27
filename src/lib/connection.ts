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
import { LAST_PROJECT_KEY } from './known-projects';
import { primeDiscoveryProbe } from '~/components/projects-rail/discovery';

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
 * Persist a token under an ALREADY-RESOLVED cluster key.
 *
 * AX9 (OB-F2) — the previous helper took an optional health/port pair,
 * and the ConnectionGate submit handler had neither, so
 * `clusterTokenKey({})` filed every pasted token under the literal
 * string `'unknown'`. The retry then looked it up by real cluster key,
 * found nothing, and asked again — an infinite paste loop for anyone
 * without a local daemon to auto-unlock from. The `unauthorized`
 * status already carries the right key; take it, and make it
 * impossible to call this without one.
 */
export function saveTokenForClusterKey(clusterKey: string, token: string): void {
  saveTokenForCluster(clusterKey, token);
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

  // FC-2 (daemon-centralized) — the daemon's DEFAULT project is the server HOME
  // (its .meshkore IS the global store), NOT a real project. Landing the boot on
  // the home and THEN auto-switching to a real project reset the boot gate and
  // chained a second full load (the ~13s switch the operator hit). Instead,
  // when the boot daemon is the home, resolve a REAL project up-front and
  // connect DIRECTLY to it — one load, no home detour, no gate reset.
  let health = probe.health;
  let projectId = probe.health.cluster_id ?? undefined;
  if ((probe.health as { server_home?: boolean }).server_home) {
    const real = await pickRealProject(probe.port, userToken);
    if (real) {
      projectId = real.id;
      // Re-probe /health WITH the project header so the connected health carries
      // the REAL project's cluster_id/name (DC-4 makes /health honour it).
      //
      // AX7 (UX-F5) — deliberately KEPT while the /state probe went. It is not
      // redundant: `/projects` reports the registry NAME (`meshkore-main`),
      // `/health` reports the cluster.yaml display name (`MeshKore Core`), and
      // the header renders the latter. Synthesising it from /projects put the
      // wrong project name on screen until the 60s health poll corrected it.
      // On loopback this costs single-digit milliseconds.
      try {
        const r = await fetch(`${daemonHttpBase(probe.port)}/health`, {
          headers: { 'X-MeshKore-Project': real.id },
          signal: AbortSignal.timeout(4000),
        });
        if (r.ok) health = (await r.json()) as HealthResponse;
      } catch {
        // Fall back to the home health with the resolved identity patched in —
        // the bus still routes by projectId, and the poll heals the rest.
        health = {
          ...probe.health,
          cluster_id: real.id,
          cluster_name: real.name ?? real.id,
          server_home: false,
        } as HealthResponse;
      }
    }
    // No real project yet (fresh machine) → stay on the home so the cockpit can
    // show "add a project" rather than a dead end.
  }

  // FC-1/FC-2 — carry the resolved project's id (X-MeshKore-Project) for daemon
  // routing. One daemon, one bearer token (auth), header selects the project.
  const transport = localTransport(probe.port, userToken, projectId);
  const client = new DaemonClient(transport);

  // The ONE authenticated pre-attach call. It has to exist: `/health` is
  // unauthenticated, so nothing before this can tell "connected" from
  // "needs a token", and the `unauthorized` status below is what carries
  // `clusterKey` for AX9's token paste.
  //
  // AX7 (UX-F5) — it used to be `/state`, which is the WRONG probe twice
  // over. It is the heaviest endpoint the daemon serves (it walks the
  // whole `.meshkore/` tree) and the bind path refetched it moments
  // later, so every boot paid for the cluster tree twice before the
  // first pixel. And since py-1.34.0 `/state` is a PUBLIC route — it
  // cannot answer 401 at all, so as an auth probe it was already inert.
  // `/chat/snapshot` IS gated, and is small. `/state` now happens once,
  // after attach, in parallel with everything else in the bind fan-out.
  const authProbe = await client.chatSnapshot(AbortSignal.timeout(4000));
  const clusterKey = clusterTokenKey({ cluster_id: health.cluster_id, port: probe.port });
  if (authProbe.ok || (authProbe.status > 0 && authProbe.status !== 401)) {
    // Any answer that isn't 401 means we are talking to this daemon. A
    // 404 here is a daemon too old for `chat.snapshot.v1` — that is the
    // outdated panel's job, and it needs the connection to say so.
    setStatus({ kind: 'connected', client, health });
  } else if (authProbe.status === 401) {
    setStatus({ kind: 'unauthorized', transport, clusterKey });
  } else {
    setStatus({ kind: 'error', message: authProbe.error ?? authProbe.body.slice(0, 200) });
  }
}

/** Remember the real project the operator last viewed (written by the
 *  cluster-bind bus on every switch to a non-home project) so the next
 *  boot lands there directly. */
export function rememberLastProject(projectId: string): void {
  try { localStorage.setItem(LAST_PROJECT_KEY, projectId); } catch { /* quota */ }
}

/** Resolve which REAL project to land on when the boot daemon is the home:
 *  the last-viewed project if it still exists, else the daemon's default, else
 *  the first listed. Returns null when the daemon serves no real project yet.
 *
 *  AX7 (UX-F5) — the `/projects` answer is also handed to the rail's
 *  discovery cache. Mounting `ProjectsRail` fired an identical probe of
 *  the same port a few hundred ms later; priming it means the rail
 *  renders its rows from THIS response instead of a second round-trip. */
async function pickRealProject(
  port: number,
  token: string,
): Promise<{ id: string; name?: string } | null> {
  try {
    const r = await fetch(`${daemonHttpBase(port)}/projects`, {
      headers: token ? { authorization: `Bearer ${token}` } : {},
      signal: AbortSignal.timeout(4000),
    });
    if (!r.ok) return null;
    const data = (await r.json()) as {
      projects?: { id: string; name?: string }[];
      default?: string | null;
    };
    const projects = (data.projects ?? []).filter((p) => !!p.id);
    if (projects.length === 0) return null;
    primeDiscoveryProbe(port, daemonHttpBase(port), projects);
    const byId = new Map(projects.map((p) => [p.id, p]));
    let last: string | null = null;
    try { last = localStorage.getItem(LAST_PROJECT_KEY); } catch { /* ignore */ }
    if (last && byId.has(last)) return byId.get(last) ?? null;
    if (data.default && byId.has(data.default)) return byId.get(data.default) ?? null;
    return projects[0] ?? null;
  } catch {
    return null;
  }
}
