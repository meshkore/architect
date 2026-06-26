import { createMemo, createRoot } from 'solid-js';
import { daemonStore, selectedRowKey } from '~/state/daemon';
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

export const rows = createRoot(() =>
  createMemo<RailRowData[]>(() => {
  const known = projectsStore.state.list;
  const livePortSet = livePorts();
  const liveById = liveClusters();
  // Read active port + cluster_id from the instances Map keyed by
  // activeId (V85c).
  const activeId = daemonStore.state.activeId;
  const activeInst = activeId ? daemonStore.state.instances[activeId] : null;
  const activePort = activeInst?.health.port ?? null;
  const activeClusterId = activeInst?.health.cluster_id ?? null;
  // V86d — `selectedKey` is the single source of truth for "which row
  // is highlighted". Used here ONLY for the per-row `hasUnread` check
  // (active cluster never shows an unread dot). The CSS-level "active"
  // class is now applied inside ProjectsRailRow by reading
  // `selectedRowKey()` directly — keeps highlight reactivity off the
  // rows-array remount cycle.
  const selectedKey = selectedRowKey();
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
    // FC-2 (daemon-centralized) — ONE daemon/port now serves MANY projects, so
    // the unique key is the cluster_id (project), NOT the port. Dedup cluster'd
    // rows by cluster_id (many can share a port); only port-dedup legacy rows
    // that have no cluster_id.
    if (k.cluster_id) {
      if (seenClusters.has(k.cluster_id)) continue;
    } else if (seenPorts.has(port)) {
      continue;
    }
    seenPorts.add(port);
    if (k.cluster_id) seenClusters.add(k.cluster_id);
    const alias = kp.getAlias(k);
    const display = alias || k.cluster_name || k.cluster_id || `:${port}`;
    const rowKey = k.cluster_id ?? `port:${port}`;
    const isSelected = selectedKey === rowKey;
    // MP5 — read activity for this cluster. `working` lights the
    // bouncing slug whenever any conv on this cluster is mid-stream
    // (active or inactive). `hasUnread` shows a small dot when the
    // cluster received an event after the last bindCluster. The
    // currently-selected cluster never shows unread (the operator is
    // looking at it).
    const activity = chatStore.state.clusterActivity[rowKey];
    const working = !!(activity && activity.workingConvs.length > 0);
    const hasUnread = !!(activity && !isSelected && activity.lastEventAt > activity.lastReadAt);
    // V107.4 — `architectActive` reflects "Run All in progress on this
    // cluster" — a non-archived roadmap-architect conv exists, even
    // between turns. Drives a soft pulse on the working bar so the
    // operator can see "I'm running" from the rail without opening
    // the chat. Only computable for the active cluster (chatStore
    // exposes the active slice's convMeta); inactive clusters always
    // read false here. Reuses `isActiveBinding` from above.
    const architectActive = !!(isActiveBinding && chatStore.findActiveArchitectConv());
    result.push({
      key: rowKey,
      port, base: liveProbe?.base ?? k.base,
      cluster_id: k.cluster_id ?? null,
      cluster_name: k.cluster_name ?? null,
      display, initials: initialsFor(display),
      live: isLive,
      working,
      hasUnread,
      architectActive,
      isNew: newIds.has(rowKey),
    });
  }
  // V107.15 — Defensive synthesis for ANY live instance the kp.list()
  // forgot (port-collision sweep race during self-update — see
  // known-projects.ts:175-186). Initial V107.15 only synthesized for
  // state.activeId; field report 2026-05-31 showed inactive clusters
  // can disappear too (operator on Ikamiro, MeshKore Core vanished).
  // Belt-and-braces: walk every entry in daemonStore.state.instances
  // and synthesize a row if it isn't already in `result`.
  const emittedKeys = new Set(result.map((r) => r.key));
  const emittedClusters = new Set(result.map((r) => r.cluster_id).filter((c): c is string => !!c));
  for (const [, inst] of Object.entries(daemonStore.state.instances)) {
    // FC-2 (daemon-centralized) — never synthesize a row for the server HOME
    // (central store, not a project). The boot connection attaches it, but it
    // must not appear in the rail.
    if ((inst.health as { server_home?: boolean }).server_home) continue;
    const cid = inst.health.cluster_id ?? null;
    const port = inst.health.port;
    const synthKey = cid ?? `port:${port}`;
    if (emittedKeys.has(synthKey)) continue;
    if (cid && emittedClusters.has(cid)) continue;
    const display = cid || inst.health.cluster_name || `:${port}`;
    const isThisActive =
      (cid && cid === activeClusterId) ||
      (!cid && activePort !== null && port === activePort);
    result.push({
      key: synthKey,
      port,
      base: inst.client.transport.httpBase,
      cluster_id: cid,
      cluster_name: inst.health.cluster_name ?? null,
      display,
      initials: initialsFor(display),
      live: true,
      working: false,
      hasUnread: false,
      architectActive: !!(isThisActive && chatStore.findActiveArchitectConv()),
      isNew: false,
    });
  }

  result.sort((a, b) => a.port - b.port);
  return result;
  }),
);
