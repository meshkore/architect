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
  /** initiativeId → true when "Group by phase" is on.
   *  V86h — kept for backwards-compat with persisted projects; the UI
   *  no longer reads it (tasks are always grouped by phase). */
  groupByPhase: Record<string, boolean>;
  /** initiativeId → true when its description block is expanded
   *  (oneliner + full body). V86h. */
  descriptions?: Record<string, boolean>;
  /** taskId → true when the task card is expanded inline (shows the
   *  body alongside the title). V86h. */
  tasks?: Record<string, boolean>;
  /** V86w — initiativeId → true when the operator hid the initiative
   *  card from the roadmap. Survives reload; the filter pill at the
   *  top of InitiativesPanel toggles whether archived rows render. */
  archivedInitiatives?: Record<string, boolean>;
  /** V86w — initiativeId → which detail tab is selected when
   *  expanded ('tasks' default, or 'activity'). */
  initiativeTab?: Record<string, 'tasks' | 'activity'>;
}

interface ViewState {
  cluster: string | null;
  view: ProjectView;
}

const EMPTY: ProjectView = {
  initiatives: {}, modules: {}, groupByPhase: {}, descriptions: {}, tasks: {},
  archivedInitiatives: {}, initiativeTab: {},
};

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
      descriptions: parsed.descriptions ?? {},
      tasks: parsed.tasks ?? {},
      archivedInitiatives: parsed.archivedInitiatives ?? {},
      initiativeTab: parsed.initiativeTab ?? {},
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

function isDescriptionExpanded(initiativeId: string): boolean {
  return state.view.descriptions?.[initiativeId] === true;
}

function toggleDescription(initiativeId: string): void {
  const next = !isDescriptionExpanded(initiativeId);
  setState('view', 'descriptions', initiativeId, next);
  persist();
}

function isTaskExpanded(taskId: string): boolean {
  return state.view.tasks?.[taskId] === true;
}

function toggleTask(taskId: string): void {
  const next = !isTaskExpanded(taskId);
  setState('view', 'tasks', taskId, next);
  persist();
}

function isInitiativeArchived(id: string): boolean {
  return state.view.archivedInitiatives?.[id] === true;
}

function setInitiativeArchived(id: string, value: boolean): void {
  setState('view', 'archivedInitiatives', id, value);
  persist();
}

function initiativeTab(id: string): 'tasks' | 'activity' {
  return state.view.initiativeTab?.[id] ?? 'tasks';
}

function setInitiativeTab(id: string, tab: 'tasks' | 'activity'): void {
  setState('view', 'initiativeTab', id, tab);
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
  isDescriptionExpanded,
  toggleDescription,
  isTaskExpanded,
  toggleTask,
  isInitiativeArchived,
  setInitiativeArchived,
  initiativeTab,
  setInitiativeTab,
};
