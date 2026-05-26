/**
 * state/view.ts — per-project UI view state, persisted to localStorage.
 *
 * Tracks which initiatives + modules the operator has expanded in
 * the current project. Default is collapsed everywhere: the first
 * time a project loads the operator sees the full roadmap shape at a
 * glance without scrolling. Every expand/collapse + group-by-phase
 * toggle is persisted under `mc-view-v1::<cluster_id>` so refreshing
 * or hot-swapping back keeps the prior view.
 *
 * `bindCluster(cluster_id)` is called from the App-level side-effect
 * bus whenever daemonStore swaps in a new project. The store
 * hot-loads that project's saved view and Solid reactivity re-renders
 * all subscribed components automatically.
 */

import { createStore } from 'solid-js/store';

interface ProjectView {
  /** initiativeId → true when expanded. Missing = collapsed. */
  initiatives: Record<string, boolean>;
  /** moduleId → true when expanded. Missing = collapsed. */
  modules: Record<string, boolean>;
  /** initiativeId → true when "Group by phase" is on. */
  groupByPhase: Record<string, boolean>;
}

interface ViewState {
  cluster: string | null;
  view: ProjectView;
}

const EMPTY: ProjectView = { initiatives: {}, modules: {}, groupByPhase: {} };

function keyFor(cluster: string | null): string {
  return `mc-view-v1::${cluster ?? '_local'}`;
}

function loadFor(cluster: string | null): ProjectView {
  try {
    const raw = localStorage.getItem(keyFor(cluster));
    if (!raw) return { ...EMPTY };
    const parsed = JSON.parse(raw) as Partial<ProjectView>;
    return {
      initiatives: parsed.initiatives ?? {},
      modules: parsed.modules ?? {},
      groupByPhase: parsed.groupByPhase ?? {},
    };
  } catch {
    return { ...EMPTY };
  }
}

const [state, setState] = createStore<ViewState>({ cluster: null, view: { ...EMPTY } });

function persist(): void {
  try {
    localStorage.setItem(keyFor(state.cluster), JSON.stringify(state.view));
  } catch {
    /* quota */
  }
}

function bindCluster(cluster: string | null): void {
  setState({ cluster, view: loadFor(cluster) });
}

function isInitiativeExpanded(id: string): boolean {
  return state.view.initiatives[id] === true;
}

function setInitiativeExpanded(id: string, value: boolean): void {
  setState('view', 'initiatives', id, value);
  persist();
}

function toggleInitiative(id: string): void {
  setInitiativeExpanded(id, !isInitiativeExpanded(id));
}

function isModuleExpanded(id: string): boolean {
  return state.view.modules[id] === true;
}

function setModuleExpanded(id: string, value: boolean): void {
  setState('view', 'modules', id, value);
  persist();
}

function toggleModule(id: string): void {
  setModuleExpanded(id, !isModuleExpanded(id));
}

function isGroupByPhase(id: string): boolean {
  return state.view.groupByPhase[id] === true;
}

function setGroupByPhase(id: string, value: boolean): void {
  setState('view', 'groupByPhase', id, value);
  persist();
}

export const viewStore = {
  state,
  bindCluster,
  isInitiativeExpanded,
  setInitiativeExpanded,
  toggleInitiative,
  isModuleExpanded,
  setModuleExpanded,
  toggleModule,
  isGroupByPhase,
  setGroupByPhase,
};
