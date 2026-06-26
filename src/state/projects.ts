/**
 * state/projects.ts — reactive store for the projects rail.
 *
 * Owns the rail's data: every known project (running + stopped) plus
 * the active selection. Wraps `lib/known-projects` for persistence,
 * and adds the in-memory bits the rail UI needs (active port + cluster
 * id, "new since last open" badges).
 *
 * Dedupe semantics (V77b/V78d) are inherited from `lib/known-projects`:
 * a project is identified by `cluster_id` first, `port` as fallback.
 *
 * V79o rule: removal is operator-only via `forget()`. Sync code never
 * removes a project just because the daemon is down — stopped projects
 * stay in the rail forever until the operator drags them out.
 */

import { createStore } from 'solid-js/store';
import { createMemo } from 'solid-js';
import * as kp from '~/lib/known-projects';
import { log } from '~/lib/log';

export interface ProjectsStoreState {
  /** Sorted most-recent first. Always reflects `lib/known-projects.list()`. */
  list: kp.KnownProject[];
  activePort: number | null;
  activeClusterId: string | null;
  /** Cluster ids first seen during THIS session — show a NEW badge. */
  newClusterIds: string[];
}

const initial: ProjectsStoreState = {
  list: [],
  activePort: null,
  activeClusterId: null,
  newClusterIds: [],
};

const [state, setState] = createStore<ProjectsStoreState>(initial);

function refresh(): void {
  setState('list', kp.list());
}

function upsert(input: Parameters<typeof kp.upsert>[0]): kp.KnownProject {
  const before = new Set(state.list.map((p) => p.cluster_id ?? `port:${p.port}`));
  const merged = kp.upsert(input);
  refresh();
  const id = merged.cluster_id ?? `port:${merged.port}`;
  if (!before.has(id) && !state.newClusterIds.includes(id)) {
    setState('newClusterIds', (xs) => [...xs, id]);
  }
  return merged;
}

function forget(target: Parameters<typeof kp.forget>[0]): boolean {
  const ok = kp.forget(target);
  if (ok) refresh();
  return ok;
}

/** FC-2 — durably mark a cluster as the server HOME (never a project) and
 *  scrub it from the known list. Persists so the home stays filtered even
 *  while the daemon is offline. */
function markHome(clusterId: string): void {
  kp.markHome(clusterId);
  refresh();
}

function setActive(port: number, clusterId: string | null): void {
  setState({ activePort: port, activeClusterId: clusterId });
}

function clearNewBadge(id: string): void {
  setState('newClusterIds', (xs) => xs.filter((x) => x !== id));
}

function attachRepoPath(target: Parameters<typeof kp.attachRepoPath>[0], path: string): boolean {
  const ok = kp.attachRepoPath(target, path);
  if (ok) refresh();
  return ok;
}

export const projectsStore = {
  state,
  refresh,
  upsert,
  forget,
  markHome,
  setActive,
  clearNewBadge,
  attachRepoPath,
};

// Derived: the currently-active project record (or null).
export const activeProject = createMemo<kp.KnownProject | null>(() => {
  if (state.activeClusterId) {
    const hit = state.list.find((p) => p.cluster_id === state.activeClusterId);
    if (hit) return hit;
  }
  if (state.activePort !== null) {
    const hit = state.list.find((p) => p.port === state.activePort);
    if (hit) return hit;
  }
  return null;
});

// Initial hydrate from localStorage on module load.
refresh();
log.debug('state/projects loaded with', state.list.length, 'known projects');
