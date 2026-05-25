import { createSignal } from 'solid-js';
import { projectsStore } from '~/state/projects';
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
  try {
    const r = await fetch(`http://localhost:${port}/health`, { signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!r.ok) return null;
    const data = await r.json().catch(() => ({})) as { cluster_id?: string; cluster_name?: string };
    return { port, base: `http://localhost:${port}`, cluster_id: data.cluster_id ?? null, cluster_name: data.cluster_name ?? null };
  } catch { return null; }
}

export async function discoverProjects(opts: { fullScan?: boolean } = {}): Promise<void> {
  const known = kp.list();
  const priority = new Set<number>([5570]);
  const last = parseInt(localStorage.getItem('meshcore-last-port') || '0', 10);
  if (last >= PORT_LO && last <= PORT_HI) priority.add(last);
  for (const p of known) priority.add(p.port);
  const pri = [...priority].filter((p) => p >= PORT_LO && p <= PORT_HI);
  const rest: number[] = [];
  for (let p = PORT_LO; p <= PORT_HI; p++) if (!priority.has(p)) rest.push(p);

  let live = (await Promise.all(pri.map(probe))).filter((x): x is LiveProbe => !!x);
  const knownIds = known.map((k) => k.cluster_id).filter((x): x is string => !!x);
  const seenIds = new Set(live.map((l) => l.cluster_id).filter((x): x is string => !!x));
  const missing = knownIds.some((id) => !seenIds.has(id));
  if (opts.fullScan || missing || !live.length) {
    const more = (await Promise.all(rest.map(probe))).filter((x): x is LiveProbe => !!x);
    live = live.concat(more);
  }

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
  log.debug('discover · live', live.length, 'known', known.length);
}

export const projectsRailScan = {
  start: (): void => { setScanning(true); },
  stop: (): void => { setScanning(false); },
  isScanning: (): boolean => scanning(),
};
