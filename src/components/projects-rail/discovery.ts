import { batch, createSignal } from 'solid-js';
import { projectsStore } from '~/state/projects';
import { daemonHttpBase } from '~/lib/transport';
import * as kp from '~/lib/known-projects';
import { log } from '~/lib/log';

export const PORT_LO = 5570;
export const PORT_HI = 5589;
const PROBE_TIMEOUT_MS = 500;

export type LiveProbe = {
  port: number;
  base: string;
  cluster_id: string | null;
  cluster_name: string | null;
  // FC-2 — true when this entry came from the daemon's AUTHORITATIVE /projects
  // table (vs the single-cluster /health fallback for old daemons). When a port
  // returns an authoritative list, that list is the COMPLETE set of projects on
  // that daemon — anything else cached for it (the server home, deleted
  // projects) is a ghost and gets pruned.
  authoritative?: boolean;
};

export const [livePorts, setLivePorts] = createSignal<Set<number>>(new Set());
export const [liveClusters, setLiveClusters] = createSignal<Map<string, LiveProbe>>(new Map());
export const [scanning, setScanning] = createSignal(false);

async function probe(port: number): Promise<LiveProbe[]> {
  const base = daemonHttpBase(port);
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return [];
    const data = await r.json().catch(() => ({})) as { cluster_id?: string; cluster_name?: string };
    // FC-2 (daemon-centralized) — ONE daemon may serve MANY projects. Ask
    // /projects (no-auth discovery) and emit one rail entry per project, all on
    // this port. The daemon routes each by the X-MeshKore-Project header.
    // Falls back to the single /health cluster for old daemons (no /projects).
    try {
      const pr = await fetch(`${base}/projects`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
      if (pr.ok) {
        const pd = await pr.json().catch(() => ({})) as { projects?: Array<{ id?: string; name?: string }> };
        const list = Array.isArray(pd.projects) ? pd.projects.filter((p) => p.id) : [];
        if (list.length > 0) {
          return list.map((p) => ({
            port, base,
            cluster_id: p.id as string,
            cluster_name: p.name ?? (p.id as string),
            authoritative: true,
          }));
        }
      }
    } catch { /* old daemon / no /projects → single-cluster fallback below */ }
    return [{ port, base, cluster_id: data.cluster_id ?? null, cluster_name: data.cluster_name ?? null }];
  } catch { return []; }
}

export async function discoverProjects(opts: { fullScan?: boolean } = {}): Promise<void> {
  // V85d — boot scans ONLY known + last-port + 5570 (the default
  // first port). The full 5570-5589 sweep ran on every boot before,
  // making 20 LNA-flagged fetches against localhost from the HTTPS
  // cockpit. Now it's bounded to ~1-3 probes unless the operator
  // explicitly hits Rescan (which still does fullScan).
  const known = kp.list();
  const priority = new Set<number>([5570]);
  const last = parseInt(localStorage.getItem('meshcore-last-port') || '0', 10);
  if (last >= PORT_LO && last <= PORT_HI) priority.add(last);
  for (const p of known) priority.add(p.port);
  const pri = [...priority].filter((p) => p >= PORT_LO && p <= PORT_HI);

  let live = (await Promise.all(pri.map(probe))).flat();

  // Only sweep the rest of the range on explicit user rescan.
  if (opts.fullScan) {
    const rest: number[] = [];
    for (let p = PORT_LO; p <= PORT_HI; p++) if (!priority.has(p)) rest.push(p);
    const more = (await Promise.all(rest.map(probe))).flat();
    live = live.concat(more);
  }

  const portSet = new Set(live.map((l) => l.port));
  const clusterMap = new Map<string, LiveProbe>();

  // FC-2 (daemon-centralized) — RECONCILE the local cache against the daemon's
  // AUTHORITATIVE /projects table. For every port that returned a real list,
  // that list is the COMPLETE set of projects on that daemon; any cached
  // known-projects entry on the same port whose cluster_id is NOT in the list
  // is a ghost (the server HOME, a deleted project, a renamed cluster) and is
  // forgotten. This makes the daemon's table the single source of truth — the
  // operator's request — so stale entries can never reappear in the rail.
  const authoritative = new Map<number, Set<string>>();
  for (const l of live) {
    if (l.authoritative && l.cluster_id) {
      let s = authoritative.get(l.port);
      if (!s) { s = new Set(); authoritative.set(l.port, s); }
      s.add(l.cluster_id);
    }
  }
  for (const k of known) {
    const allowed = authoritative.get(k.port);
    if (!allowed) continue; // this daemon didn't return an authoritative list — leave its cache alone
    if (k.cluster_id && !allowed.has(k.cluster_id)) {
      log.info('discover · pruning ghost project not in daemon table', { cluster_id: k.cluster_id, port: k.port });
      kp.forget({ cluster_id: k.cluster_id });
    }
  }

  // Collapse every setSignal + upsert into one reactive tick. Without
  // this, downstream memos (rows, orderedRows) recompute once per
  // upsert + once per livePorts/liveClusters change — boot fired the
  // rail-row memo 4-5 times in a row.
  batch(() => {
    for (const l of live) {
      if (l.cluster_id) clusterMap.set(l.cluster_id, l);
      projectsStore.upsert({
        port: l.port, base: l.base,
        cluster_id: l.cluster_id ?? undefined,
        cluster_name: l.cluster_name ?? undefined,
        status: 'live',
      });
    }
    setLivePorts(portSet);
    setLiveClusters(clusterMap);
    projectsStore.refresh(); // reflect the pruned cache in the store
  });
  log.debug('discover · live', live.length, 'known', known.length, 'fullScan', !!opts.fullScan);
}

export const projectsRailScan = {
  start: (): void => { setScanning(true); },
  stop: (): void => { setScanning(false); },
  isScanning: (): boolean => scanning(),
};

/**
 * V86l — Locate a specific cluster_id across the standard port range.
 * Used by `switchProject` when the operator's stored port for that
 * cluster comes back ERR_CONNECTION_REFUSED (typical case: a daemon
 * self-update briefly moved the port, the bookmark / kp.list() entry
 * captured the transient port, the daemon since came back on the
 * original one).
 *
 * Strategy: probe every port in [PORT_LO, PORT_HI] in parallel with a
 * short timeout, return the FIRST probe whose `cluster_id` matches.
 * Updates `livePorts` / `liveClusters` and upserts into
 * `projectsStore` so the rail self-heals — the next switchProject for
 * this cluster will use the new authoritative port without another
 * round trip.
 */
export async function findClusterPort(targetClusterId: string): Promise<LiveProbe | null> {
  const ports: number[] = [];
  for (let p = PORT_LO; p <= PORT_HI; p += 1) ports.push(p);
  const live = (await Promise.all(ports.map(probe))).flat();
  const match = live.find((p) => p.cluster_id === targetClusterId);
  // Update the discovery signals + projectsStore in a single batch so
  // memos downstream (rows.ts, OfflinePanel) see one consistent tick.
  batch(() => {
    const portSet = new Set(live.map((l) => l.port));
    const clusterMap = new Map<string, LiveProbe>();
    for (const l of live) {
      if (l.cluster_id) clusterMap.set(l.cluster_id, l);
      projectsStore.upsert({
        port: l.port, base: l.base,
        cluster_id: l.cluster_id ?? undefined,
        cluster_name: l.cluster_name ?? undefined,
        status: 'live',
      });
    }
    setLivePorts(portSet);
    setLiveClusters(clusterMap);
  });
  return match ?? null;
}
