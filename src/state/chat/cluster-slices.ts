/**
 * state/chat/cluster-slices.ts — per-project chat state held in memory.
 *
 * MP3 — switching projects used to wipe the chat wall. We now keep one
 * slice per cluster: `bindCluster` saves the visible state under the
 * prior key and restores the next cluster's slice when we have seen it
 * this session. convMeta still persists to localStorage (the operator's
 * previous sessions); the slice is the live channel.
 *
 * AX3 — the slice also carries `convs`/`convsHydratedAt`, the
 * daemon-authoritative summaries. Excluding them was what forced the
 * BootingPanel on every switch-back: `convsHydratedAt` went null, the
 * boot gate blocked on `/state` + `/chat/snapshot`, and the agents rail
 * painted every agent idle for a second or two. They are restored and
 * flagged `convsStale`; the workspace paints from them immediately and
 * revalidation overwrites them the moment the snapshot lands.
 *
 * The slice map lives in JS memory only — it survives a project switch,
 * not a reload.
 */

import type { DaemonEvent } from '~/lib/daemon-client';
import { state, setState, activeClusterId, setActiveClusterId } from './store';
import { loadConvMeta } from './persistence';
import type { ClusterChatSlice } from './types';

const clusterSnapshots = new Map<string, ClusterChatSlice>();

function emptySlice(): ClusterChatSlice {
  return {
    convMap: {},
    activeConv: null,
    archivedConvs: {},
    convMeta: {},
    convTitleOverrides: {},
    convs: {},
    convsHydratedAt: null,
  };
}

function snapshotCurrent(): ClusterChatSlice {
  return {
    convMap: { ...state.convMap },
    activeConv: state.activeConv,
    archivedConvs: { ...state.archivedConvs },
    convMeta: { ...state.convMeta },
    convTitleOverrides: { ...state.convTitleOverrides },
    convs: { ...state.convs },
    convsHydratedAt: state.convsHydratedAt,
  };
}

/** The cached slice for a background cluster, created on first write.
 *  Used by the inactive-cluster ingest sink. */
export function getOrCreateSlice(clusterKey: string): ClusterChatSlice {
  let slice = clusterSnapshots.get(clusterKey);
  if (!slice) {
    slice = emptySlice();
    clusterSnapshots.set(clusterKey, slice);
  }
  return slice;
}

/**
 * AX3 — true when this cluster has paintable chat state in memory.
 * The boot gate uses it to skip the BootingPanel on a switch-back;
 * "has a hydrated snapshot", not merely "has a slice", because an
 * inactive cluster gets an empty slice the first time a background
 * event lands on it.
 */
export function hasCachedChat(clusterId: string | null): boolean {
  if (!clusterId) return false;
  if (activeClusterId() === clusterId) return state.convsHydratedAt !== null;
  const slice = clusterSnapshots.get(clusterId);
  return !!slice && slice.convsHydratedAt !== null;
}

export function bindCluster(clusterId: string | null): void {
  const prevId = activeClusterId();
  // Idempotent — a repeated notifyActiveChanged for the same cluster
  // must not reset activeConv / conv maps (that ping-pongs with App's
  // default-conv effect and can blow the Solid flush stack on refresh).
  if (prevId === clusterId) return;
  if (prevId) clusterSnapshots.set(prevId, snapshotCurrent());
  setActiveClusterId(clusterId);
  // V89.1/V89.2 — in-flight turn state is global (pendingReplyConvs and
  // lastDeltaTsByConv are not part of the slice) and conv ids like the
  // onboarding one are shared across clusters, so a dispatch on A left a
  // fake "Processing…" on B's master. Always reset, before either path.
  setState('pendingReplyConvs', {});
  setState('lastDeltaTsByConv', {});
  // MP5 — stamp lastReadAt so the rail's unread dot clears on visit.
  // lastEventAt stays untouched: "did anything happen since I last
  // looked" has to remain answerable.
  if (clusterId) {
    setState('clusterActivity', clusterId, (prev) => ({
      lastEventAt: prev?.lastEventAt ?? 0,
      lastReadAt: Date.now(),
      workingConvs: prev?.workingConvs ?? [],
    }));
  }
  const cached = clusterId ? clusterSnapshots.get(clusterId) : null;
  if (cached) {
    // AX3 — restore everything INCLUDING the daemon-authoritative
    // summaries, marked stale. Restoring the wrong cluster's `convs` was
    // the original bug behind py-1.11.2-cockpit's unconditional wipe;
    // restoring THIS cluster's own is what makes switch-back instant.
    setState({
      convMap: cached.convMap,
      activeConv: cached.activeConv,
      archivedConvs: cached.archivedConvs,
      convMeta: cached.convMeta,
      convTitleOverrides: cached.convTitleOverrides,
      convs: cached.convs,
      convsHydratedAt: cached.convsHydratedAt,
      convsStale: cached.convsHydratedAt !== null,
    });
    return;
  }
  // First visit this session — reset. Hydration comes from
  // `hydrateFromSnapshot` (App's boot path); `loadConvMeta` is the
  // optimistic cache so the rail renders something on frame 1.
  setState({
    convMap: {},
    activeConv: null,
    archivedConvs: {},
    convMeta: {},
    convTitleOverrides: {},
    convs: {},
    convsHydratedAt: null,
    convsStale: false,
  });
  loadConvMeta();
}

/** MP5 — bump a cluster's activity counters from event-bus dispatch. */
export function recordActivity(clusterKey: string, ev: DaemonEvent): void {
  setState('clusterActivity', clusterKey, (prev) => {
    const working = new Set(prev?.workingConvs ?? []);
    const conv = typeof ev.conv === 'string' ? ev.conv : null;
    if (conv) {
      if (ev.type === 'chat.assistant.delta') working.add(conv);
      else if (ev.type === 'chat.assistant.final' || ev.type === 'chat.cancelled') working.delete(conv);
    }
    return {
      lastEventAt: Date.now(),
      lastReadAt: prev?.lastReadAt ?? 0,
      workingConvs: [...working],
    };
  });
}

/** Wipe the in-memory slice for a cluster (used by Forget). */
export function clearClusterChat(clusterId: string): void {
  clusterSnapshots.delete(clusterId);
  setState('clusterActivity', (prev) => {
    const next = { ...prev };
    delete next[clusterId];
    return next;
  });
  if (activeClusterId() === clusterId) {
    setState({
      convMap: {},
      activeConv: null,
      archivedConvs: {},
      convMeta: {},
      convTitleOverrides: {},
      convs: {},
      convsHydratedAt: null,
      convsStale: false,
    });
  }
}
