import { createMemo } from 'solid-js';
import { daemonStore } from '~/state/daemon';
import { projectsStore } from '~/state/projects';
import { chatStore } from '~/state/chat';
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
  // Read active port + cluster_id from the instances Map keyed by
  // activeId (V85c).
  const activeId = daemonStore.state.activeId;
  const activeInst = activeId ? daemonStore.state.instances[activeId] : null;
  const activePort = activeInst?.health.port ?? null;
  const activeClusterId = activeInst?.health.cluster_id ?? null;
  const newIds = new Set(projectsStore.state.newClusterIds);
  // V86 — pre-compute which ports are "claimed" by an entry with a
  // real cluster_id, so we can suppress orphan rows (entries lacking
  // cluster_id whose port a sibling already owns).
  const claimedPorts = new Set<number>();
  for (const k of known) {
    if (k.cluster_id) {
      const lp = liveById.get(k.cluster_id);
      claimedPorts.add(lp?.port ?? k.port);
    }
  }
  const result: RailRowData[] = [];
  const seenPorts = new Set<number>();
  const seenClusters = new Set<string>();
  for (const k of known) {
    const liveProbe = k.cluster_id ? liveById.get(k.cluster_id) : null;
    const portCandidate = liveProbe?.port ?? k.port;
    // V86 — orphan suppression. A known-projects entry without
    // cluster_id whose port is owned by a cluster-tagged sibling is
    // stale (operator stopped that project, port got reassigned).
    if (!k.cluster_id && claimedPorts.has(portCandidate)) continue;
    // V83 — a row is also live if it IS the currently-bound daemon
    // project (matched by cluster_id when known, else by port).
    const isActiveBinding =
      (k.cluster_id && activeClusterId && k.cluster_id === activeClusterId) ||
      (!k.cluster_id && activePort !== null && portCandidate === activePort);
    const isLive = !!liveProbe || (!k.cluster_id && livePortSet.has(k.port)) || isActiveBinding;
    if (!isLive) {
      // V79o suppression: hide stale rows only when the cluster (or its
      // port, when no cluster_id is known) is occupied by something live.
      if (k.cluster_id && liveById.has(k.cluster_id)) continue;
      if (!k.cluster_id && livePortSet.has(k.port)) continue;
    }
    const port = portCandidate;
    if (seenPorts.has(port)) continue;
    if (k.cluster_id && seenClusters.has(k.cluster_id)) continue;
    seenPorts.add(port);
    if (k.cluster_id) seenClusters.add(k.cluster_id);
    const alias = kp.getAlias(k);
    const display = alias || k.cluster_name || k.cluster_id || `:${port}`;
    // V86 — stricter active check: when the active instance has a
    // cluster_id, ONLY rows with that exact cluster_id light up. A
    // row matching by port alone is no longer enough (used to false-
    // positive an orphan ":<port>" row when its port was actually
    // bound to another cluster's daemon).
    const active = activeClusterId
      ? k.cluster_id === activeClusterId
      : (!k.cluster_id && activePort !== null && port === activePort);
    const rowKey = k.cluster_id ?? `port:${port}`;
    // MP5 — read activity for this cluster. `working` lights the
    // bouncing slug whenever any conv on this cluster is mid-stream
    // (active or inactive). `hasUnread` shows a small dot when the
    // cluster received an event after the last bindCluster. Active
    // cluster never shows unread (the operator IS looking at it).
    const activity = chatStore.state.clusterActivity[rowKey];
    const working = !!(activity && activity.workingConvs.length > 0);
    const hasUnread = !!(activity && !active && activity.lastEventAt > activity.lastReadAt);
    result.push({
      key: rowKey,
      port, base: liveProbe?.base ?? k.base,
      cluster_id: k.cluster_id ?? null,
      cluster_name: k.cluster_name ?? null,
      display, initials: initialsFor(display),
      live: isLive,
      active: !!active,
      working,
      hasUnread,
      isNew: newIds.has(rowKey),
    });
  }
  result.sort((a, b) => a.port - b.port);
  return result;
});
