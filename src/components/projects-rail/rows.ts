import { createMemo } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import * as kp from '~/lib/known-projects';
import type { RailRowData } from '~/components/ProjectsRailRow';
import { livePorts, liveClusters } from './discovery';

function initialsFor(name: string): string {
  const words = name.replace(/[^A-Za-z0-9\s\-_]/g, ' ').split(/[\s\-_]+/).filter(Boolean);
  let out: string;
  if (words.length >= 3) out = words.slice(0, 3).map((w) => w[0]).join('');
  else if (words.length === 2) out = (words[0]?.[0] ?? '') + (words[0]?.slice(1, 2) ?? '') + (words[1]?.[0] ?? '');
  else out = (words[0] ?? '').slice(0, 3);
  return out.toUpperCase().padEnd(3, '·').slice(0, 3);
}

export const rows = createMemo<RailRowData[]>(() => {
  const known = projectsStore.state.list;
  const livePortSet = livePorts();
  const liveById = liveClusters();
  const activePort = daemonStore.state.health?.port ?? null;
  const newIds = new Set(projectsStore.state.newClusterIds);
  const result: RailRowData[] = [];
  const seenPorts = new Set<number>();
  const seenClusters = new Set<string>();
  for (const k of known) {
    const liveProbe = k.cluster_id ? liveById.get(k.cluster_id) : null;
    const isLive = !!liveProbe || (!k.cluster_id && livePortSet.has(k.port));
    if (!isLive) {
      // V79o suppression: hide stale rows only when the cluster (or its
      // port, when no cluster_id is known) is occupied by something live.
      if (k.cluster_id && liveById.has(k.cluster_id)) continue;
      if (!k.cluster_id && livePortSet.has(k.port)) continue;
    }
    const port = liveProbe?.port ?? k.port;
    if (seenPorts.has(port)) continue;
    if (k.cluster_id && seenClusters.has(k.cluster_id)) continue;
    seenPorts.add(port);
    if (k.cluster_id) seenClusters.add(k.cluster_id);
    const alias = kp.getAlias(k);
    const display = alias || k.cluster_name || k.cluster_id || `:${port}`;
    result.push({
      key: k.cluster_id ?? `port:${port}`,
      port, base: liveProbe?.base ?? k.base,
      cluster_id: k.cluster_id ?? null,
      cluster_name: k.cluster_name ?? null,
      display, initials: initialsFor(display),
      live: isLive,
      active: isLive && port === activePort,
      isNew: newIds.has(k.cluster_id ?? `port:${port}`),
    });
  }
  result.sort((a, b) => a.port - b.port);
  return result;
});
