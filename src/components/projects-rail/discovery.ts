import { batch, createSignal } from 'solid-js';
import { projectsStore } from '~/state/projects';
import { daemonHttpBase } from '~/lib/transport';
import * as kp from '~/lib/known-projects';
import { log } from '~/lib/log';

export const PORT_LO = 5570;
export const PORT_HI = 5589;
const PROBE_TIMEOUT_MS = 500;

export type LiveProbe = { port: number; base: string; cluster_id: string | null; cluster_name: string | null };

export const [livePorts, setLivePorts] = createSignal<Set<number>>(new Set());
export const [liveClusters, setLiveClusters] = createSignal<Map<string, LiveProbe>>(new Map());
export const [scanning, setScanning] = createSignal(false);

async function probe(port: number): Promise<LiveProbe | null> {
  const base = daemonHttpBase(port);
  try {
    const r = await fetch(`${base}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => ({})) as { cluster_id?: string; cluster_name?: string };
    return { port, base, cluster_id: data.cluster_id ?? null, cluster_name: data.cluster_name ?? null };
  } catch { return null; }
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

  let live = (await Promise.all(pri.map(probe))).filter((x): x is LiveProbe => !!x);

  // Only sweep the rest of the range on explicit user rescan.
  if (opts.fullScan) {
    const rest: number[] = [];
    for (let p = PORT_LO; p <= PORT_HI; p++) if (!priority.has(p)) rest.push(p);
    const more = (await Promise.all(rest.map(probe))).filter((x): x is LiveProbe => !!x);
    live = live.concat(more);
  }

  const portSet = new Set(live.map((l) => l.port));
  const clusterMap = new Map<string, LiveProbe>();

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
  const probes = await Promise.all(ports.map(probe));
  const live = probes.filter((x): x is LiveProbe => !!x);
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
